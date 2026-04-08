// AlgoX Trader - Background Service Worker
// Polls the API for new signals and triggers automated trading on XM

const POLL_INTERVAL_MS = 3000;
const KEEPALIVE_ALARM = 'keepalive';

let pollingTimer = null;
let isProcessing = false;
let lastSignalId = null;

// ----- Storage Helpers -----

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'enabled', 'reverseMode'], (result) => {
      resolve({
        serverUrl: (result.serverUrl || '').replace(/\/$/, ''),
        enabled: result.enabled !== false,
        reverseMode: result.reverseMode === true
      });
    });
  });
}

async function saveStatus(status) {
  return new Promise((resolve) => {
    chrome.storage.local.set(status, resolve);
  });
}

// Flip action if reverse mode is on
function applyReverseMode(action, reverseMode) {
  if (!reverseMode) return action;
  return action === 'BUY' ? 'SELL' : 'BUY';
}

// ----- API Helpers -----

async function apiFetch(serverUrl, path, options = {}) {
  const url = `${serverUrl}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ----- Tab Management -----

// Always open a brand-new tab (never reuse) so each signal gets a clean page load
async function openNewTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, (tab) => resolve(tab.id));
  });
}

// Close a tab safely — ignores errors if already closed
function closeTab(tabId) {
  try {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {} // already closed — fine
    });
  } catch (_) {}
}

async function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return resolve();
        if (tab.status === 'complete') return resolve();
        setTimeout(check, 500);
      });
    };
    check();
  });
}

// Reload a tab and wait for it to be ready again
async function reloadAndWait(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, {}, () => {
      setTimeout(() => {
        const check = () => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) return resolve();
            if (tab.status === 'complete') return resolve();
            setTimeout(check, 500);
          });
        };
        check();
      }, 1500); // give it 1.5s before we start polling status
    });
  });
}

// ----- Trade Execution via Content Script -----
// All DOM interaction is handled in content.js; we communicate via message passing.
// XM embeds its trading panel inside a blob: URL iframe — we must target it directly.

// Get all frame IDs for a tab, sorted so non-main frames come first (blob: iframe is what we want)
function getAllFrames(tabId) {
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError || !frames) { resolve([]); return; }
      resolve(frames.sort((a, b) => (a.frameId === 0 ? 1 : 0) - (b.frameId === 0 ? 1 : 0)));
    });
  });
}

// Send PLACE_TRADE to a specific frame and resolve with its response (or null on no reply)
function sendToFrame(tabId, frameId, msg) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 8000);
    chrome.tabs.sendMessage(tabId, msg, { frameId }, (response) => {
      clearTimeout(t);
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(response || null);
    });
  });
}

// Inject content.js into every frame (handles blob: URL iframes)
async function injectAllFrames(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch (e) {
    console.warn('[AlgoX] allFrames injection error (non-fatal):', e.message);
  }
  const frames = await getAllFrames(tabId);
  for (const f of frames) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [f.frameId] }, files: ['content.js'] });
    } catch (_) {}
  }
  console.log('[AlgoX] Injected into', frames.length, 'frames');
}

// Send PLACE_TRADE across all frames; blob: frames first (XM trading panel)
async function broadcastTrade(tabId, action, tpAmount, slAmount) {
  const allFrames = await getAllFrames(tabId);
  const usableFrames = allFrames.filter(f => f.url && f.url !== 'about:blank' && !f.url.startsWith('data:'));

  usableFrames.sort((a, b) => {
    const score = (f) => {
      if (f.url.startsWith('blob:')) return 0;
      if (f.frameId !== 0) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  console.log('[AlgoX] Broadcasting to', usableFrames.length, 'usable frames:',
    usableFrames.map(f => `${f.frameId}:${f.url.substring(0, 70)}`));

  const msg = { type: 'PLACE_TRADE', action, tpAmount, slAmount };
  let lastResult = { success: false, reason: 'no_responding_frame' };

  for (const frame of usableFrames) {
    console.log('[AlgoX] Trying frameId', frame.frameId, frame.url.substring(0, 70));
    const res = await sendToFrame(tabId, frame.frameId, msg);
    if (res && res.success) {
      console.log('[AlgoX] SUCCESS from frameId', frame.frameId);
      return res;
    }
    if (res) lastResult = res;
    console.log('[AlgoX] Frame', frame.frameId, 'response:', JSON.stringify(res));
  }
  return lastResult;
}

async function sendTradeToContentScript(tabId, action, tpAmount, slAmount) {
  await injectAllFrames(tabId);
  await new Promise((r) => setTimeout(r, 800)); // let scripts initialise
  return broadcastTrade(tabId, action, tpAmount, slAmount);
}

// ----- Extension Heartbeat -----

async function sendHeartbeat() {
  const { serverUrl } = await getConfig();
  if (!serverUrl) return;
  try {
    await fetch(`${serverUrl}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (_) {}
}

// ----- Core Polling Logic -----

async function poll() {
  if (isProcessing) return;

  const { serverUrl, enabled, reverseMode } = await getConfig();
  if (!serverUrl) {
    await saveStatus({ connectionStatus: 'no_url' });
    return;
  }
  if (!enabled) {
    await saveStatus({ connectionStatus: 'disabled' });
    return;
  }

  try {
    const settings = await apiFetch(serverUrl, '/settings');
    await saveStatus({ connectionStatus: 'connected', lastPoll: Date.now() });

    if (!settings.automationEnabled) {
      await saveStatus({ connectionStatus: 'paused' });
      return;
    }

    const { signal } = await apiFetch(serverUrl, '/signals/latest');
    if (!signal || signal.id === lastSignalId) return;

    console.log('[AlgoX] New signal received:', signal);
    isProcessing = true;
    lastSignalId = signal.id;

    // Apply reverse mode — flip direction if enabled
    const finalAction = applyReverseMode(signal.action, reverseMode);
    if (reverseMode) {
      console.log('[AlgoX] Reverse mode ON — flipping', signal.action, '→', finalAction);
    }

    await saveStatus({
      lastSignal: {
        id: signal.id,
        symbol: signal.symbol,
        action: signal.action,      // store original signal direction
        finalAction,                 // store what was actually placed
        price: signal.price,
        time: signal.createdAt,
        reversed: reverseMode
      },
      processingStatus: 'opening_tab'
    });

    const symbols = await apiFetch(serverUrl, '/symbols');
    const symbolEntry = symbols.find(
      (s) => s.name.toUpperCase() === signal.symbol.toUpperCase()
    );

    if (!symbolEntry) {
      console.warn('[AlgoX] Symbol not found in registry:', signal.symbol);
      await saveStatus({ processingStatus: 'symbol_not_found' });
      await apiFetch(serverUrl, `/signals/${signal.id}/processed`, { method: 'PATCH' });
      isProcessing = false;
      return;
    }

    // Always open a FRESH tab — never reuse to avoid race conditions
    const tabId = await openNewTab(symbolEntry.xmUrl);

    // Track the tab so we can guarantee cleanup on any code path (exception or not)
    let tabClosed = false;
    const scheduleTabClose = (delay = 3000) => {
      if (tabClosed) return;
      tabClosed = true;
      setTimeout(() => closeTab(tabId), delay);
    };

    try {
      await waitForTabReady(tabId);
      // Wait generously for XM's Angular app to fully initialise (SPA frameworks are slow)
      await new Promise((r) => setTimeout(r, 4000));

      await saveStatus({ processingStatus: 'placing_order' });

      // First attempt
      let tradeResult = await sendTradeToContentScript(
        tabId, finalAction, settings.tpAmount, settings.slAmount
      );
      console.log('[AlgoX] First attempt result:', tradeResult);

      // If failed — refresh the page and retry once
      if (!tradeResult?.success) {
        console.log('[AlgoX] Trade failed, refreshing page and retrying...');
        await saveStatus({ processingStatus: 'refreshing_page' });
        await reloadAndWait(tabId);
        // Full wait again after refresh
        await new Promise((r) => setTimeout(r, 4000));
        tradeResult = await sendTradeToContentScript(
          tabId, finalAction, settings.tpAmount, settings.slAmount
        );
        console.log('[AlgoX] Retry after refresh result:', tradeResult);
      }

      await apiFetch(serverUrl, `/signals/${signal.id}/processed`, { method: 'PATCH' });

      await saveStatus({
        processingStatus: tradeResult?.success ? 'success' : 'manual_required',
        lastProcessed: Date.now(),
        lastTradeContext: {
          tabId,
          action: finalAction,
          originalAction: signal.action,
          tpAmount: settings.tpAmount,
          slAmount: settings.slAmount,
          symbol: signal.symbol,
          xmUrl: symbolEntry.xmUrl
        }
      });

      // Show desktop notification
      const notifOptions = {
        type: 'basic',
        title: `AlgoX: ${finalAction} ${signal.symbol}${reverseMode ? ' (Reversed)' : ''}`,
        message: tradeResult?.success
          ? `Order placed. TP: $${settings.tpAmount} | SL: $${settings.slAmount}`
          : `Please place the ${finalAction} order manually on XM.`
      };
      try {
        const iconUrl = chrome.runtime.getURL('icons/icon128.png');
        if (iconUrl) notifOptions.iconUrl = iconUrl;
      } catch (_) {}
      chrome.notifications.create(notifOptions);

    } finally {
      // Always close the tab — 3s after success/failure, immediately on unexpected error
      scheduleTabClose(3000);
    }

  } catch (err) {
    console.error('[AlgoX] Poll error:', err.message);
    await saveStatus({ connectionStatus: 'error', lastError: err.message });
  } finally {
    isProcessing = false;
  }
}

// ----- Service Worker Lifecycle -----

function startPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  poll();
  sendHeartbeat();
  pollingTimer = setInterval(poll, POLL_INTERVAL_MS);
  setInterval(sendHeartbeat, 10_000);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    if (!pollingTimer) startPolling();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(null, (data) => sendResponse(data));
    return true;
  }

  if (msg.type === 'CONFIG_CHANGED') {
    lastSignalId = null;
    startPolling();
    sendResponse({ ok: true });
  }

  if (msg.type === 'TOGGLE_ENABLED') {
    chrome.storage.local.set({ enabled: msg.enabled }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'TOGGLE_REVERSE') {
    chrome.storage.local.set({ reverseMode: msg.reverseMode }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'TEST_TRADE') {
    // Find any open XM tab — don't close it after test (user is watching)
    const { action } = msg;
    chrome.tabs.query({ url: 'https://my.xm.com/*' }, async (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ success: false, reason: 'no_xm_tab' });
        return;
      }
      const tabId = tabs[0].id;
      chrome.tabs.update(tabId, { active: true });
      chrome.tabs.get(tabId, (t) => {
        if (t && t.windowId) chrome.windows.update(t.windowId, { focused: true });
      });
      await new Promise((r) => setTimeout(r, 300));

      chrome.storage.local.get(['serverUrl'], async (cfg) => {
        let tpAmount = 2;
        let slAmount = 2;
        try {
          const serverUrl = (cfg.serverUrl || '').replace(/\/$/, '');
          if (serverUrl) {
            const res = await fetch(`${serverUrl}/api/settings`);
            if (res.ok) {
              const s = await res.json();
              tpAmount = s.tpAmount || 2;
              slAmount = s.slAmount || 2;
            }
          }
        } catch (_) {}

        await saveStatus({ processingStatus: 'placing_order' });
        const tradeResult = await sendTradeToContentScript(tabId, action, tpAmount, slAmount);
        console.log('[AlgoX] Test trade result:', tradeResult);
        await saveStatus({
          processingStatus: tradeResult?.success ? 'success' : 'manual_required',
          lastProcessed: Date.now()
        });
        sendResponse(tradeResult || { success: false, reason: 'no_response' });
      });
    });
    return true;
  }

  if (msg.type === 'RETRY_TRADE') {
    chrome.storage.local.get(['lastTradeContext', 'serverUrl'], async (data) => {
      const ctx = data.lastTradeContext;
      if (!ctx) { sendResponse({ ok: false, reason: 'no_last_trade' }); return; }

      await saveStatus({ processingStatus: 'retrying' });

      // Open a fresh tab (original was auto-closed)
      const xmUrl = ctx.xmUrl || 'https://my.xm.com/symbol-info/BTCUSD%23';
      const tabId = await openNewTab(xmUrl);
      await waitForTabReady(tabId);
      await new Promise((r) => setTimeout(r, 4000));

      const tradeResult = await sendTradeToContentScript(tabId, ctx.action, ctx.tpAmount, ctx.slAmount);
      console.log('[AlgoX] Retry result:', tradeResult);

      await saveStatus({
        processingStatus: tradeResult?.success ? 'success' : 'manual_required',
        lastProcessed: Date.now()
      });

      // Auto-close after retry too
      setTimeout(() => closeTab(tabId), 3000);

      sendResponse({ ok: true, tradeResult });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  saveStatus({ connectionStatus: 'no_url', processingStatus: 'idle' });
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  startPolling();
});

startPolling();
