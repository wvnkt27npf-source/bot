// AlgoX Trader - Popup Script

const $ = (id) => document.getElementById(id);

const STATUS_LABELS = {
  connected: 'Connected',
  error: 'Error',
  disabled: 'Disabled',
  paused: 'Paused',
  no_url: 'Setup needed',
  connecting: 'Connecting...'
};

const PROCESSING_LABELS = {
  idle: null,
  opening_tab: 'Opening XM page...',
  placing_order: 'Placing order...',
  retrying: 'Retrying trade...',
  refreshing_page: 'Refreshing page, retrying...',
  success: 'Order placed! ✓',
  manual_required: 'Manual action needed',
  symbol_not_found: 'Symbol not configured'
};

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const sec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function updateUI(data) {
  const {
    connectionStatus = 'connecting',
    enabled = true,
    reverseMode = false,
    lastSignal,
    processingStatus = 'idle',
    lastPoll,
    lastError
  } = data;

  // Status badge
  const dot = $('statusDot');
  const statusText = $('statusText');
  dot.className = 'status-dot ' + connectionStatus;
  statusText.textContent = STATUS_LABELS[connectionStatus] || connectionStatus;
  if (connectionStatus === 'error' && lastError) statusText.title = lastError;

  // Auto trading toggle
  $('enabledToggle').checked = enabled;
  $('toggleSublabel').textContent = enabled
    ? 'Auto trading is active'
    : 'Auto trading is paused';

  // Reverse mode toggle
  const reverseToggle = $('reverseModeToggle');
  reverseToggle.checked = reverseMode;
  updateReverseSublabel(reverseMode);
  const section = $('reverseModeSection');
  section.classList.toggle('reverse-active', reverseMode);

  // Last signal
  if (lastSignal) {
    $('noSignal').classList.add('hidden');
    $('signalInfo').classList.remove('hidden');
    $('sigSymbol').textContent = lastSignal.symbol;
    const actionEl = $('sigAction');
    // Show the final action (what was actually placed)
    const displayAction = lastSignal.finalAction || lastSignal.action;
    actionEl.textContent = displayAction;
    actionEl.className = 'signal-action ' + displayAction;
    $('sigPrice').textContent = lastSignal.price ? `$${Number(lastSignal.price).toLocaleString()}` : '';
    $('sigTime').textContent = timeAgo(lastSignal.time);
    // Show "reversed" badge if reverse mode was active for this signal
    const reversedEl = $('sigReversed');
    if (lastSignal.reversed) {
      reversedEl.classList.remove('hidden');
    } else {
      reversedEl.classList.add('hidden');
    }
  } else {
    $('noSignal').classList.remove('hidden');
    $('signalInfo').classList.add('hidden');
  }

  // Processing status
  const processingSection = $('processingSection');
  const processingLabel = PROCESSING_LABELS[processingStatus];
  if (processingLabel) {
    processingSection.style.display = 'block';
    $('processingText').textContent = processingLabel;
    const spinner = $('spinner');
    spinner.style.display = ['idle', 'success', 'manual_required', 'symbol_not_found'].includes(processingStatus)
      ? 'none' : 'block';
  } else {
    processingSection.style.display = 'none';
  }

  // Retry button
  const retrySection = $('retrySection');
  const showRetry = lastSignal && ['manual_required', 'success', 'symbol_not_found'].includes(processingStatus);
  retrySection.style.display = showRetry ? 'block' : 'none';

  // Last poll time
  $('lastPollText').textContent = lastPoll
    ? `Last poll: ${timeAgo(lastPoll)}`
    : 'Last poll: never';
}

function updateReverseSublabel(reverseMode) {
  $('reverseSublabel').textContent = reverseMode
    ? 'BUY signal → SELL order (reversed!)'
    : 'BUY signal → BUY order (normal)';
}

async function loadAndRender() {
  chrome.storage.local.get(['serverUrl', 'reverseMode'], (result) => {
    if (result.serverUrl) $('serverUrl').value = result.serverUrl;
    $('reverseModeToggle').checked = result.reverseMode === true;
    updateReverseSublabel(result.reverseMode === true);
    if (result.reverseMode) $('reverseModeSection').classList.add('reverse-active');
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (data) => {
    if (chrome.runtime.lastError) return;
    if (data) updateUI(data);
  });
}

// Save server URL
$('saveBtn').addEventListener('click', () => {
  const url = $('serverUrl').value.trim().replace(/\/$/, '');
  if (!url) return;
  const saveAndNotify = () => {
    chrome.storage.local.set({ serverUrl: url }, () => {
      chrome.runtime.sendMessage({ type: 'CONFIG_CHANGED' }, () => {
        $('saveBtn').textContent = 'Saved!';
        setTimeout(() => ($('saveBtn').textContent = 'Save'), 1500);
        loadAndRender();
      });
    });
  };
  try {
    const origin = new URL(url).origin + '/*';
    chrome.permissions.request({ origins: [origin] }, () => {
      if (chrome.runtime.lastError) {}
      saveAndNotify();
    });
  } catch (_) {
    saveAndNotify();
  }
});

// Auto trading toggle
$('enabledToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled }, () => {
    $('toggleSublabel').textContent = enabled ? 'Auto trading is active' : 'Auto trading is paused';
    chrome.storage.local.set({ enabled });
  });
});

// Reverse mode toggle
$('reverseModeToggle').addEventListener('change', (e) => {
  const reverseMode = e.target.checked;
  chrome.storage.local.set({ reverseMode }, () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_REVERSE', reverseMode }, () => {});
    updateReverseSublabel(reverseMode);
    $('reverseModeSection').classList.toggle('reverse-active', reverseMode);
  });
});

// Retry last signal
$('retryBtn').addEventListener('click', () => {
  const btn = $('retryBtn');
  btn.disabled = true;
  btn.textContent = 'Retrying...';
  chrome.runtime.sendMessage({ type: 'RETRY_TRADE' }, (response) => {
    if (chrome.runtime.lastError) {
      btn.textContent = 'Error — try again';
      btn.disabled = false;
      return;
    }
    btn.textContent = response?.ok ? '↺ Retry Last Signal' : 'Error — try again';
    btn.disabled = false;
    setTimeout(pollStatus, 1000);
  });
});

// Manual test trade buttons
function runTestTrade(action) {
  const buyBtn = $('testBuyBtn');
  const sellBtn = $('testSellBtn');
  const statusEl = $('testStatus');

  buyBtn.disabled = true;
  sellBtn.disabled = true;
  statusEl.className = 'test-status running';
  statusEl.textContent = `Sending ${action} to XM...`;
  statusEl.style.display = 'block';

  chrome.runtime.sendMessage({ type: 'TEST_TRADE', action }, (response) => {
    buyBtn.disabled = false;
    sellBtn.disabled = false;

    if (chrome.runtime.lastError || !response) {
      statusEl.className = 'test-status error';
      statusEl.textContent = 'Error: No XM tab found. Open XM first.';
      return;
    }

    if (response.success) {
      statusEl.className = 'test-status success';
      statusEl.textContent = `✓ ${action} order placed!`;
    } else {
      statusEl.className = 'test-status error';
      const reason = response.reason || 'unknown';
      if (reason === 'no_xm_tab') {
        statusEl.textContent = 'No XM tab found. Open my.xm.com first.';
      } else if (reason === 'button_not_found') {
        statusEl.textContent = 'Button not found — open a symbol chart on XM first.';
      } else if (reason === 'timeout') {
        statusEl.textContent = 'Timeout — XM page took too long. Try again.';
      } else if (reason && reason.startsWith('inject_failed')) {
        statusEl.textContent = 'Cannot inject script — reload the XM tab and try again.';
      } else if (reason && reason.includes('Receiving end')) {
        statusEl.textContent = 'Script not ready — try again in 2s.';
      } else {
        statusEl.textContent = `Failed: ${reason}`;
      }
    }

    setTimeout(() => { statusEl.style.display = 'none'; }, 6000);
  });
}

$('testBuyBtn').addEventListener('click', () => runTestTrade('BUY'));
$('testSellBtn').addEventListener('click', () => runTestTrade('SELL'));

// Open dashboard
$('openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.get(['serverUrl'], (result) => {
    if (result.serverUrl) chrome.tabs.create({ url: result.serverUrl });
  });
});

// Poll storage for live updates
function pollStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (data) => {
    if (chrome.runtime.lastError || !data) return;
    updateUI(data);
  });
}

loadAndRender();
setInterval(pollStatus, 2000);
