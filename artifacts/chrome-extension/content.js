// AlgoX Trader - Content Script
// Injected into https://my.xm.com/symbol-info/* pages
// Listens for trade commands from the background service worker

(function () {
  'use strict';

  let currentOverlay = null;

  // ---- Overlay UI ----

  function removeExistingOverlay() {
    if (currentOverlay) {
      currentOverlay.remove();
      currentOverlay = null;
    }
    const existing = document.getElementById('algox-overlay');
    if (existing) existing.remove();
  }

  function createOverlay(action, tpAmount, slAmount) {
    removeExistingOverlay();

    const color = action === 'BUY' ? '#22c55e' : '#ef4444';
    const overlay = document.createElement('div');
    overlay.id = 'algox-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: #0f172a;
      color: #f8fafc;
      padding: 16px 20px;
      border-radius: 12px;
      border: 2px solid ${color};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      min-width: 240px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    `;
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
        <span style="font-weight:700;font-size:15px;color:${color};">AlgoX: ${action}</span>
      </div>
      <div style="color:#94a3b8;margin-bottom:10px;">
        TP: $${tpAmount} &nbsp;|&nbsp; SL: $${slAmount}
      </div>
      <div id="algox-status" style="font-size:12px;color:#60a5fa;line-height:1.6;">
        Initializing...
      </div>
    `;

    document.body.appendChild(overlay);
    currentOverlay = overlay;
    return overlay;
  }

  function setStatus(msg) {
    const el = document.getElementById('algox-status');
    if (el) el.textContent = msg;
    console.log('[AlgoX]', msg);
  }

  // ---- DOM Helpers ----

  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeSetter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---- XM Toggle Enabling ----
  // Find a toggle switch by its visible label text and enable it if currently off.
  // Returns true if toggle was found AND is now on, false if not found.

  function findToggleNear(labelText) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim().toLowerCase().includes(labelText.toLowerCase())) {
        let container = node.parentElement;
        for (let depth = 0; depth < 6 && container; depth++) {
          const toggle = container.querySelector(
            'input[type="checkbox"], [role="switch"], [role="checkbox"], .toggle, .switch, .switcher'
          );
          if (toggle) return toggle;
          container = container.parentElement;
        }
      }
    }
    return null;
  }

  function isToggleOn(toggle) {
    if (toggle.tagName === 'INPUT') return toggle.checked;
    const ariaChecked = toggle.getAttribute('aria-checked');
    if (ariaChecked !== null) return ariaChecked === 'true';
    const cls = (toggle.className || '').toLowerCase();
    return cls.includes('active') || cls.includes('-on') || cls.includes('enabled') || cls.includes('checked');
  }

  // Returns: 'on' | 'off' | 'not_found'
  // Clicks the toggle if found and off, then re-checks state after a short delay.
  async function enableToggleByLabel(labelText) {
    const toggle = findToggleNear(labelText);
    if (!toggle) return 'not_found';
    if (!isToggleOn(toggle)) {
      toggle.click();
      await delay(250); // wait for React state update
    }
    return isToggleOn(toggle) ? 'on' : 'off';
  }

  // ---- TP/SL Input Setting ----

  function findAndSetTpSl(tpAmount, slAmount) {
    const tpPatterns = [
      'input[name*="take" i]', 'input[name*="tp" i]', 'input[name*="profit" i]',
      'input[placeholder*="take profit" i]', 'input[placeholder*="profit" i]',
      'input[id*="take" i]', 'input[id*="profit" i]',
      '[class*="takeProfit"] input', '[class*="take-profit"] input',
      '[class*="tp"] input'
    ];
    const slPatterns = [
      'input[name*="stop" i]', 'input[name*="sl" i]', 'input[name*="loss" i]',
      'input[placeholder*="stop loss" i]', 'input[placeholder*="loss" i]',
      'input[id*="stop" i]', 'input[id*="loss" i]',
      '[class*="stopLoss"] input', '[class*="stop-loss"] input',
      '[class*="sl"] input'
    ];

    let tpSet = false;
    let slSet = false;

    for (const pattern of tpPatterns) {
      const el = document.querySelector(pattern);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        setInputValue(el, tpAmount);
        tpSet = true;
        break;
      }
    }

    for (const pattern of slPatterns) {
      const el = document.querySelector(pattern);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        setInputValue(el, slAmount);
        slSet = true;
        break;
      }
    }

    return { tpSet, slSet };
  }

  // ---- BUY/SELL Button Finding ----
  // XM shows "BUY 54.52" and "SELL 53.69" in the button text.

  function findActionButton(action) {
    const actionLower = action.toLowerCase();
    const actionUpper = action.toUpperCase();
    const terms = action === 'BUY' ? ['BUY', 'LONG', 'CALL'] : ['SELL', 'SHORT', 'PUT'];

    // Priority 1: data attributes
    let btn = document.querySelector(
      `[data-action="${actionLower}"], [data-action="${actionUpper}"], [data-type="${actionLower}"]`
    );
    if (btn) return btn;

    // Priority 2: class-based selectors
    const classPatterns = [
      `.btn-${actionLower}`, `.button-${actionLower}`,
      `.${actionLower}-btn`, `.${actionLower}-button`,
      `[class*="${actionUpper}"]`, `[class*="${actionLower}Btn"]`,
    ];
    for (const pattern of classPatterns) {
      btn = document.querySelector(pattern);
      if (btn) return btn;
    }

    // Priority 3: button text matching (handles "BUY 54.52" format on XM)
    const allButtons = Array.from(
      document.querySelectorAll('button, [role="button"], a[class*="btn"]')
    );

    btn = allButtons.find((el) => {
      const text = el.textContent.trim().toUpperCase();
      return terms.some((t) =>
        text === t ||
        text.startsWith(t + ' ') ||
        text.startsWith(t + '\n') ||
        text.endsWith(' ' + t)
      );
    });
    if (btn) return btn;

    // Priority 4: aria-label
    for (const term of terms) {
      btn = document.querySelector(`[aria-label*="${term}" i]`);
      if (btn) return btn;
    }

    return null;
  }

  // ---- Main Trade Execution ----
  // Each attempt retries ALL prerequisite steps (toggle enabling, TP/SL setting, button click)
  // so that lazy-rendered DOM elements are handled correctly across retries.

  async function executeTrade(action, tpAmount, slAmount) {
    createOverlay(action, tpAmount, slAmount);

    // Each attempt performs all required steps end-to-end:
    // 1. Enable toggles  2. Set TP/SL inputs  3. Click action button
    // This ensures any step that failed due to lazy DOM rendering is retried.
    const attempt = async (attemptNum) => {
      setStatus(attemptNum === 0 ? 'Scanning page...' : `Retry ${attemptNum}/20...`);

      // Step 1: Enable "One Click Order" toggle (XM requirement)
      const oneClickStatus = await enableToggleByLabel('One Click Order');

      // Step 2: Enable TP/SL toggle (XM requirement)
      const tpSlStatus = await enableToggleByLabel('TP/SL');

      // If nothing from the trading panel has rendered yet, keep waiting
      if (oneClickStatus === 'not_found' && tpSlStatus === 'not_found') {
        return false; // DOM not ready yet — retry
      }

      // Step 3: Set TP/SL input values
      const { tpSet, slSet } = findAndSetTpSl(tpAmount, slAmount);

      // Policy: if TP/SL toggle was found but inputs are absent or values not set,
      // log a warning and skip this attempt — don't place an unprotected order.
      if (tpSlStatus !== 'not_found' && !tpSet && !slSet) {
        setStatus('Waiting for TP/SL inputs...');
        return false;
      }

      if (tpSet || slSet) {
        setStatus(`TP=$${tpAmount} SL=$${slAmount} set`);
        await delay(150);
      }

      // Step 4: Find and click the BUY or SELL button
      const btn = findActionButton(action);
      if (!btn) {
        setStatus(`Looking for ${action} button...`);
        return false;
      }

      setStatus(`Clicking ${action}...`);
      btn.focus();
      btn.click();
      await delay(400);

      // Auto-confirm any confirmation dialog
      const confirmBtns = Array.from(document.querySelectorAll('button')).filter((b) => {
        const text = b.textContent.trim().toUpperCase();
        return ['CONFIRM', 'OK', 'YES', 'PLACE ORDER', 'SUBMIT'].includes(text);
      });
      if (confirmBtns.length > 0) {
        confirmBtns[0].click();
        setStatus('Order confirmed!');
      } else {
        setStatus(`${action} order placed!`);
      }
      return true;
    };

    // First attempt immediately
    if (await attempt(0)) {
      setTimeout(() => removeExistingOverlay(), 5000);
      return { success: true, method: 'immediate' };
    }

    // Retry loop — all prerequisite steps are retried in each iteration
    for (let i = 1; i <= 20; i++) {
      await delay(500);
      if (await attempt(i)) {
        setTimeout(() => removeExistingOverlay(), 5000);
        return { success: true, method: 'retry', attempt: i };
      }
    }

    // Final fallback: signal manual intervention required
    setStatus(`Manual: Place ${action} order\nTP: $${tpAmount} | SL: $${slAmount}`);
    setTimeout(() => removeExistingOverlay(), 20000);
    return { success: false, reason: 'button_not_found' };
  }

  // ---- Message Listener ----

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PLACE_TRADE') {
      const { action, tpAmount, slAmount } = msg;
      executeTrade(action, tpAmount, slAmount).then(sendResponse);
      return true; // keep channel open for async response
    }
    if (msg.type === 'PING') {
      sendResponse({ ready: true, url: window.location.href });
    }
  });

  console.log('[AlgoX] Content script loaded on', window.location.href);
})();
