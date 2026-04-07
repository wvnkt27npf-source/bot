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
    chrome.storage.local.get(['serverUrl', 'enabled'], (result) => {
      resolve({
        serverUrl: (result.serverUrl || '').replace(/\/$/, ''),
        enabled: result.enabled !== false // default true
      });
    });
  });
}

async function saveStatus(status) {
  return new Promise((resolve) => {
    chrome.storage.local.set(status, resolve);
  });
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

async function openOrReuseTab(url) {
  return new Promise((resolve) => {
    const urlPattern = url.split('?')[0];
    chrome.tabs.query({ url: 'https://my.xm.com/symbol-info/*' }, (tabs) => {
      const existing = tabs.find((t) => t.url && t.url.startsWith(urlPattern));
      if (existing) {
        chrome.tabs.update(existing.id, { url, active: true }, () => {
          chrome.windows.update(existing.windowId, { focused: true });
          resolve(existing.id);
        });
      } else {
        chrome.tabs.create({ url, active: true }, (tab) => resolve(tab.id));
      }
    });
  });
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

// ----- Trade Execution via Content Script -----
// All DOM interaction is handled in content.js; we communicate via message passing.

async function sendTradeToContentScript(tabId, action, tpAmount, slAmount) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ success: false, reason: 'timeout' }), 30000);
    chrome.tabs.sendMessage(
      tabId,
      { type: 'PLACE_TRADE', action, tpAmount, slAmount },
      (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn('[AlgoX] Content script message error:', chrome.runtime.lastError.message);
          resolve({ success: false, reason: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, reason: 'no_response' });
        }
      }
    );
  });
}

// ----- Extension Heartbeat (lets dashboard show "Extension Connected") -----

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

  const { serverUrl, enabled } = await getConfig();
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

    await saveStatus({
      lastSignal: {
        id: signal.id,
        symbol: signal.symbol,
        action: signal.action,
        price: signal.price,
        time: signal.createdAt
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

    const tabId = await openOrReuseTab(symbolEntry.xmUrl);

    await waitForTabReady(tabId);
    await new Promise((r) => setTimeout(r, 2000)); // let XM JS initialize

    await saveStatus({ processingStatus: 'placing_order' });

    // Delegate all DOM interaction to content.js via message passing
    const tradeResult = await sendTradeToContentScript(
      tabId,
      signal.action,
      settings.tpAmount,
      settings.slAmount
    );

    console.log('[AlgoX] Trade result:', tradeResult);

    await apiFetch(serverUrl, `/signals/${signal.id}/processed`, { method: 'PATCH' });

    await saveStatus({
      processingStatus: tradeResult?.success ? 'success' : 'manual_required',
      lastProcessed: Date.now(),
      lastTradeContext: {
        tabId,
        action: signal.action,
        tpAmount: settings.tpAmount,
        slAmount: settings.slAmount,
        symbol: signal.symbol
      }
    });

    const notifOptions = {
      type: 'basic',
      title: `AlgoX: ${signal.action} ${signal.symbol}`,
      message: tradeResult?.success
        ? `Order placed. TP: $${settings.tpAmount} | SL: $${settings.slAmount}`
        : `Please place the ${signal.action} order manually on XM.`
    };
    try {
      const iconUrl = chrome.runtime.getURL('icons/icon128.png');
      if (iconUrl) notifOptions.iconUrl = iconUrl;
    } catch (_) {}
    chrome.notifications.create(notifOptions);

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
  // Heartbeat every 10 seconds (independent of signal polling)
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
  if (msg.type === 'TEST_TRADE') {
    // Find any open XM tab and fire a test PLACE_TRADE directly — no signal polling needed
    const { action } = msg;
    chrome.storage.local.get(['lastTradeContext', 'serverUrl'], async (data) => {
      // Look for any XM tab
      chrome.tabs.query({ url: 'https://my.xm.com/*' }, async (tabs) => {
        if (!tabs || tabs.length === 0) {
          sendResponse({ success: false, reason: 'no_xm_tab' });
          return;
        }

        const tabId = tabs[0].id;
        // Bring tab to front
        chrome.tabs.update(tabId, { active: true });
        chrome.tabs.get(tabId, (t) => {
          if (t && t.windowId) chrome.windows.update(t.windowId, { focused: true });
        });

        await new Promise((r) => setTimeout(r, 300));

        // Use stored TP/SL settings if available, otherwise defaults
        chrome.storage.local.get(['serverUrl'], async (cfg) => {
          let tpAmount = 2;
          let slAmount = 2;
          try {
            const serverUrl = (cfg.serverUrl || '').replace(/\/$/, '');
            if (serverUrl) {
              const res = await fetch(`${serverUrl}/api/settings`);
              if (res.ok) {
                const settings = await res.json();
                tpAmount = settings.tpAmount || 2;
                slAmount = settings.slAmount || 2;
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
    });
    return true;
  }

  if (msg.type === 'RETRY_TRADE') {
    chrome.storage.local.get(['lastTradeContext', 'serverUrl'], async (data) => {
      const ctx = data.lastTradeContext;
      if (!ctx) { sendResponse({ ok: false, reason: 'no_last_trade' }); return; }

      await saveStatus({ processingStatus: 'retrying' });

      // Try to reuse existing XM tab; fallback to any XM tab
      const findTab = () => new Promise((resolve) => {
        chrome.tabs.get(ctx.tabId, (tab) => {
          if (!chrome.runtime.lastError && tab) return resolve(tab.id);
          chrome.tabs.query({ url: 'https://my.xm.com/*' }, (tabs) => {
            resolve(tabs.length > 0 ? tabs[0].id : null);
          });
        });
      });

      const tabId = await findTab();
      if (!tabId) {
        await saveStatus({ processingStatus: 'manual_required' });
        sendResponse({ ok: false, reason: 'no_xm_tab' });
        return;
      }

      // Bring XM tab to front
      chrome.tabs.update(tabId, { active: true });
      chrome.tabs.get(tabId, (t) => {
        if (t && t.windowId) chrome.windows.update(t.windowId, { focused: true });
      });

      await new Promise((r) => setTimeout(r, 500));

      const tradeResult = await sendTradeToContentScript(tabId, ctx.action, ctx.tpAmount, ctx.slAmount);
      console.log('[AlgoX] Retry result:', tradeResult);

      await saveStatus({
        processingStatus: tradeResult?.success ? 'success' : 'manual_required',
        lastProcessed: Date.now()
      });

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
