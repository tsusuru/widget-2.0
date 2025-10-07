/* ============ PinterPal Widget App ============ */
/* NB: API integratie (apimovie.py) later. Dit is alleen UI + mock flow. */

(function initPinterPalWidget() {
  const ROOT_ID = 'pinterpal-widget-root';

  // Create launcher + panel once
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

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
      <main class="pp-messages" id="pp-messages">
        <div class="pp-msg pp-bot">
          Hoi! Ik help je snel naar de perfect passende producten. Eerst wat vragen — kost je <strong>minder dan 1 minuut</strong>.
          <div class="pp-chips" id="pp-chips"></div>
        </div>
      </main>
      <footer class="pp-footer">
        <input id="pp-input" class="pp-input" placeholder="Typ je antwoord…" aria-label="Bericht" />
        <button id="pp-send" class="pp-send" disabled>Verstuur</button>
      </footer>
    </section>
  `);

  const qset = [
    { id: 'use', label: 'Waarvoor ga je het gebruiken?', options: ['Dagelijks', 'Reizen', 'Sport', 'Zakelijk'] },
    { id: 'budget', label: 'Wat is je budget?', options: ['< €50', '€50–€150', '€150–€300', '€300+'] },
    { id: 'brand', label: 'Heb je voorkeur voor een merk?', options: ['Geen voorkeur', 'A-merk', 'Duurzaam', 'Prijs/kwaliteit'] },
    { id: 'speed', label: 'Hoe belangrijk is snelheid?', options: ['Niet belangrijk', 'Gemiddeld', 'Heel belangrijk'] },
    { id: 'size', label: 'Welke maat past het best?', options: ['Compact', 'Gemiddeld', 'Groot'] },
    { id: 'features', label: 'Welke features zijn must-have?', options: ['Waterproof', 'Draadloos', '4K', 'Noise-cancelling'] },
    { id: 'style', label: 'Welke stijl zoek je?', options: ['Minimal', 'Klassiek', 'Bold'] },
    { id: 'delivery', label: 'Hoe snel wil je geleverd?', options: ['Vandaag/Morgen', 'Binnen 3 dagen', 'Maakt niet uit'] },
  ];

  const state = {
    step: 0,
    answers: {},
    total: Math.min(8, qset.length)
  };

  const $ = (id) => document.getElementById(id);
  const launcher = $('pp-launcher');
  const panel = root.querySelector('.pp-panel');
  const messages = $('pp-messages');
  const chips = $('pp-chips');
  const input = $('pp-input');
  const send = $('pp-send');
  const closeBtn = $('pp-close');
  const progress = $('pp-progress');

  function openPanel() {
    panel.classList.add('pp-open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.style.opacity = '0';
    launcher.style.pointerEvents = 'none';
    renderStep();
  }
  function closePanel() {
    panel.classList.remove('pp-open');
    panel.setAttribute('aria-hidden', 'true');
    launcher.style.opacity = '1';
    launcher.style.pointerEvents = 'auto';
  }

  launcher.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  input.addEventListener('input', () => {
    send.disabled = input.value.trim().length === 0;
  });
  send.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) return;
    appendUser(val);
    input.value = '';
    send.disabled = true;
    handleAnswer(val);
  });

  function renderStep() {
    const step = state.step;
    const q = qset[step];
    progress.style.width = `${(step / state.total) * 100}%`;

    chips.innerHTML = '';
    if (!q) return;

    const msg = messages.querySelector('.pp-msg.pp-bot:last-of-type');
    if (msg) {
      msg.insertAdjacentHTML('beforeend', `<div style="margin-top:8px;color:var(--pp-muted);font-size:12px;">Vraag ${step + 1} van ${state.total}</div>`);
    }

    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'pp-chip';
      btn.type = 'button';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        appendUser(opt);
        handleAnswer(opt);
      });
      chips.appendChild(btn);
    });

    // Zet huidige vraag in een apart botbericht (duidelijker)
    setTimeout(() => {
      appendBot(q.label);
    }, 120);
  }

  function handleAnswer(val) {
    const key = qset[state.step]?.id;
    if (key) state.answers[key] = val;

    // Typ-indicator
    typing(true);
    setTimeout(() => {
      typing(false);
      state.step += 1;
      if (state.step < state.total) {
        // Toon volgende vraag
        appendBot(reasonLine(state.step - 1));
        renderStep();
      } else {
        // Mock resultaten
        progress.style.width = '100%';
        const { summary, items } = mockRankProducts(state.answers);
        appendBot(summary);
        items.forEach((p, i) => {
          appendBot(productCard(p, i));
        });
        appendBot('Klaar! Wil je dat ik de selectie mail/opsla of direct naar productpagina’s ga?');
      }
    }, 550);
  }

  function reasonLine(prevIndex) {
    const q = qset[prevIndex];
    if (!q) return 'Top! Volgende…';
    return `Helder — ik hou rekening met <strong>${q.label.toLowerCase()}</strong>.`;
  }

  function productCard(p, idx) {
    return `
      <div style="display:grid; grid-template-columns: 64px 1fr auto; gap:12px; align-items:center;">
        <div style="width:64px;height:64px;border-radius:12px;background:var(--pp-bg-soft);border:1px solid var(--pp-border);display:grid;place-items:center;font-weight:700;">${idx+1}</div>
        <div>
          <div style="font-weight:600;margin-bottom:2px">${p.title}</div>
          <div style="font-size:12px;color:var(--pp-muted)">${p.reason}</div>
        </div>
        <a href="#" class="pp-chip" role="button">Bekijk</a>
      </div>
    `;
  }

  function mockRankProducts(answers) {
    const summary = `Op basis van je antwoorden geef ik je de beste match — duidelijk waarom, zodat je met vertrouwen kiest.`;
    const items = [
      { title: 'Pro Model X', reason: 'Beste balans prijs/snelheid · Populair bij dagelijks gebruik' },
      { title: 'Eco Lite', reason: 'Duurzame keuze · Lichtgewicht · Snelle levering' },
      { title: 'Travel Go', reason: 'Compact & sterk · Top voor reizen' },
    ];
    return { summary, items };
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
      typingEl = document.createElement('div');
      typingEl.className = 'pp-msg pp-bot';
      typingEl.innerHTML = `<div class="pp-typing" aria-live="polite"><span></span><span></span><span></span></div>`;
      messages.appendChild(typingEl);
      messages.scrollTop = messages.scrollHeight;
    } else if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  // Open on URL hash ?open
  if (new URLSearchParams(location.search).has('open')) openPanel();

})();
