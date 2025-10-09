/* ============ PinterPal Widget App ============ */
/* Live API-integratie met FastAPI /enrich-data (OOP-backend) */

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
    waiting: false
  };

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

  // ---- UI helpers ----
  function openPanel() {
    panel.classList.add('pp-open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.style.opacity = '0';
    launcher.style.pointerEvents = 'none';
    bootConversation();
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
    messages.scrollTop = messages.scrollHeight;
  }
  function appendUser(text) {
    const el = document.createElement('div');
    el.className = 'pp-msg pp-user';
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }
  let typingEl;
  function typing(on) {
    if (on) {
      if (typingEl) return;
      typingEl = document.createElement('div');
      typingEl.className = 'pp-msg pp-bot';
      typingEl.innerHTML = `<div class="pp-typing" aria-live="polite"><span></span><span></span><span></span></div>`;
      messages.appendChild(typingEl);
      messages.scrollTop = messages.scrollHeight;
    } else if (typingEl) {
      typingEl.remove(); typingEl = null;
    }
  }
  function toastError(text) {
    appendBot(`<div style="color:#ffb4b4">⚠️ ${text}</div>`);
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
          <div>${data.question_text}</div>
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
      btn.textContent = (typeof label === 'string') ? label : (label?.label || label?.value || 'Optie');
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
    if (text) appendBot(text);

    // Toon gekozen + 2 alternatieven (server stuurt 'alternatives' met _image)
    const list = Array.isArray(alts) && alts.length ? alts : (item ? [item] : []);
    if (!list.length) return;

    const html = list.slice(0, 3).map((p, idx) => productCardWithImage(p, idx)).join('');
    appendBot(`
      <div class="pp-cardlist" style="display:grid; gap:12px; margin-top:8px;">
        ${html}
      </div>
    `);

    // knop-actie (nu ‘Waarom deze?’ — triggert detail-mode tekst)
    messages.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-pp="view"]');
      if (!btn) return;
      appendUser('Waarom deze?');
      await handleSubmit('Waarom deze?', { isChoice: false });
    }, { once: true });
  }

  function productCardWithImage(p, idx) {
    const title = escapeHtml(p.title || p.naam || p.productName || p.name || `Optie ${idx+1}`);
    const img = p._image || p.image || p.image_url || p.imageUrl || p.thumbnail || p.foto || p.afbeelding || '';
    const facts = pickFacts(p, ['prijs','price','jaar','year','land','streek','druif','wijnhuis']).slice(0,3);

    return `
      <div style="display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:center;border:1px solid var(--pp-border);background:var(--pp-bg-soft);border-radius:12px;padding:10px;">
        <div style="width:72px;height:72px;border-radius:10px;overflow:hidden;background:var(--pp-bg);border:1px solid var(--pp-border);display:grid;place-items:center;">
          ${img ? `<img src="${escapeHtml(img)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                : `<span style="font-weight:700;font-size:18px;">${idx+1}</span>`}
        </div>
        <div>
          <div style="font-weight:700;margin-bottom:2px">${title}</div>
          ${facts.length ? `<div style="font-size:12px;color:var(--pp-muted)">${facts.map(escapeHtml).join(' · ')}</div>` : ``}
        </div>
        <button class="pp-chip" data-pp="view" data-idx="${idx}">Bekijk</button>
      </div>
    `;
  }

  // ---- Conversation flow ----
  async function bootConversation() {
    if (messages.children.length === 0) {
      appendBot(`Hoi! Ik help je snel naar de best passende keuze. Eerst een paar vragen — dat kost je minder dan 1 minuut.`);
    }
    await handleSubmit('Start', { isChoice: false, reset: true });
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
          if (res.response) appendBot(res.response);
          break;
        }
        case 'explain': {
          if (res.response) appendBot(res.response);
          break;
        }
        default: {
          if (typeof res.response === 'string') appendBot(res.response);
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
    await handleSubmit(val, { isChoice: false });
  });

  // Open on ?open
  if (new URLSearchParams(location.search).has('open')) openPanel();

  // ---- helpers (title/facts/html escape) ----
  function pickTitle(item) {
    return item.title || item.naam || item.productName || item.name || item.id || 'Aanbeveling';
  }
  function pickFacts(item, keys) {
    const out = [];
    keys.forEach(k => {
      if (item[k] !== undefined && item[k] !== null && String(item[k]).trim() !== '') {
        out.push(`${k}: ${item[k]}`);
      }
    });
    return out;
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
})();
