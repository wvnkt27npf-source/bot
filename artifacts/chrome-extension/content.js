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

  // ---- Shadow DOM Utilities ----
  // XM's web terminal (Angular) may place elements inside Shadow DOM hosts.

  function deepQueryAll(selector, root = document) {
    const results = [];
    function search(node) {
      if (!node) return;
      try {
        const found = node.querySelectorAll(selector);
        found.forEach((el) => results.push(el));
      } catch (_) {}
      const children = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
      children.forEach((el) => {
        if (el.shadowRoot) search(el.shadowRoot);
      });
      if (node.shadowRoot) search(node.shadowRoot);
    }
    search(root);
    return results;
  }

  function deepQuery(selector, root = document) {
    return deepQueryAll(selector, root)[0] || null;
  }

  function deepTextWalker(root = document) {
    const texts = [];
    function walk(node) {
      if (!node) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) texts.push(n);
      if (node.querySelectorAll) {
        Array.from(node.querySelectorAll('*')).forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      }
    }
    walk(root);
    return texts;
  }

  // Find a toggle switch by its visible label text and enable it if currently off.
  // Returns true if toggle was found AND is now on, false if not found.

  function findToggleNear(labelText) {
    // Search through normal DOM and shadow DOM text nodes
    const textNodes = deepTextWalker(document.body);
    for (const node of textNodes) {
      if (node.nodeValue && node.nodeValue.trim().toLowerCase().includes(labelText.toLowerCase())) {
        let container = node.parentElement;
        for (let depth = 0; depth < 8 && container; depth++) {
          // Check container itself and shadow root inside it
          const searchRoot = container.shadowRoot || container;
          const toggle = searchRoot.querySelector(
            'input[type="checkbox"], [role="switch"], [role="checkbox"], .toggle, .switch, .switcher'
          );
          if (toggle) return toggle;
          container = container.parentElement;
        }
      }
    }
    // Fallback: search all toggles in shadow DOM directly
    return deepQuery('input[type="checkbox"], [role="switch"]');
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
      dispatchClick(toggle); // use full mouse events for Angular compatibility
      await delay(300); // wait for state update
    }
    return isToggleOn(toggle) ? 'on' : 'off';
  }

  // ---- TP/SL Input Setting ----

  // XM shows "Price" and "Amount" tabs for TP/SL.
  // We always click "Amount" first so values are in dollar terms (not price levels).
  // Uses a full MouseEvent so Angular's (click) binding fires correctly.
  function dispatchClick(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
  }

  function clickAmountTab() {
    const allClickable = deepQueryAll('button, [role="button"], div[class], span[class], a, li');
    // Find the "Amount" tab — must be exactly "Amount" or "AMOUNT", not a longer label
    const amountTab = allClickable.find((el) => {
      const text = el.textContent.trim().toUpperCase();
      return text === 'AMOUNT';
    });
    if (amountTab) {
      dispatchClick(amountTab);
      return true;
    }
    return false;
  }

  async function findAndSetTpSl(tpAmount, slAmount) {
    // Ensure "Amount" tab is selected before setting values; wait for Angular re-render
    const switched = clickAmountTab();
    if (switched) await delay(500);

    // Search includes shadow DOM
    const tpPatterns = [
      'input[placeholder*="take profit" i]', 'input[placeholder*="profit" i]',
      'input[placeholder*="tp" i]',
      'input[name*="take" i]', 'input[name*="tp" i]', 'input[name*="profit" i]',
      'input[id*="take" i]', 'input[id*="profit" i]',
      '[class*="takeProfit"] input', '[class*="take-profit"] input',
      '[class*="tp"] input'
    ];
    const slPatterns = [
      'input[placeholder*="stop loss" i]', 'input[placeholder*="loss" i]',
      'input[placeholder*="sl" i]',
      'input[name*="stop" i]', 'input[name*="sl" i]', 'input[name*="loss" i]',
      'input[id*="stop" i]', 'input[id*="loss" i]',
      '[class*="stopLoss"] input', '[class*="stop-loss"] input',
      '[class*="sl"] input'
    ];

    let tpSet = false;
    let slSet = false;

    for (const pattern of tpPatterns) {
      const el = deepQuery(pattern);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        setInputValue(el, tpAmount);
        tpSet = true;
        break;
      }
    }

    for (const pattern of slPatterns) {
      const el = deepQuery(pattern);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        setInputValue(el, slAmount);
        slSet = true;
        break;
      }
    }

    // Fallback: find all visible inputs near TP/SL label text
    if (!tpSet || !slSet) {
      const allInputs = deepQueryAll('input[type="text"], input[type="number"], input:not([type])');
      const textNodes = deepTextWalker(document.body);
      for (const node of textNodes) {
        const val = (node.nodeValue || '').trim().toUpperCase();
        if (!tpSet && (val.includes('TAKE PROFIT') || val.includes('PROFIT AMOUNT') || val.includes('TP'))) {
          let el = node.parentElement;
          for (let d = 0; d < 5 && el; d++) {
            const inp = el.querySelector('input');
            if (inp) { setInputValue(inp, tpAmount); tpSet = true; break; }
            el = el.parentElement;
          }
        }
        if (!slSet && (val.includes('STOP LOSS') || val.includes('LOSS AMOUNT') || val.includes('SL'))) {
          let el = node.parentElement;
          for (let d = 0; d < 5 && el; d++) {
            const inp = el.querySelector('input');
            if (inp) { setInputValue(inp, slAmount); slSet = true; break; }
            el = el.parentElement;
          }
        }
      }
    }

    return { tpSet, slSet };
  }

  // ---- BUY/SELL Button Finding ----
  // XM has two ways to place an order:
  //   A) "Place Order at X" green button (bottom of form) — includes TP/SL, PREFERRED
  //   B) One-Click BUY/SELL price button (top of panel) — immediate, no TP/SL form
  // We always prefer A so TP/SL is applied.

  function isLikelyClickable(el) {
    const tag = el.tagName;
    if (['BUTTON', 'A'].includes(tag)) return true;
    if (el.getAttribute('role') === 'button') return true;
    const cls = (el.className || '').toString().toLowerCase();
    return cls.includes('btn') || cls.includes('button') || cls.includes('action') || cls.includes('click');
  }

  function findActionButton(action) {
    const actionLower = action.toLowerCase();
    const actionUpper = action.toUpperCase();
    const terms = action === 'BUY' ? ['BUY', 'LONG', 'CALL'] : ['SELL', 'SHORT', 'PUT'];

    // Priority 1 (HIGHEST): "Place Order at X" — this submits the form WITH TP/SL
    // Skip if disabled (TP/SL validation still failing) — retry loop will wait for it to enable
    const allElements = deepQueryAll('button, [role="button"], div[class], span[class], a');
    const isDisabled = (el) => {
      if (el.disabled) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      const cls = (el.className || '').toString().toLowerCase();
      return cls.includes('disabled') || cls.includes('is-disabled');
    };
    let btn = allElements.find((el) => {
      if (isDisabled(el)) return false;
      const text = el.textContent.trim().toUpperCase();
      return (text.startsWith('PLACE ORDER') || text.startsWith('CONFIRM ORDER')) && isLikelyClickable(el);
    });
    if (btn) return btn;

    // Priority 2: data attributes (search shadow DOM too)
    btn = deepQuery(
      `[data-action="${actionLower}"], [data-action="${actionUpper}"], [data-type="${actionLower}"], [data-side="${actionLower}"]`
    );
    if (btn) return btn;

    // Priority 3: class-based selectors (XM: 'buy-price', 'sell-price', 'action-buy')
    const classPatterns = [
      `.btn-${actionLower}`, `.button-${actionLower}`,
      `.${actionLower}-btn`, `.${actionLower}-button`,
      `.${actionLower}-price`, `.${actionLower}-action`,
      `[class*="action-${actionLower}"]`, `[class*="${actionLower}Price"]`,
      `[class*="${actionLower}Btn"]`, `[class*="${actionLower}Button"]`,
    ];
    for (const pattern of classPatterns) {
      btn = deepQuery(pattern);
      if (btn) return btn;
    }

    // Priority 4: broad text scan — BUY/SELL price button at top of XM panel
    // Must be short text (price button, not a label like "Buy When Price is")
    const allClickable = deepQueryAll('button, [role="button"], a, div[class], span[class]');

    // 4a: first child text node starts with BUY/SELL and element seems clickable
    btn = allClickable.find((el) => {
      if (!isLikelyClickable(el)) return false;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.nodeValue.trim().toUpperCase();
          if (terms.some((term) => t === term || t.startsWith(term + ' '))) return true;
        }
      }
      return false;
    });
    if (btn) return btn;

    // 4b: full textContent — must start with BUY/SELL and be short (< 20 chars) to avoid false positives
    btn = allClickable.find((el) => {
      const text = el.textContent.trim().toUpperCase();
      if (text.length > 20) return false; // skip long labels like "Buy When Price is"
      return terms.some((t) => text === t || text.startsWith(t + ' ') || text.startsWith(t + '\n'));
    });
    if (btn) return btn;

    // Priority 5: aria-label (shadow DOM)
    for (const term of terms) {
      btn = deepQuery(`[aria-label*="${term}" i]`);
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

      // Step 3: Set TP/SL input values (async — clicks "Amount" tab and waits for re-render)
      const { tpSet, slSet } = await findAndSetTpSl(tpAmount, slAmount);

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
      try { btn.focus(); } catch (_) {}
      dispatchClick(btn);
      await delay(600);

      // Auto-confirm any confirmation dialog that may appear
      const confirmBtns = deepQueryAll('button, [role="button"]').filter((b) => {
        const text = b.textContent.trim().toUpperCase();
        return ['CONFIRM', 'OK', 'YES', 'PLACE ORDER', 'SUBMIT'].includes(text);
      });
      if (confirmBtns.length > 0) {
        dispatchClick(confirmBtns[0]);
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

    // DOM diagnostic: log all buttons/clickables (incl. shadow DOM) to help debug selector issues
    const allElements = deepQueryAll('button, [role="button"], div[class], span[class], a');
    const dump = allElements
      .filter((el) => el.textContent.trim().length > 0 && el.textContent.trim().length < 50)
      .map((el) => ({ tag: el.tagName, cls: el.className.toString().slice(0, 80), text: el.textContent.trim().slice(0, 30) }))
      .slice(0, 50);
    console.warn('[AlgoX] button_not_found — DOM dump (first 50 short elements):', JSON.stringify(dump, null, 2));
    console.warn('[AlgoX] Page URL:', window.location.href);

    return { success: false, reason: 'button_not_found', domDump: dump.slice(0, 10) };
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
