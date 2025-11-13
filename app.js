/* ============ PinterPal Widget App ============ */
/* Start met open vraag + (optionele) slimme suggesties uit /starter, auto-scroll everywhere */

(function initPinterPalWidget() {
  const ROOT_ID = 'pinterpal-widget-root';
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  // ---- Config uit script tag (fallbacks voor dev) ----
  const currentScript = document.currentScript || document.querySelector('script[src*="app.js"]');
  const fromScript = {
    API_BASE: currentScript?.dataset.apiBase,
    API_USER: currentScript?.dataset.apiUser,
    API_PASS: currentScript?.dataset.apiPass,
    TABLE:    currentScript?.dataset.table
  };

  const CFG = {
    API_BASE: (window.PP_CONFIG?.API_BASE || fromScript.API_BASE || 'http://127.0.0.1:8003').replace(/\/+$/,''),
    API_USER:  window.PP_CONFIG?.API_USER  || fromScript.API_USER  || 'admin',
    API_PASS:  window.PP_CONFIG?.API_PASS  || fromScript.API_PASS  || 'secret',
    TABLE:     window.PP_CONFIG?.TABLE     || fromScript.TABLE     || 'wijnen',
    TIMEOUT_MS: 20000
  };

  console.log('PP Widget config →', { base: CFG.API_BASE, user: CFG.API_USER, table: CFG.TABLE });

  // ---- UI skeleton (launcher + panel) ----
  root.insertAdjacentHTML('beforeend', `
    <button id="pp-launcher" aria-label="Open PinterPal">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3C7.03 3 3 6.58 3 11c0 2.2 1.09 4.18 2.83 5.62-.09.97-.48 2.34-1.7 3.88a.6.6 0 0 0 .65.94c2.55-.62 4.13-1.58 5.02-2.28.69.11 1.4.16 2.2.16 4.97 0 9-3.58 9-8s-4.03-8-9-8Z" fill="currentColor"/>
      </svg>
      <span class="pp-badge" aria-hidden="true">●</span>
    </button>

    <section class="pp-panel" role="dialog" aria-modal="true" aria-labelledby="pp-title" aria-hidden="true">
      <header class="pp-header">
        <div class="pp-logo">PP</div>
        <div class="pp-title">
          <strong id="pp-title">PinterPal</strong>
          <span>Guided selling assistant</span>
        </div>
        <div class="pp-right">
          <span class="pp-badge-soft" title="GDPR-first">GDPR</span>
          <button id="pp-close" class="pp-chip" aria-label="Sluiten">✕</button>
        </div>
      </header>
      <div class="pp-progress" id="pp-progress"></div>
      <main class="pp-messages" id="pp-messages"></main>
      <footer class="pp-footer">
        <input id="pp-input" class="pp-input" placeholder="Typ je antwoord…" aria-label="Bericht" />
        <button id="pp-send" class="pp-send" disabled>Verstuur</button>
      </footer>
    </section>
  `);

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const launcher = $('pp-launcher');
  const panel = root.querySelector('.pp-panel');
  const messages = $('pp-messages');
  const input = $('pp-input');
  const send = $('pp-send');
  const closeBtn = $('pp-close');
  const progress = $('pp-progress');

  // ---- State ----
  const state = {
    sessionId: null,
    lastQuestion: null,
    waiting: false,
    booted: false
  };

  // ---- Text helpers: decode -> strip tags -> escape (voor veilig HTML-insert) ----
  function decodeHtml(s) {
    const t = document.createElement('textarea');
    t.innerHTML = String(s ?? '');
    return t.value;
  }
  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '');
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  function safeText(s) {
    // Gebruik bij innerHTML; geeft nette tekst met accenten, zonder tags
    return escapeHtml(stripTags(decodeHtml(s)));
  }

  // ---- Auto-scroll helpers (force bottom on any change) ----
  function scrollToBottom({ smooth = false } = {}) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          messages.scrollTo({
            top: messages.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
          });
        } catch {
          messages.scrollTop = messages.scrollHeight;
        }
      });
    });
  }

  const mutationObserver = new MutationObserver((mutationList) => {
    for (const m of mutationList) {
      if (m.type === 'childList' && (m.addedNodes?.length || m.removedNodes?.length)) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            const imgs = n.querySelectorAll?.('img') || [];
            imgs.forEach((img) => {
              if (!img.complete) {
                img.addEventListener('load', () => scrollToBottom({ smooth: true }), { once: true });
                img.addEventListener('error', () => scrollToBottom({ smooth: true }), { once: true });
              }
            });
          }
        });
        scrollToBottom({ smooth: true });
      }
    }
  });
  mutationObserver.observe(messages, { childList: true, subtree: true });

  const resizeObserver = new ResizeObserver(() => {
    scrollToBottom({ smooth: true });
  });
  resizeObserver.observe(messages);

  // ---- Auth/Fetch helpers ----
  function basicAuth(user, pass) {
    const raw = `${user}:${pass}`;
    const b64 = btoa(unescape(encodeURIComponent(raw))); // unicode-safe
    return 'Basic ' + b64;
  }

  function apiHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': basicAuth(CFG.API_USER, CFG.API_PASS)
    };
  }

  async function apiFetch(path, options = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_MS);
    try {
      const res = await fetch(`${CFG.API_BASE}${path}`, {
        signal: ctrl.signal,
        ...options,
        headers: { ...apiHeaders(), ...(options.headers || {}) }
      });
      if (!res.ok) {
        const text = await res.text().catch(()=> '');
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${text || 'no body'}`);
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function sendPrompt(prompt, { resetDetail = false } = {}) {
    return apiFetch('/enrich-data/', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        session_id: state.sessionId,
        table_name: CFG.TABLE,
        reset_detail_mode: !!resetDetail
      })
    });
  }

  async function sendChoice(choiceText) {
    return apiFetch('/enrich-data/choice', {
      method: 'POST',
      body: JSON.stringify({
        session_id: state.sessionId,
        choice_text: choiceText,
        table_name: CFG.TABLE
      })
    });
  }

  // ---- Optional: slimme openingsvraag/suggesties uit backend ----
  async function fetchStarter() {
    try {
      const payload = await apiFetch(`/starter?table=${encodeURIComponent(CFG.TABLE)}`, { method: 'GET' });
      if (payload && typeof payload === 'object') return payload;
    } catch { /* fallback gebruiken */ }
    return {
      question_text: 'Waar ben je naar op zoek? Je mag vrij typen (bijv. “fruitige rode wijn onder €15”).',
      suggestions: ['Rode wijn', 'Witte wijn', 'Onder €15', 'Italië', 'Droog', 'Feestelijk']
    };
  }

  // ---- UI helpers ----
  function openPanel() {
    panel.classList.add('pp-open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.style.opacity = '0';
    launcher.style.pointerEvents = 'none';
    bootConversation();
    scrollToBottom(); // direct naar onder bij openen
  }
  function closePanel() {
    panel.classList.remove('pp-open');
    panel.setAttribute('aria-hidden', 'true');
    launcher.style.opacity = '1';
    launcher.style.pointerEvents = 'auto';
  }
  function setProgressByRemaining(remaining) {
    const clamped = Math.max(0, Math.min(3, Number(remaining ?? 0))); // MIN_QUESTIONS≈2 + eventuele extra
    const pct = 100 - (clamped * 33.3);
    progress.style.width = `${pct}%`;
  }
  function appendBot(html) {
    const el = document.createElement('div');
    el.className = 'pp-msg pp-bot';
    el.innerHTML = html;
    messages.appendChild(el);
    scrollToBottom({ smooth: true });
  }
  function appendUser(text) {
    const el = document.createElement('div');
    el.className = 'pp-msg pp-user';
    el.textContent = text; // user input veilig via textContent
    messages.appendChild(el);
    scrollToBottom({ smooth: true });
  }
  let typingEl;
  function typing(on) {
    if (on) {
      if (typingEl) return;
      typingEl = document.createElement('div');
      typingEl.className = 'pp-msg pp-bot';
      typingEl.innerHTML = `<div class="pp-typing" aria-live="polite"><span></span><span></span><span></span></div>`;
      messages.appendChild(typingEl);
      scrollToBottom({ smooth: true });
    } else if (typingEl) {
      typingEl.remove(); typingEl = null;
      scrollToBottom({ smooth: true });
    }
  }
  function toastError(text) {
    appendBot(`<div style="color:#ffb4b4">⚠️ ${safeText(text)}</div>`);
  }

  // ---- Rendering van backend antwoorden ----
  function renderQuestion(q) {
    state.lastQuestion = q;
    const data = q.data || {};
    const remaining = Number(data.remaining_questions ?? 0);
    setProgressByRemaining(remaining);

    if (data.question_text) {
      appendBot(`
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>${safeText(data.question_text)}</div>
          <div style="color:var(--pp-muted);font-size:12px;">Nog ${remaining} vraag${remaining===1?'':'en'}…</div>
        </div>
      `);
    }

    const options = Array.isArray(data.options) ? data.options : [];
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

    const chipWrap = document.createElement('div');
    chipWrap.className = 'pp-chips';
    messages.appendChild(chipWrap);

    function addChip(label, isPrimary = false) {
      const btn = document.createElement('button');
      btn.className = 'pp-chip';
      if (isPrimary) btn.classList.add('pp-chip--primary');
      btn.type = 'button';
      // decodeer entiteiten en zet als pure text
      btn.textContent = decodeHtml(typeof label === 'string' ? label : (label?.label || label?.value || 'Optie'));
      btn.addEventListener('click', async () => {
        appendUser(btn.textContent);
        await handleSubmit(btn.textContent, { isChoice: true });
      });
      chipWrap.appendChild(btn);
    }

    if (q.type === 'multiple_choice' && options.length) {
      options.forEach((o, i) => addChip(o, i < 3));
    } else if (suggestions.length) {
      suggestions.forEach((s, i) => addChip(s, i < 2));
    }
  }

  function renderRecommendation(text, item, alts) {
    setProgressByRemaining(0);
    if (text) appendBot(safeText(text));

    const list = Array.isArray(alts) && alts.length ? alts : (item ? [item] : []);
    if (!list.length) return;

    const html = list.slice(0, 3).map((p, idx) => productCardWithImage(p, idx)).join('');
    appendBot(`
      <div class="pp-cardlist" style="display:grid; gap:12px; margin-top:8px;">
        ${html}
      </div>
    `);

    messages.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', () => scrollToBottom({ smooth: true }), { once: true });
    });

    messages.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-pp="view"]');
      if (!btn) return;
      appendUser('Waarom deze?');
      await handleSubmit('Waarom deze?', { isChoice: false });
    }, { once: true });
  }

  function productCardWithImage(p, idx) {
    const title = safeText(p.title || p.naam || p.productName || p.name || `Optie ${idx+1}`);
    const img = p._image || p.image || p.image_url || p.imageUrl || p.thumbnail || p.foto || p.afbeelding || '';
    const facts = pickFacts(p, ['prijs','price','jaar','year','land','streek','druif','wijnhuis'])
      .slice(0,3)
      .map(safeText);

    return `
      <div style="display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:center;border:1px solid var(--pp-border);background:var(--pp-bg-soft);border-radius:12px;padding:10px;">
        <div style="width:72px;height:72px;border-radius:10px;overflow:hidden;background:var(--pp-bg);border:1px solid var(--pp-border);display:grid;place-items:center;">
          ${img ? `<img src="${escapeHtml(String(img))}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                : `<span style="font-weight:700;font-size:18px;">${idx+1}</span>`}
        </div>
        <div>
          <div style="font-weight:700;margin-bottom:2px">${title}</div>
          ${facts.length ? `<div style="font-size:12px;color:var(--pp-muted)">${facts.join(' · ')}</div>` : ``}
        </div>
        <button class="pp-chip" data-pp="view" data-idx="${idx}">Bekijk</button>
      </div>
    `;
  }

  // ---- Conversation flow (open vraag + suggesties; GEEN automatische "Start") ----
  async function bootConversation() {
    if (state.booted) return;
    state.booted = true;

    appendBot(`Hoi! Ik help je snel naar de best passende keuze. Vertel me eerst even kort wat je zoekt.`);

    const starter = await fetchStarter();
    appendBot(`
      <div style="display:flex;flex-direction:column;gap:8px">
        <div>${safeText(starter.question_text || 'Waar ben je naar op zoek?')}</div>
        <div style="color:var(--pp-muted);font-size:12px;">Je mag vrij typen of kies een optie hieronder.</div>
      </div>
    `);

    if (Array.isArray(starter.suggestions) && starter.suggestions.length) {
      const chipWrap = document.createElement('div');
      chipWrap.className = 'pp-chips';
      messages.appendChild(chipWrap);

      starter.suggestions.slice(0, 8).forEach((s, i) => {
        const btn = document.createElement('button');
        btn.className = 'pp-chip';
        if (i < 3) btn.classList.add('pp-chip--primary');
        btn.type = 'button';
        btn.textContent = decodeHtml(String(s));
        btn.addEventListener('click', async () => {
          appendUser(btn.textContent);
          await handleSubmit(btn.textContent, { isChoice: false, reset: true });
        });
        chipWrap.appendChild(btn);
      });
    }

    input.focus();
  }

  async function handleSubmit(text, { isChoice = false, reset = false } = {}) {
    if (state.waiting) return;
    state.waiting = true;
    input.value = ''; send.disabled = true;
    typing(true);

    try {
      const res = isChoice
        ? await sendChoice(text)
        : await sendPrompt(text, { resetDetail: reset });

      if (!state.sessionId && res.session_id) state.sessionId = res.session_id;

      typing(false);

      switch (res.stage) {
        case 'question': {
          renderQuestion(res.response);
          break;
        }
        case 'recommendation': {
          renderRecommendation(res.response, res.item, res.alternatives);
          break;
        }
        case 'detail': {
          if (res.response) appendBot(safeText(res.response));
          break;
        }
        case 'explain': {
          if (res.response) appendBot(safeText(res.response));
          break;
        }
        default: {
          if (typeof res.response === 'string') appendBot(safeText(res.response));
          else appendBot('Ik heb een antwoord, maar ik weet niet hoe ik het moet tonen 🤔');
        }
      }
    } catch (err) {
      typing(false);
      toastError(err.message || 'Er ging iets mis bij het ophalen van een antwoord.');
    } finally {
      state.waiting = false;
    }
  }

  // ---- Input events ----
  launcher.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  input.addEventListener('input', () => {
    send.disabled = input.value.trim().length === 0;
  });
  send.addEventListener('click', async () => {
    const val = input.value.trim();
    if (!val) return;
    appendUser(val);
    await handleSubmit(val, { isChoice: false, reset: !state.sessionId });
  });

  // Enter-to-send
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      appendUser(val);
      await handleSubmit(val, { isChoice: false, reset: !state.sessionId });
    }
  });

  // Open on ?open
  if (new URLSearchParams(location.search).has('open')) openPanel();

  // ---- helpers (facts) ----
  function pickFacts(item, keys) {
    const out = [];
    keys.forEach(k => {
      if (item[k] !== undefined && item[k] !== null && String(item[k]).trim() !== '') {
        out.push(`${k}: ${item[k]}`);
      }
    });
    return out;
  }
})();
