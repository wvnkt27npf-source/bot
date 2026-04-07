// AlgoX Trader — Content Script
// Injected into XM trading panel (including blob: iframes)
// All selectors confirmed via DevTools on my.xm.com

(function () {
  'use strict';

  // ── Guard: prevent double-injection ────────────────────────────────────────
  if (window.__algoxTraderLoaded) {
    console.log('[AlgoX] Already loaded — skipping');
    return;
  }
  window.__algoxTraderLoaded = true;

  const isMainFrame = window === window.top;
  const frameLabel  = isMainFrame ? 'MAIN' : 'IFRAME';
  let currentOverlay = null;

  // ── Confirmed XM selectors ──────────────────────────────────────────────────
  // BUY/SELL buttons : button or ion-button whose text starts with "BUY" / "SELL"
  // TP/SL toggle     : xm-ion-toggle[formcontrolname="isShowTpSl"] input[type="checkbox"]
  // Amount tab       : button[xmiontabbutton] with text "Amount"
  // TP input         : app-incremental-input.tpsl-input (1st) > input
  // SL input         : app-incremental-input.tpsl-input (2nd) > input
  // Place Order btn  : xm-trade-button-filled button[type="submit"]

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Angular-aware value setter — triggers ControlValueAccessor update
  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    input.focus();
    input.select();
    nativeSetter.call(input, String(value));
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // Full pointer+mouse+click sequence — works on Angular + Ionic web components
  function clickElement(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, pointerId: 1 }));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
    try { el.click(); } catch (_) {}
  }

  // Shadow DOM-aware querySelectorAll
  function deepQueryAll(selector, root = document) {
    const results = [];
    function search(node) {
      if (!node) return;
      try { node.querySelectorAll(selector).forEach((el) => results.push(el)); } catch (_) {}
      try {
        node.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) search(el.shadowRoot);
        });
      } catch (_) {}
      if (node.shadowRoot) search(node.shadowRoot);
    }
    search(root);
    return results;
  }

  // ── Overlay UI ──────────────────────────────────────────────────────────────

  function removeOverlay() {
    if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
    const el = document.getElementById('algox-overlay');
    if (el) el.remove();
  }

  function createOverlay(action, tp, sl) {
    removeOverlay();
    const color = action === 'BUY' ? '#22c55e' : '#ef4444';
    const div = document.createElement('div');
    div.id = 'algox-overlay';
    div.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:2147483647;
      background:#0f172a;color:#f8fafc;padding:16px 20px;
      border-radius:12px;border:2px solid ${color};
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:14px;min-width:240px;box-shadow:0 8px 32px rgba(0,0,0,0.6);
    `;
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
        <span style="font-weight:700;font-size:15px;color:${color};">AlgoX: ${action}</span>
      </div>
      <div style="color:#94a3b8;margin-bottom:10px;">TP: $${tp} &nbsp;|&nbsp; SL: $${sl}</div>
      <div id="algox-status" style="font-size:12px;color:#60a5fa;line-height:1.6;">Initializing...</div>
    `;
    document.body.appendChild(div);
    currentOverlay = div;
  }

  function setStatus(msg) {
    const el = document.getElementById('algox-status');
    if (el) el.textContent = msg;
    console.log('[AlgoX][' + frameLabel + ']', msg);
  }

  // ── Step 1: Find BUY or SELL side button ────────────────────────────────────

  function findSideButton(action) {
    const terms = action === 'BUY' ? ['BUY', 'LONG'] : ['SELL', 'SHORT'];
    const allBtns = deepQueryAll('button, ion-button, [role="button"]');
    for (const btn of allBtns) {
      const text = btn.textContent.trim().toUpperCase();
      if (terms.some(t => text === t || text.startsWith(t + ' ') || text.startsWith(t + '\n'))) {
        return btn;
      }
    }
    // Fallback: aria-label or class contains action name
    for (const term of terms) {
      const el = document.querySelector(`[aria-label*="${term}" i], [class*="${term.toLowerCase()}-price"]`);
      if (el) return el;
    }
    return null;
  }

  // ── Step 2: Enable TP/SL toggle ────────────────────────────────────────────

  async function enableTpSlToggle() {
    const checkbox = document.querySelector(
      'xm-ion-toggle[formcontrolname="isShowTpSl"] input[type="checkbox"]'
    );
    if (!checkbox) return 'not_found';
    if (!checkbox.checked) {
      checkbox.click();
      await delay(400);
    }
    return checkbox.checked ? 'on' : 'off';
  }

  // ── Step 3: Switch to Amount tab and set TP / SL values ────────────────────

  async function ensureAmountTabActive() {
    for (let i = 0; i < 3; i++) {
      const btns = Array.from(document.querySelectorAll('button[xmiontabbutton]'));
      const amountBtn = btns.find(b => b.textContent.trim() === 'Amount');
      if (!amountBtn) { await delay(500); continue; }
      if (amountBtn.classList.contains('active')) return true;
      amountBtn.click();
      await delay(600);
    }
    const btns = Array.from(document.querySelectorAll('button[xmiontabbutton]'));
    const amountBtn = btns.find(b => b.textContent.trim() === 'Amount');
    return amountBtn?.classList.contains('active') ?? false;
  }

  async function findAndSetTpSl(tpAmount, slAmount) {
    await ensureAmountTabActive();
    await delay(400);

    // Primary: app-incremental-input.tpsl-input (confirmed)
    const containers = document.querySelectorAll('app-incremental-input.tpsl-input');
    console.log('[AlgoX] tpsl-input containers:', containers.length);

    if (containers.length >= 2) {
      const tpInput = containers[0].querySelector('input');
      const slInput = containers[1].querySelector('input');
      if (tpInput) setInputValue(tpInput, tpAmount);
      if (slInput) setInputValue(slInput, slAmount);
      console.log('[AlgoX] TP:', tpInput?.value, 'SL:', slInput?.value);
      return { tpSet: !!tpInput, slSet: !!slInput };
    }

    // Fallback A: inputs inside xm-numeric-input wrappers
    const wrappers = Array.from(document.querySelectorAll('xm-numeric-input, xm-ion-masked-input'));
    const inputs = wrappers.map(w => w.querySelector('input')).filter(i => i && !i.readOnly && !i.disabled);
    console.log('[AlgoX] Fallback xm-numeric inputs:', inputs.length);
    if (inputs.length >= 2) {
      setInputValue(inputs[inputs.length - 2], tpAmount);
      setInputValue(inputs[inputs.length - 1], slAmount);
      return { tpSet: true, slSet: true };
    }

    // Fallback B: any editable text/number inputs
    const allInputs = Array.from(document.querySelectorAll('input[type="text"],input[type="number"],input:not([type])'))
      .filter(el => !el.readOnly && !el.disabled && el.type !== 'checkbox');
    console.log('[AlgoX] Fallback all inputs:', allInputs.length);
    if (allInputs.length >= 2) {
      setInputValue(allInputs[allInputs.length - 2], tpAmount);
      setInputValue(allInputs[allInputs.length - 1], slAmount);
      return { tpSet: true, slSet: true };
    }

    return { tpSet: false, slSet: false };
  }

  // ── Step 4: Place Order button ──────────────────────────────────────────────

  function findPlaceOrderButton() {
    // Primary: confirmed XM selector
    const btn = document.querySelector('xm-trade-button-filled button[type="submit"]');
    if (btn && !btn.disabled) return btn;

    // Fallback: text content match
    const all = deepQueryAll('button, ion-button, [role="button"]');
    const found = all.find(el => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('disabled') || cls.includes('is-disabled')) return false;
      const text = el.textContent.trim().toUpperCase();
      return text.startsWith('PLACE ORDER') || text.startsWith('CONFIRM ORDER');
    });
    return found || btn || null;
  }

  // ── Main trade execution ────────────────────────────────────────────────────
  // Flow (confirmed from XM DevTools):
  //   1. Click BUY / SELL price button (sets order side)
  //   2. Enable TP/SL toggle
  //   3. Switch to Amount tab → set TP = +amount, SL = -amount
  //   4. Click "Place Order at X.XX"

  async function executeTrade(action, tpAmount, slAmount) {
    createOverlay(action, tpAmount, slAmount);

    // SL is always negative in XM's Amount mode
    const slValue = -Math.abs(slAmount);

    const attempt = async (n) => {
      setStatus(n === 0 ? 'Starting...' : `Retry ${n}/20...`);

      // Bail fast if wrong frame (very few DOM elements = blank micro-FE iframe)
      if (n >= 2 && document.querySelectorAll('*').length < 10) {
        console.warn('[AlgoX] Empty DOM — wrong frame');
        return 'empty_dom';
      }

      // ── 1. Click BUY / SELL ─────────────────────────────────────────────────
      const sideBtn = findSideButton(action);
      if (!sideBtn) { setStatus(`Looking for ${action} button...`); return false; }
      setStatus(`Clicking ${action}...`);
      clickElement(sideBtn);
      await delay(500);

      // ── 2. Enable TP/SL toggle ──────────────────────────────────────────────
      const tpSlStatus = await enableTpSlToggle();
      console.log('[AlgoX] TP/SL toggle:', tpSlStatus);
      if (tpSlStatus === 'not_found') {
        setStatus('TP/SL toggle not found — retrying...');
        return false;
      }
      await delay(300);

      // ── 3. Set TP / SL values ───────────────────────────────────────────────
      const { tpSet, slSet } = await findAndSetTpSl(tpAmount, slValue);
      console.log('[AlgoX] TP set:', tpSet, '| SL set:', slSet, '| SL value:', slValue);
      if (tpSet || slSet) {
        setStatus(`TP=$${tpAmount} SL=${slValue} set`);
        await delay(400);
      }

      // ── 4. Click Place Order ────────────────────────────────────────────────
      const placeBtn = findPlaceOrderButton();
      if (!placeBtn) {
        setStatus('Waiting for Place Order button...');
        return false;
      }
      setStatus('Placing order...');
      clickElement(placeBtn);
      await delay(600);

      setStatus(`${action} placed! TP=$${tpAmount} SL=${slValue}`);
      return true;
    };

    // First attempt
    const r0 = await attempt(0);
    if (r0 === true) { setTimeout(removeOverlay, 5000); return { success: true }; }
    if (r0 === 'empty_dom') { removeOverlay(); return { success: false, reason: 'empty_dom' }; }

    // Retry loop (up to 20 × 1500 ms = 30 s)
    for (let i = 1; i <= 20; i++) {
      await delay(1500);
      const r = await attempt(i);
      if (r === true)        { setTimeout(removeOverlay, 5000); return { success: true }; }
      if (r === 'empty_dom') { removeOverlay(); return { success: false, reason: 'empty_dom' }; }
    }

    setStatus('Failed after 20 retries');
    setTimeout(removeOverlay, 8000);
    return { success: false, reason: 'timeout' };
  }

  // ── Message listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'PLACE_TRADE') return false;

    console.log('[AlgoX][' + frameLabel + '] PLACE_TRADE received:', msg);

    const { action, tpAmount = 2, slAmount = 2 } = msg;
    if (!action) { sendResponse({ success: false, reason: 'no action' }); return false; }

    executeTrade(action, tpAmount, slAmount)
      .then((result) => { try { sendResponse(result); } catch (_) {} })
      .catch((err)   => { console.error('[AlgoX] executeTrade error:', err); try { sendResponse({ success: false, reason: String(err) }); } catch (_) {} });

    return true; // keep message channel open for async response
  });

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ status: 'alive', frame: frameLabel }); }
  });

  console.log('[AlgoX] Content script ready | frame:', frameLabel, '| url:', window.location.href.substring(0, 80));
})();
