// AlgoX Trader - Content Script
// Injected into https://my.xm.com/symbol-info/* pages
// Listens for trade commands from the background service worker

(function () {
  'use strict';

  // Guard: prevent double-injection (manifest + scripting.executeScript)
  if (window.__algoxTraderLoaded) {
    console.log('[AlgoX] Content script already loaded — skipping duplicate injection');
    return;
  }
  window.__algoxTraderLoaded = true;

  // Frame detection — XM embeds the trade panel in an <iframe>; main frame = sidebar only
  const isMainFrame = window === window.top;
  const frameLabel  = isMainFrame ? 'MAIN-FRAME' : 'IFRAME';

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

  // ---- XM Confirmed Selectors (discovered via DevTools inspection) ----
  // TP/SL toggle:       xm-ion-toggle[formcontrolname="isShowTpSl"] input[type="checkbox"]
  // Amount tab:         button[xmiontabbutton] with text "Amount"
  // TP input:           app-incremental-input.tpsl-input (1st) > input
  // SL input:           app-incremental-input.tpsl-input (2nd) > input
  // Place Order button: xm-trade-button-filled button[type="submit"]
  // BUY/SELL buttons:   inside app-order-buttons — button/ion-button with text BUY/SELL

  // Enable TP/SL toggle using confirmed XM selector
  async function enableTpSlToggle() {
    // Confirmed selector
    const checkbox = document.querySelector(
      'xm-ion-toggle[formcontrolname="isShowTpSl"] input[type="checkbox"]'
    );
    if (checkbox) {
      if (!checkbox.checked) {
        checkbox.click();
        await delay(350);
      }
      return checkbox.checked ? 'on' : 'off';
    }
    return 'not_found';
  }

  // Legacy wrapper kept for compatibility — now delegates to enableTpSlToggle for TP/SL
  async function enableToggleByLabel(labelText) {
    if (labelText.toLowerCase().includes('tp') || labelText.toLowerCase().includes('sl') ||
        labelText.toLowerCase().includes('tpsl')) {
      return enableTpSlToggle();
    }
    // For other toggles: generic text-node search
    const textNodes = deepTextWalker(document.body);
    for (const node of textNodes) {
      if (node.nodeValue && node.nodeValue.trim().toLowerCase().includes(labelText.toLowerCase())) {
        let container = node.parentElement;
        for (let depth = 0; depth < 8 && container; depth++) {
          const toggle = container.querySelector('input[type="checkbox"], [role="switch"]');
          if (toggle) {
            if (!toggle.checked) { toggle.click(); await delay(300); }
            return toggle.checked ? 'on' : 'off';
          }
          container = container.parentElement;
        }
      }
    }
    return 'not_found';
  }

  // ---- TP/SL Input Setting ----

  // General purpose click dispatcher — used for toggles, Place Order button, etc.
  // Uses aggressiveClick defined below. Forward ref is OK since JS hoists functions.
  function dispatchClick(el) {
    aggressiveClick(el);
  }

  // Set input value in a way Angular's ControlValueAccessor registers the change.
  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    input.focus();
    input.select();
    nativeSetter.call(input, String(value));
    ['input', 'change', 'blur'].forEach((type) => {
      input.dispatchEvent(new Event(type, { bubbles: true }));
    });
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value) }));
  }

  // ---- Click helpers ----

  // Multi-strategy click dispatcher (works on regular DOM + Ionic web components).
  function fireClickOn(target) {
    if (!target) return;
    try { target.focus(); } catch (_) {}
    try { target.click(); } catch (_) {}
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
      target.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, pointerId: 1 }));
    } catch (_) {}
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
  }

  function aggressiveClick(el) {
    if (!el) return;
    fireClickOn(el);
    // Also walk UP to nearest clickable ancestor (handles inner span/label cases)
    let ancestor = el.parentElement;
    let depth = 0;
    while (ancestor && depth < 6) {
      const tag = ancestor.tagName;
      const role = ancestor.getAttribute('role') || '';
      if (['BUTTON', 'A'].includes(tag) || role === 'button' || role === 'tab' ||
          ancestor.tagName.startsWith('ION-') || ancestor.tagName.startsWith('XM-')) {
        fireClickOn(ancestor);
        break;
      }
      ancestor = ancestor.parentElement;
      depth++;
    }
  }

  function dispatchClick(el) { aggressiveClick(el); }

  // ---- Diagnostic dump (runs once at start of each trade) ----
  function diagnosticDump() {
    console.log('[AlgoX DIAG] Frame:', frameLabel, '| URL:', window.location.href);
    // 1. ion-segment elements (Ionic tab groups — TP/SL type selector is one of these)
    const segs = deepQueryAll('ion-segment');
    console.log('[AlgoX DIAG] ion-segment count:', segs.length,
      segs.map(s => ({ val: s.value ?? s.getAttribute('value'), cls: String(s.className).substring(0, 60) })));

    // 2. ion-segment-button elements (the actual tab buttons inside ion-segment)
    const segBtns = deepQueryAll('ion-segment-button');
    console.log('[AlgoX DIAG] ion-segment-button count:', segBtns.length,
      segBtns.map(b => ({ val: b.value ?? b.getAttribute('value'), txt: String(b.textContent).trim().substring(0, 30), cls: String(b.className).substring(0, 60) })));

    // 3. All role=tab elements
    const tabs = deepQueryAll('[role="tab"]');
    console.log('[AlgoX DIAG] role=tab count:', tabs.length,
      tabs.map(t => ({ txt: String(t.textContent).trim().substring(0, 30), cls: String(t.className).substring(0, 60) })));

    // 4. ALL inputs (including inside shadow DOM)
    const inputs = deepQueryAll('input');
    console.log('[AlgoX DIAG] input count:', inputs.length,
      inputs.map(i => ({ type: i.type, ph: i.placeholder, nm: i.name, id: i.id, cls: String(i.className).substring(0, 40), vis: i.offsetParent !== null })));

    // 5. ion-input / xm-ion-input wrappers
    const ionInputs = deepQueryAll('ion-input, xm-ion-input');
    console.log('[AlgoX DIAG] ion-input/xm-ion-input count:', ionInputs.length,
      ionInputs.map(i => ({ tag: i.tagName, label: String(i.label ?? i.getAttribute('label') ?? ''), cls: String(i.className).substring(0, 60) })));

    // 6. ion-button elements (Ionic custom buttons — used by XM for BUY/SELL)
    const ionBtns = deepQueryAll('ion-button');
    console.log('[AlgoX DIAG] ion-button count:', ionBtns.length,
      ionBtns.map(b => ({ txt: String(b.textContent).trim().substring(0, 40), cls: String(b.className).substring(0, 60) })));

    // 7. Total DOM element count (sanity check — 0 = wrong frame / not rendered)
    const totalEls = document.querySelectorAll('*').length;
    console.log('[AlgoX DIAG] Total DOM elements:', totalEls);
  }

  // ---- Amount Tab Detection & Switching ----
  // XM uses Ionic's ion-segment/ion-segment-button for the Price vs Amount TP/SL toggle.

  function findAmountTabButton() {
    // Strategy 1: ion-segment-button with value="amount" (most reliable)
    const byVal = deepQuery('ion-segment-button[value="amount"], ion-segment-button[value="AMOUNT"]');
    if (byVal) return byVal;

    // Strategy 2: any ion-segment-button whose text is "Amount"
    const allSegBtns = deepQueryAll('ion-segment-button');
    const byText = allSegBtns.find(b => String(b.textContent).trim().toUpperCase() === 'AMOUNT');
    if (byText) return byText;

    // Strategy 3: role="tab" with text "Amount"
    const tabs = deepQueryAll('[role="tab"]');
    const tabByText = tabs.find(t => String(t.textContent).trim().toUpperCase() === 'AMOUNT');
    if (tabByText) return tabByText;

    // Strategy 4: any button (not floating-label span) whose text is exactly "Amount"
    const buttons = deepQueryAll('button');
    const btnByText = buttons.find(b => String(b.textContent).trim().toUpperCase() === 'AMOUNT');
    if (btnByText) return btnByText;

    return null;
  }

  function isAmountTabActive() {
    // Check ion-segment.value === "amount" — most reliable for Ionic
    const segs = deepQueryAll('ion-segment');
    for (const seg of segs) {
      const val = (seg.value ?? seg.getAttribute('value') ?? '').toLowerCase();
      if (val === 'amount') return true;
      if (val === 'price')  return false;
    }

    // Check ion-segment-button active class (Ionic adds "segment-button-checked")
    const amountBtn = findAmountTabButton();
    if (!amountBtn) return false;
    const cls = String(amountBtn.className).toLowerCase();
    if (cls.includes('segment-button-checked') || cls.includes('active') || cls.includes('selected')) return true;
    if (amountBtn.getAttribute('aria-selected') === 'true') return true;
    if (amountBtn.getAttribute('aria-checked') === 'true') return true;

    return false;
  }

  async function ensureAmountTabActive() {
    // Confirmed XM selector: button[xmiontabbutton] with text "Amount"
    for (let attempt = 0; attempt < 3; attempt++) {
      const allTabBtns = Array.from(document.querySelectorAll('button[xmiontabbutton]'));
      const amountBtn = allTabBtns.find(b => b.textContent.trim() === 'Amount');
      if (!amountBtn) {
        console.log('[AlgoX] Amount tab button not found (attempt', attempt + 1, ')');
        await delay(500);
        continue;
      }
      const isActive = amountBtn.classList.contains('active');
      if (isActive) {
        console.log('[AlgoX] Amount tab already active');
        return true;
      }
      console.log('[AlgoX] Clicking Amount tab (attempt', attempt + 1, ')');
      amountBtn.click();
      await delay(600);
    }
    // Check final state
    const allTabBtns = Array.from(document.querySelectorAll('button[xmiontabbutton]'));
    const amountBtn = allTabBtns.find(b => b.textContent.trim() === 'Amount');
    const active = amountBtn?.classList.contains('active') || false;
    console.log('[AlgoX] Amount tab active after attempts:', active);
    return active;
  }

  // ---- TP/SL Input Finding ----
  // XM wraps inputs in ion-input/xm-ion-input Ionic components.
  // The real <input> is inside their shadow DOM.

  function getInnerInput(ionInputEl) {
    // Try shadow root first
    if (ionInputEl.shadowRoot) {
      const inp = ionInputEl.shadowRoot.querySelector('input');
      if (inp) return inp;
    }
    // Try regular child
    return ionInputEl.querySelector('input') || null;
  }

  function labelTextNear(el) {
    // Walk UP to find a label element (ion-label, xm-ion-label, label) within 8 levels
    let node = el;
    for (let d = 0; d < 8 && node; d++) {
      const labelEl = node.querySelector
        ? (node.querySelector('ion-label, xm-ion-label, label, [class*="label"]'))
        : null;
      if (labelEl) return String(labelEl.textContent).trim().toUpperCase();
      node = node.parentElement;
    }
    return '';
  }

  async function findAndSetTpSl(tpAmount, slAmount) {
    // 1. Switch to Amount tab (confirmed: button[xmiontabbutton] with text "Amount")
    await ensureAmountTabActive();
    await delay(400);

    let tpSet = false;
    let slSet = false;

    // 2. CONFIRMED XM SELECTOR: app-incremental-input.tpsl-input
    //    First = Take Profit, Second = Stop Loss
    const tpslContainers = document.querySelectorAll('app-incremental-input.tpsl-input');
    console.log('[AlgoX] tpsl-input containers found:', tpslContainers.length);
    if (tpslContainers.length >= 2) {
      const tpInput = tpslContainers[0].querySelector('input');
      const slInput = tpslContainers[1].querySelector('input');
      if (tpInput) { setInputValue(tpInput, tpAmount); tpSet = true; }
      if (slInput) { setInputValue(slInput, slAmount); slSet = true; }
      console.log('[AlgoX] Set via confirmed selector — TP:', tpInput?.value, 'SL:', slInput?.value);
      return { tpSet, slSet };
    } else if (tpslContainers.length === 1) {
      // Only one found — assume it's TP
      const inp = tpslContainers[0].querySelector('input');
      if (inp) { setInputValue(inp, tpAmount); tpSet = true; }
    }

    // 3. Fallback: any editable input inside xm-numeric-input or xm-ion-masked-input
    if (!tpSet || !slSet) {
      const wrappers = Array.from(document.querySelectorAll('xm-numeric-input, xm-ion-masked-input'));
      const editableInputs = wrappers.map(w => w.querySelector('input')).filter(i => i && !i.readOnly && !i.disabled);
      console.log('[AlgoX] Fallback: found', editableInputs.length, 'inputs in xm-numeric-input wrappers');
      if (!tpSet && editableInputs[editableInputs.length - 2]) {
        setInputValue(editableInputs[editableInputs.length - 2], tpAmount); tpSet = true;
      }
      if (!slSet && editableInputs[editableInputs.length - 1]) {
        setInputValue(editableInputs[editableInputs.length - 1], slAmount); slSet = true;
      }
    }

    // 4. Last resort: all editable inputs on page
    if (!tpSet && !slSet) {
      const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])'))
        .filter(el => !el.readOnly && !el.disabled && el.type !== 'checkbox');
      console.log('[AlgoX] Last resort:', allInputs.length, 'inputs');
      if (allInputs.length >= 2) {
        setInputValue(allInputs[allInputs.length - 2], tpAmount); tpSet = true;
        setInputValue(allInputs[allInputs.length - 1], slAmount); slSet = true;
      }
    }

    return { tpSet, slSet };
  }

  // ---- BUY/SELL Side Button (top of panel) ----
  // These are the SELL / BUY price buttons at the top — clicking them sets the order side.
  // This is Step 1; "Place Order at X" is the final submit (Step 4).

  function findSideButton(action) {
    const terms = action === 'BUY' ? ['BUY', 'LONG'] : ['SELL', 'SHORT'];

    // Strategy 1: ion-button or button whose text starts with BUY/SELL (price included: "BUY\n2,101.65")
    const allBtns = deepQueryAll('button, ion-button, [role="button"]');
    for (const btn of allBtns) {
      const text = String(btn.textContent).trim().toUpperCase();
      if (terms.some(t => text === t || text.startsWith(t + ' ') || text.startsWith(t + '\n'))) {
        return btn;
      }
    }

    // Strategy 2: class/data attribute patterns
    const actionLower = action.toLowerCase();
    const byClass = deepQuery(
      `[class*="side-${actionLower}"], [class*="${actionLower}-price"], [class*="${actionLower}Price"],` +
      `[data-side="${actionLower}"], [data-action="${actionLower}"]`
    );
    if (byClass) return byClass;

    // Strategy 3: aria-label
    return deepQuery(`[aria-label*="${action}" i]`);
  }

  // ---- Place Order Submit Button ----
  // "Place Order at X.XX" button at the bottom of the form — final submit with TP/SL.

  function findPlaceOrderButton() {
    // CONFIRMED XM selector: xm-trade-button-filled button[type="submit"]
    const confirmed = document.querySelector('xm-trade-button-filled button[type="submit"]');
    if (confirmed && !confirmed.disabled) return confirmed;

    // Fallback: text content match
    const allBtns = deepQueryAll('button, ion-button, [role="button"]');
    const isDisabled = (el) => {
      if (el.disabled) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      const cls = (el.className || '').toString().toLowerCase();
      return cls.includes('disabled') || cls.includes('is-disabled');
    };
    const btn = allBtns.find((el) => {
      if (isDisabled(el)) return false;
      const text = String(el.textContent).trim().toUpperCase();
      return text.startsWith('PLACE ORDER') || text.startsWith('CONFIRM ORDER');
    });
    return btn || confirmed || null;
  }

  // ---- BUY/SELL Button Finding (legacy — kept for fallback) ----
  // XM has two ways to place an order:
  //   A) "Place Order at X" green button (bottom of form) — includes TP/SL, PREFERRED
  //   B) One-Click BUY/SELL price button (top of panel) — immediate, no TP/SL form
  // We always prefer A so TP/SL is applied.

  function isLikelyClickable(el) {
    const tag = el.tagName;
    if (['BUTTON', 'A', 'ION-BUTTON'].includes(tag)) return true;
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
    // ion-button = Ionic custom element used by XM (its light-DOM text is accessible)
    const allElements = deepQueryAll('button, ion-button, [role="button"], div[class], span[class], a');
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
    const allClickable = deepQueryAll('button, ion-button, [role="button"], a, div[class], span[class]');

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
  // Correct XM flow (confirmed from UI):
  //   1. Click BUY or SELL price button (top of panel) — sets order side
  //   2. Enable TP/SL toggle
  //   3. Switch to Amount tab, set TP = +amount, SL = -amount (XM uses negative for SL)
  //   4. Click "Place Order at X.XX" (bottom green/red button)
  // Note: "One Click Order" must NOT be enabled — it bypasses the form and TP/SL.

  async function executeTrade(action, tpAmount, slAmount) {
    createOverlay(action, tpAmount, slAmount);

    // XM Amount mode: TP is positive, SL is NEGATIVE (e.g. TP=2, SL=-2)
    const slValue = -Math.abs(slAmount);

    const attempt = async (attemptNum) => {
      setStatus(attemptNum === 0 ? 'Scanning page...' : `Retry ${attemptNum}/20...`);

      // Fast bail: frames with almost no DOM are not the trading panel (e.g. blank micro-FE iframes)
      if (attemptNum >= 2) {
        const totalEls = document.querySelectorAll('*').length;
        if (totalEls < 10) {
          console.warn('[AlgoX][' + frameLabel + '] Only', totalEls, 'DOM elements — wrong frame, bailing');
          return 'empty_dom';
        }
      }

      // ── Step 1: Click the BUY or SELL price button (top of panel) ──────────────
      const sideBtn = findSideButton(action);
      if (!sideBtn) {
        setStatus(`Looking for ${action} button...`);
        return false; // DOM not ready — retry
      }
      setStatus(`Clicking ${action}...`);
      dispatchClick(sideBtn);
      await delay(500); // wait for the form to reflect the selected side

      // ── Step 2: Enable TP/SL toggle (confirmed: xm-ion-toggle[formcontrolname="isShowTpSl"])
      const tpSlStatus = await enableTpSlToggle();
      console.log('[AlgoX] TP/SL toggle status:', tpSlStatus);
      await delay(300);

      // ── Step 3: Switch to Amount tab and fill TP / SL values ────────────────────
      const { tpSet, slSet } = await findAndSetTpSl(tpAmount, slValue);
      console.log('[AlgoX] TP set:', tpSet, 'SL set:', slSet, '(SL value used:', slValue, ')');

      if (tpSet || slSet) {
        setStatus(`TP=$${tpAmount} SL=${slValue} set`);
        await delay(300);
      }

      // ── Step 4: Click "Place Order at X.XX" ─────────────────────────────────────
      const placeBtn = findPlaceOrderButton();
      if (!placeBtn) {
        setStatus('Waiting for Place Order button...');
        return false; // button may be disabled until TP/SL validates — retry
      }
      setStatus('Placing order...');
      dispatchClick(placeBtn);
      await delay(600);

      setStatus(`${action} order placed! TP=$${tpAmount} SL=${slValue}`);
      return true;
    };

    // First attempt immediately
    const r0 = await attempt(0);
    if (r0 === true) {
      setTimeout(() => removeExistingOverlay(), 5000);
      return { success: true, method: 'immediate' };
    }

    // Retry loop — all prerequisite steps are retried in each iteration
    for (let i = 1; i <= 20; i++) {
      await delay(500);
      const ri = await attempt(i);
      if (ri === 'empty_dom') {
        // This frame has no DOM — bail immediately, let next frame handle it
        removeExistingOverlay();
        return { success: false, reason: 'empty_dom_frame' };
      }
      if (ri === true) {
        setTimeout(() => removeExistingOverlay(), 5000);
        return { success: true, method: 'retry', attempt: i };
      }
    }

    // Final fallback: signal manual intervention required
    setStatus(`Manual: Place ${action} order\nTP: $${tpAmount} | SL: $${slAmount}`);
    setTimeout(() => removeExistingOverlay(), 20000);

    // DOM diagnostic: log all buttons/clickables (incl. shadow DOM) to help debug selector issues
    const allElements = deepQueryAll('button, ion-button, [role="button"], div[class], span[class], a');
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
      // Skip about:blank and data: frames immediately — they have no trading panel DOM
      const href = window.location.href;
      if (!href || href === 'about:blank' || href.startsWith('data:')) {
        console.log('[AlgoX][' + frameLabel + '] Skipping PLACE_TRADE — about:blank/data frame');
        return false;
      }
      const { action, tpAmount, slAmount } = msg;
      console.log('[AlgoX][' + frameLabel + '] Handling PLACE_TRADE', action, 'from', href);
      executeTrade(action, tpAmount, slAmount).then(sendResponse);
      return true; // keep channel open for async response
    }
    if (msg.type === 'PING') {
      sendResponse({ ready: true, url: window.location.href, frame: frameLabel });
    }
  });

  console.log('[AlgoX][' + frameLabel + '] Content script loaded on', window.location.href);
})();
