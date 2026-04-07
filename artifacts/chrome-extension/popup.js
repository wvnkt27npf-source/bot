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

  if (connectionStatus === 'error' && lastError) {
    statusText.title = lastError;
  }

  // Toggle
  $('enabledToggle').checked = enabled;
  $('toggleSublabel').textContent = enabled
    ? 'Auto trading is active'
    : 'Auto trading is paused';

  // Last signal
  if (lastSignal) {
    $('noSignal').classList.add('hidden');
    $('signalInfo').classList.remove('hidden');
    $('sigSymbol').textContent = lastSignal.symbol;
    const actionEl = $('sigAction');
    actionEl.textContent = lastSignal.action;
    actionEl.className = 'signal-action ' + lastSignal.action;
    $('sigPrice').textContent = lastSignal.price ? `$${Number(lastSignal.price).toLocaleString()}` : '';
    $('sigTime').textContent = timeAgo(lastSignal.time);
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

  // Show retry button when last signal exists and trade failed or succeeded (allow re-trade)
  const retrySection = $('retrySection');
  const showRetry = lastSignal && ['manual_required', 'success', 'symbol_not_found'].includes(processingStatus);
  retrySection.style.display = showRetry ? 'block' : 'none';

  // Last poll time
  $('lastPollText').textContent = lastPoll
    ? `Last poll: ${timeAgo(lastPoll)}`
    : 'Last poll: never';
}

async function loadAndRender() {
  chrome.storage.local.get(['serverUrl'], (result) => {
    if (result.serverUrl) {
      $('serverUrl').value = result.serverUrl;
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (data) => {
    if (chrome.runtime.lastError) return;
    if (data) updateUI(data);
  });
}

// Save server URL — also requests host permission for the configured origin
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

  // Request optional host permission for this specific origin so fetch calls succeed
  try {
    const origin = new URL(url).origin + '/*';
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      if (chrome.runtime.lastError) console.warn('[AlgoX] Permission request error:', chrome.runtime.lastError.message);
      saveAndNotify();
    });
  } catch (_) {
    saveAndNotify();
  }
});

// Toggle auto trading
$('enabledToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled }, () => {
    $('toggleSublabel').textContent = enabled
      ? 'Auto trading is active'
      : 'Auto trading is paused';
    chrome.storage.local.set({ enabled });
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
        statusEl.textContent = 'Script not ready — retrying... try again in 2s.';
      } else {
        statusEl.textContent = `Failed: ${reason}`;
      }
    }

    setTimeout(() => { statusEl.style.display = 'none'; }, 6000);
  });
}

$('testBuyBtn').addEventListener('click', () => runTestTrade('BUY'));
$('testSellBtn').addEventListener('click', () => runTestTrade('SELL'));

// Open dashboard link
$('openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.get(['serverUrl'], (result) => {
    if (result.serverUrl) {
      chrome.tabs.create({ url: result.serverUrl });
    }
  });
});

// Poll storage for live updates while popup is open
function pollStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (data) => {
    if (chrome.runtime.lastError || !data) return;
    updateUI(data);
  });
}

// Init
loadAndRender();
setInterval(pollStatus, 2000);
