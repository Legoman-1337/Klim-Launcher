/* Klim Launcher — логика интерфейса */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  info: { edition: 'full' },
  cfg: null,
  versions: [],           // список из манифеста
  installed: new Set(),
  selectedMc: null,       // id версии Minecraft
  loaderOptions: [],
  selectedLoader: null,   // {kind, id, label}
  playReady: false,
  launching: false,
};

/* ---------- Тосты и модалки ---------- */
function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 320);
  }, type === 'error' ? 6000 : 3500);
}

function modal(html) {
  const overlay = $('#modal-overlay');
  $('#modal').innerHTML = html;
  overlay.hidden = false;
  return overlay;
}
function closeModal() { $('#modal-overlay').hidden = true; }
$('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

/* ---------- Внешний вид ---------- */
const THEMES = [
  { id: 'neon', name: 'Neon Sphere' },
  { id: 'grid', name: 'Neon Grid' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'midnight', name: 'Midnight' },
];
const ACCENTS = ['#b049ff', '#ff4ecd', '#4ecdff', '#46e08c', '#ff9a3c', '#ff5c5c'];

function fileUrl(p) {
  if (!p) return null;
  return 'file:///' + encodeURI(p.replaceAll('\\', '/')).replaceAll('#', '%23').replaceAll('?', '%3F');
}

function applyAppearance(cfg) {
  const a = cfg.appearance || {};
  document.documentElement.style.setProperty('--accent', a.accent || '#b049ff');
  document.body.classList.toggle('no-animations', a.animations === false);
  const theme = $('#bg-theme');
  theme.className = 'bg-theme theme-' + (a.theme || 'neon');
  const custom = $('#bg-custom');
  const url = fileUrl(a.bgImage);
  custom.style.backgroundImage = url ? `url("${url}")` : 'none';
  custom.classList.toggle('blurred', !!url && (a.bgBlur || 0) > 0);
  custom.style.setProperty('--bg-blur', (a.bgBlur || 0) + 'px');
  document.body.classList.toggle('has-custom-bg', !!url);
  $('#bg-dim').style.setProperty('--bg-dim', a.bgImage ? (a.bgDim ?? 0.45) : 0.15);
  document.documentElement.style.setProperty('--bg-dim', a.bgImage ? (a.bgDim ?? 0.45) : 0.15);
  syncParticles();
}

/* ---------- Живой фон: частицы ---------- */
// static=1 — dev-режим скриншотов: без анимаций и rAF
const STATIC_MODE = new URLSearchParams(location.search).get('static') === '1';

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex.trim());
  if (!m) return `rgba(176,73,255,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

let particlesRaf = null;
function syncParticles() {
  if (STATIC_MODE) { document.body.classList.add('no-animations'); return; }
  const enabled = !(state.cfg && state.cfg.appearance && state.cfg.appearance.animations === false);
  if (enabled && particlesRaf === null) startParticles();
  if (!enabled && particlesRaf !== null) stopParticles();
}

function startParticles() {
  const canvas = $('#particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
  window.addEventListener('resize', resize);
  resize();
  // Количество частиц — от площади окна и числа ядер (не душаем слабые ПК)
  const count = Math.max(24, Math.min(64, Math.round(W * H / 26000), (navigator.hardwareConcurrency || 4) * 12));
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#b049ff';
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: Math.random() * 1.7 + 0.6,
    vy: -(Math.random() * 0.22 + 0.04),
    vx: (Math.random() - 0.5) * 0.14,
    a: Math.random() * 0.45 + 0.12,
    tw: Math.random() * Math.PI * 2,
    tws: Math.random() * 0.02 + 0.004,
  }));
  // Пауза, когда окно скрыто/свёрнуто — не жжём CPU и GPU впустую
  let hidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (!hidden && particlesRaf !== null) particlesRaf = requestAnimationFrame(frame);
  });
  const frame = () => {
    if (hidden) return; // ждём visibilitychange, rAF сам не тикает в скрытом окне
    ctx.clearRect(0, 0, W, H);
    const col = accent();
    for (const p of parts) {
      p.y += p.vy; p.x += p.vx; p.tw += p.tws;
      if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8; else if (p.x > W + 8) p.x = -8;
      const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      // Свечение рисуем вторым прозрачным кругом — shadowBlur на canvas слишком дорог
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(col, alpha * 0.25);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(col, alpha);
      ctx.fill();
    }
    particlesRaf = requestAnimationFrame(frame);
  };
  particlesRaf = requestAnimationFrame(frame);
}

function stopParticles() {
  if (particlesRaf !== null) { cancelAnimationFrame(particlesRaf); particlesRaf = null; }
}

/* ---------- Микро-взаимодействия ---------- */
// Ripple на клик по кнопкам
document.addEventListener('pointerdown', (e) => {
  if (state.cfg && state.cfg.appearance && state.cfg.appearance.animations === false) return;
  const btn = e.target.closest('.play-btn, .mini-btn, .icon-btn, .combo-toggle');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const d = Math.max(rect.width, rect.height) * 1.2;
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = d + 'px';
  r.style.left = (e.clientX - rect.left - d / 2) + 'px';
  r.style.top = (e.clientY - rect.top - d / 2) + 'px';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 600);
});

// Каскадное появление элементов списка
function stagger(container, selector = ':scope > *', step = 18, max = 350) {
  if (state.cfg && state.cfg.appearance && state.cfg.appearance.animations === false) return;
  [...container.querySelectorAll(selector)].forEach((el, i) => {
    el.classList.add('anim-item');
    el.style.animationDelay = Math.min(i * step, max) + 'ms';
  });
}

// Наклон карточек за курсором
function bindTilt(el) {
  el.addEventListener('mousemove', (e) => {
    if (state.cfg && state.cfg.appearance && state.cfg.appearance.animations === false) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width - 0.5;
    const dy = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(600px) rotateY(${dx * 6}deg) rotateX(${-dy * 6}deg) translateY(-3px)`;
  });
  el.addEventListener('mouseleave', () => { el.style.transform = ''; });
}

/* Параллакс фона — троттлинг через rAF, mousemove не должен перестраивать стиль на каждый тик */
let parallaxPending = false;
document.addEventListener('mousemove', (e) => {
  if (state.cfg && state.cfg.appearance && state.cfg.appearance.animations === false) return;
  if (parallaxPending) return;
  parallaxPending = true;
  requestAnimationFrame(() => {
    parallaxPending = false;
    const dx = (e.clientX / window.innerWidth - 0.5) * 14;
    const dy = (e.clientY / window.innerHeight - 0.5) * 10;
    $('#bg-theme').style.transform = `translate(${dx}px, ${dy}px)`;
    const orbs = document.querySelector('.bg-orbs');
    if (orbs) orbs.style.transform = `translate(${dx * 2}px, ${dy * 2}px)`;
    const custom = $('#bg-custom');
    if (custom.style.backgroundImage !== 'none') custom.style.transform = `translate(${dx * 1.6}px, ${dy * 1.6}px)`;
  });
}, { passive: true });

/* ---------- Заголовок окна ---------- */
$('#tb-min').onclick = () => klim.window.minimize();
$('#tb-max').onclick = () => klim.window.maximize();
$('#tb-close').onclick = () => klim.window.close();

/* ---------- Комбобоксы ---------- */
function closeCombos(except) {
  $$('.combo').forEach(c => {
    if (c !== except) { c.classList.remove('open'); const m = c.querySelector('.combo-menu'); if (m) m.hidden = true; }
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.combo') && !e.target.closest('.menu-popup') && !e.target.closest('#ib-menu')) {
    closeCombos();
    $('#menu-popup').hidden = true;
  }
});

/* ---------- Аккаунты ---------- */
function renderAccounts() {
  const list = $('#account-list');
  list.innerHTML = '';
  const accs = state.cfg.accounts;
  if (!accs.list.length) {
    $('#account-label').textContent = 'Добавь ник';
  }
  for (const acc of accs.list) {
    const item = document.createElement('div');
    item.className = 'combo-item' + (acc.name === accs.selected ? ' selected' : '');
    item.innerHTML = `<span class="dot"></span><span></span>${acc.name === accs.selected ? '' : '<button class="remove-btn" title="Удалить">✕</button>'}`;
    item.children[1].textContent = acc.name;
    item.onclick = async (e) => {
      if (e.target.classList.contains('remove-btn')) return;
      const res = await klim.accounts.select(acc.name);
      if (res.ok) { state.cfg.accounts = res.accounts; renderAccounts(); closeCombos(); }
    };
    const rm = item.querySelector('.remove-btn');
    if (rm) rm.onclick = async (e) => {
      e.stopPropagation();
      const res = await klim.accounts.remove(acc.name);
      state.cfg.accounts = res.accounts;
      renderAccounts();
    };
    list.appendChild(item);
  }
  stagger(list);
  const selected = accs.list.find(a => a.name === accs.selected);
  if (selected) $('#account-label').textContent = selected.name;
  updateAvatar();
}

function updateAvatar() {
  const name = state.cfg.accounts.selected;
  const img = $('#avatar');
  if (!name) { img.src = avatarFallback('K'); return; }
  img.onerror = () => { img.onerror = null; img.src = avatarFallback(name[0].toUpperCase()); };
  img.src = `https://minotar.net/helm/${encodeURIComponent(name)}/64`;
}

// Процедурная аватарка, если нет сети
function avatarFallback(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1230';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#b049ff';
  ctx.font = 'bold 40px Segoe UI';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 32, 34);
  return canvas.toDataURL();
}

$('#account-toggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#account-menu');
  const open = menu.hidden;
  closeCombos();
  menu.hidden = !open;
  $('#account-combo').classList.toggle('open', open);
};
$('#account-add').onclick = () => {
  closeCombos();
  const overlay = modal(`
    <h3>Добавить ник</h3>
    <input class="text-input" id="modal-nick" placeholder="Ник (2–16 символов)" maxlength="16" />
    <div class="modal-actions">
      <button class="mini-btn" id="modal-cancel">Отмена</button>
      <button class="mini-btn" id="modal-ok">Добавить</button>
    </div>`);
  $('#modal-nick').focus();
  $('#modal-cancel').onclick = closeModal;
  const submit = async () => {
    const res = await klim.accounts.add($('#modal-nick').value.trim());
    if (!res.ok) { toast(res.error, 'error'); return; }
    state.cfg.accounts = res.accounts;
    await klim.settings.set({ accounts: res.accounts });
    renderAccounts();
    closeModal();
    toast('Ник добавлен', 'ok');
  };
  $('#modal-ok').onclick = submit;
  $('#modal-nick').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
};

/* ---------- Версии ---------- */
const TYPE_LABEL = {
  release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Бета', old_alpha: 'Альфа', custom: 'Своя',
};

async function loadVersions() {
  try {
    state.versions = await klim.versions.list({ releases: true, snapshots: true, oldBeta: true, oldAlpha: true, experimental: true });
  } catch (e) {
    toast('Не удалось загрузить список версий: ' + e.message, 'error');
    return;
  }
  const local = await klim.versions.local();
  state.installed = new Set(local);
  // выбранная версия по умолчанию: последняя используемая → последний релиз
  const cfgMc = state.cfg.lastVersionId;
  let fallback = null;
  for (const v of state.versions) if (v.type === 'release') { fallback = v.id; break; } // манифест отсортирован от новых
  state.selectedMc = cfgMc ? (require0(cfgMc)) : fallback;
  renderMcList();
  await loadLoaderOptions();
}

function require0(lastVersionId) {
  // из составного id (fabric-loader-x-1.20.1 / forge-1.20.1-x) достаём базовую версию
  const f = /^fabric-loader-([^-]+)-(.+)$/.exec(lastVersionId);
  if (f) return f[2];
  const g = /^forge-(.+)$/.exec(lastVersionId);
  if (g) { const rest = g[1]; const d = rest.indexOf('-'); if (d > 0) return rest.slice(0, d); }
  return lastVersionId;
}

function renderMcList(filter = '') {
  const list = $('#mc-list');
  list.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const sorted = [...state.versions].sort((a, b) => {
    const t = (x) => (x.type === 'release' ? 0 : x.type === 'snapshot' ? 1 : 2);
    return t(a) - t(b) || (b.releaseTime || '').localeCompare(a.releaseTime || '');
  });
  let shown = 0;
  for (const v of sorted) {
    if (shown >= 400) break;
    if (q && !v.id.toLowerCase().includes(q)) continue;
    shown++;
    const item = document.createElement('div');
    item.className = 'combo-item' + (v.id === state.selectedMc ? ' selected' : '');
    item.innerHTML = `
      ${state.installed.has(v.id) ? '<span class="dot" title="Установлена"></span>' : ''}
      <span></span>
      <span class="badge">${TYPE_LABEL[v.type] || v.type}</span>`;
    item.children[state.installed.has(v.id) ? 1 : 0].textContent = v.id;
    item.onclick = async () => {
      state.selectedMc = v.id;
      $('#mc-label').textContent = v.id;
      closeCombos();
      await loadLoaderOptions();
      renderMcList($('#mc-search').value);
    };
    list.appendChild(item);
  }
  if (!q) stagger(list);
  if (!shown) list.innerHTML = '<div class="combo-item">Ничего не найдено</div>';
}

$('#mc-toggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#mc-menu');
  const open = menu.hidden;
  closeCombos();
  menu.hidden = !open;
  $('#version-combo').classList.toggle('open', open);
  if (open) { $('#mc-search').value = ''; renderMcList(); $('#mc-search').focus(); }
};
$('#mc-search').oninput = (e) => renderMcList(e.target.value);

async function loadLoaderOptions() {
  $('#loader-label').textContent = 'Загрузка…';
  try {
    state.loaderOptions = await klim.versions.loadersFor(state.selectedMc);
  } catch {
    state.loaderOptions = [{ kind: 'vanilla', id: state.selectedMc, label: 'Без модификаций' }];
  }
  const saved = state.cfg.lastVersionId;
  const prev = state.loaderOptions.find(o => o.id === saved);
  state.selectedLoader = prev || state.loaderOptions[0];
  $('#loader-label').textContent = state.selectedLoader ? state.selectedLoader.label : 'Без модификаций';
  renderLoaderList();
}

function renderLoaderList() {
  const list = $('#loader-list');
  list.innerHTML = '';
  for (const opt of state.loaderOptions) {
    const item = document.createElement('div');
    item.className = 'combo-item' + (state.selectedLoader && opt.id === state.selectedLoader.id ? ' selected' : '');
    item.innerHTML = `<span></span><span class="badge">${opt.kind === 'vanilla' ? 'ваниль' : opt.kind}</span>`;
    item.children[0].textContent = opt.label;
    item.onclick = () => {
      state.selectedLoader = opt;
      $('#loader-label').textContent = opt.label;
      closeCombos();
      renderLoaderList();
    };
    list.appendChild(item);
  }
  stagger(list);
}

$('#loader-toggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#loader-menu');
  const open = menu.hidden;
  closeCombos();
  menu.hidden = !open;
  $('#loader-combo').classList.toggle('open', open);
  if (open) renderLoaderList();
};

/* ---------- Чекбоксы панели ---------- */
$('#chk-deferred').onchange = (e) => klim.settings.set({ deferredLaunch: e.target.checked });
$('#chk-refresh').onchange = (e) => klim.settings.set({ refreshClient: e.target.checked });

/* ---------- Запуск ---------- */
$('#btn-play').onclick = async () => {
  if (state.launching) return;
  const account = state.cfg.accounts.selected;
  if (!account) { toast('Сначала добавь ник', 'error'); $('#account-toggle').click(); return; }
  if (!state.selectedMc) { toast('Не выбрана версия', 'error'); return; }

  const versionId = state.selectedLoader ? state.selectedLoader.id : state.selectedMc;
  await klim.settings.set({ lastVersionId: versionId });

  if ($('#chk-deferred').checked) {
    startDeferredCountdown(versionId);
  } else {
    doLaunch(versionId);
  }
};

function startDeferredCountdown(versionId) {
  let left = 30;
  const overlay = modal(`
    <h3>Отложенный запуск</h3>
    <p>Игра запустится через <b id="defer-sec">30</b> с.</p>
    <div class="modal-actions">
      <button class="mini-btn" id="defer-cancel">Запустить сейчас</button>
      <button class="mini-btn danger" id="defer-stop">Отменить</button>
    </div>`);
  const timer = setInterval(() => {
    left--;
    const el = $('#defer-sec');
    if (el) el.textContent = left;
    if (left <= 0) { clearInterval(timer); closeModal(); doLaunch(versionId); }
  }, 1000);
  $('#defer-cancel').onclick = () => { clearInterval(timer); closeModal(); doLaunch(versionId); };
  $('#defer-stop').onclick = () => { clearInterval(timer); closeModal(); };
}

async function doLaunch(versionId) {
  state.launching = true;
  const btn = $('#btn-play');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner"></span><span>Подготовка…</span>';
  try {
    const res = await klim.launch.start({ versionId, refresh: $('#chk-refresh').checked });
    if (!res.ok) {
      toast(res.error || 'Не удалось запустить игру', 'error');
    } else {
      toast('Игра запускается. Окно появится через несколько секунд.', 'ok');
    }
  } finally {
    state.launching = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '<span>Запустить</span>';
  }
}

/* ---------- Прогресс ---------- */
let progressVisible = false;
klim.on('progress', (p) => {
  if (!p) return;
  if (!progressVisible) {
    $('#progress-overlay').hidden = false;
    progressVisible = true;
  }
  $('#progress-label').textContent = p.label || 'Работаю…';
  const pct = Math.round((p.percent ?? 0) * 100);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-percent').textContent = pct + '%';
});

klim.on('task', (t) => {
  if (!t) return;
  if (t.kind === 'install') {
    if (t.state === 'done') {
      $('#progress-overlay').hidden = true;
      progressVisible = false;
      toast('Версия установлена', 'ok');
      refreshInstalled();
      if ($('#page-versions').hidden === false) renderVersionsPage();
    } else if (t.state === 'error') {
      $('#progress-overlay').hidden = true;
      progressVisible = false;
      toast('Ошибка установки: ' + t.message, 'error');
    }
  }
  if (t.kind === 'launch' && t.state === 'start') {
    $('#progress-label').textContent = 'Запуск игры…';
  }
  if (t.kind === 'game') {
    if (t.state === 'exit') toast(t.code === 0 ? 'Игра закрыта' : `Игра завершилась (код ${t.code})`, t.code === 0 ? '' : 'error');
    if (t.state === 'error') toast(t.message, 'error');
  }
});
klim.on('confirm:closeDuringInstall', () => {
  toast('Идёт установка. Отмени её перед закрытием лаунчера.', 'error');
});
$('#progress-cancel').onclick = () => {
  klim.install.cancel();
};

/* ---------- Иконки панели ---------- */
$('#ib-folder').onclick = () => klim.fs.open('root');
$('#ib-mods').onclick = () => klim.fs.open('mods');
$('#ib-refresh').onclick = async () => {
  await loadVersions();
  toast('Список версий обновлён', 'ok');
};
$('#ib-info').onclick = () => navigate('settings', 'about');

/* Меню */
$('#ib-menu').onclick = (e) => {
  e.stopPropagation();
  const popup = $('#menu-popup');
  popup.hidden = !popup.hidden;
};
$$('#menu-popup button').forEach(b => {
  b.onclick = () => {
    $('#menu-popup').hidden = true;
    navigate(b.dataset.nav);
  };
});

/* ---------- Навигация по страницам ---------- */
function navigate(page, tab) {
  for (const p of ['play', 'versions', 'settings', 'appearance']) {
    $('#page-' + p).hidden = p !== page;
  }
  if (page === 'versions') renderVersionsPage();
  if (page === 'settings') {
    if (tab) activateTab(tab);
    renderJavaList();
  }
  if (page === 'appearance') renderAppearance();
}

/* ---------- Менеджер версий (страница) ---------- */
const versionFilters = () => ({
  releases: $('#f-releases').checked,
  snapshots: $('#f-snapshots').checked,
  oldBeta: $('#f-oldbeta').checked,
  oldAlpha: $('#f-oldalpha').checked,
  experimental: $('#f-experimental').checked,
});

async function renderVersionsPage() {
  const container = $('#versions-list');
  container.innerHTML = '<div class="combo-item">Загрузка…</div>';
  let all;
  try {
    all = await klim.versions.list(versionFilters());
  } catch (e) {
    container.innerHTML = `<div class="combo-item">Ошибка: ${e.message}</div>`;
    return;
  }
  const local = new Set(await klim.versions.local());
  state.installed = local;
  const q = $('#versions-search').value.trim().toLowerCase();
  if ($('#f-installed').checked) all = all.filter(v => local.has(v.id));
  if (q) all = all.filter(v => v.id.toLowerCase().includes(q));

  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const v of all) {
    const row = document.createElement('div');
    row.className = 'version-row';
    row.innerHTML = `
      <span class="v-type ${v.type}">${TYPE_LABEL[v.type] || v.type}</span>
      <span class="v-name"></span>
      ${local.has(v.id) ? '<span class="v-installed">✓ установлена</span>' : ''}
      <span class="v-date">${v.releaseTime ? v.releaseTime.slice(0, 10) : ''}</span>
      <div class="v-actions"></div>`;
    row.querySelector('.v-name').textContent = v.id;
    const actions = row.querySelector('.v-actions');
    if (local.has(v.id)) {
      const del = document.createElement('button');
      del.className = 'mini-btn danger';
      del.textContent = 'Удалить';
      del.onclick = async () => {
        del.disabled = true;
        const ok = await klim.versions.remove(v.id);
        if (ok) { toast('Версия удалена', 'ok'); local.delete(v.id); renderVersionsPage(); }
      };
      actions.appendChild(del);
    } else {
      const inst2 = document.createElement('button');
      inst2.className = 'mini-btn';
      inst2.textContent = 'Установить';
      inst2.onclick = async () => {
        inst2.disabled = true;
        inst2.textContent = 'Скачивается…';
        const res = await klim.versions.install(v.id);
        if (res.ok) { inst2.textContent = '✓'; renderVersionsPage(); }
        else inst2.disabled = false;
      };
      actions.appendChild(inst2);
    }
    frag.appendChild(row);
  }
  container.appendChild(frag);
  if (!q) stagger(container);
}
$$('#page-versions .filters input').forEach(cb => cb.onchange = renderVersionsPage);
$('#versions-search').oninput = renderVersionsPage;

/* ---------- Настройки ---------- */
function activateTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-page').forEach(p => p.hidden = p.id !== 'tab-' + name);
}
$$('.tab').forEach(t => t.onclick = () => activateTab(t.dataset.tab));

function bindSettings() {
  const cfg = state.cfg;
  const set = (patch) => klim.settings.set(patch);

  $('#s-gameDir').value = cfg.gameDir;
  $('#s-gameDir-browse').onclick = async () => {
    const dir = await klim.dialog.pickFolder();
    if (dir) { $('#s-gameDir').value = dir; set({ gameDir: dir }); toast('Папка игры изменена', 'ok'); }
  };
  $('#s-gameDir-open').onclick = () => klim.fs.open('root');

  $('#s-winW').value = cfg.windowSize.width;
  $('#s-winH').value = cfg.windowSize.height;
  const saveWin = () => set({ windowSize: { width: +$('#s-winW').value || 960, height: +$('#s-winH').value || 560 } });
  $('#s-winW').onchange = saveWin;
  $('#s-winH').onchange = saveWin;

  $('#s-fullscreen').checked = cfg.forceFullscreen;
  $('#s-fullscreen').onchange = (e) => set({ forceFullscreen: e.target.checked });

  $('#s-gpu').value = cfg.gpu;
  $('#s-gpu').onchange = (e) => set({ gpu: e.target.value });

  $('#s-subfolders').checked = cfg.subfoldersPerVersion;
  $('#s-subfolders').onchange = (e) => set({ subfoldersPerVersion: e.target.checked });

  $('#s-closeafter').checked = cfg.closeAfterLaunch;
  $('#s-closeafter').onchange = (e) => set({ closeAfterLaunch: e.target.checked });

  $('#s-animations').checked = cfg.appearance.animations !== false;
  $('#s-animations').onchange = (e) => {
    set({ appearance: { animations: e.target.checked } }).then(applyAppearance);
  };

  $('#s-configpath').textContent = 'Файл конфигурации: ' + (state.info.configPath || '');
  $('#s-openconfig').onclick = () => klim.fs.open('config');

  // память
  $('#s-mem').value = cfg.memory.mb;
  $('#s-mem-num').value = cfg.memory.mb;
  $('#s-mem-auto').checked = cfg.memory.auto;
  const saveMem = (v) => {
    v = Math.max(1024, Math.min(16384, +v || 4096));
    $('#s-mem').value = v; $('#s-mem-num').value = v;
    set({ memory: { mb: v, auto: $('#s-mem-auto').checked } });
  };
  $('#s-mem').oninput = (e) => saveMem(e.target.value);
  $('#s-mem-num').onchange = (e) => saveMem(e.target.value);
  $('#s-mem-auto').onchange = (e) => {
    $('#s-mem').disabled = e.target.checked;
    $('#s-mem-num').disabled = e.target.checked;
    set({ memory: { auto: e.target.checked } });
  };
  $('#s-mem').disabled = $('#s-mem-auto').checked;
  $('#s-mem-num').disabled = $('#s-mem-auto').checked;

  // java
  $('#s-java-auto').checked = cfg.java.auto;
  $('#s-java-auto').onchange = (e) => set({ java: { auto: e.target.checked } });
}

async function renderJavaList() {
  const container = $('#java-list');
  container.innerHTML = '<div class="hint">Поиск установленных Java…</div>';
  const javas = await klim.java.list().catch(() => []);
  container.innerHTML = '';
  if (!javas.length) container.innerHTML = '<div class="hint">Установленные Java не найдены — лаунчер скачает нужную автоматически.</div>';
  for (const j of javas) {
    const el = document.createElement('div');
    el.className = 'java-item';
    el.innerHTML = `<span class="jv">Java ${j.version}</span><span class="jp" title="${j.path}"></span>`;
    el.querySelector('.jp').textContent = j.path;
    container.appendChild(el);
  }
  $$('.dl-java-row .mini-btn').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent += '…';
      const res = await klim.java.install(+b.dataset.jre);
      b.disabled = false;
      b.textContent = b.dataset.jre;
      if (res.ok) { toast('Java ' + b.dataset.jre + ' скачана', 'ok'); renderJavaList(); }
      else toast('Ошибка скачивания Java: ' + res.error, 'error');
    };
  });
}

/* ---------- Внешний вид (страница) ---------- */
function renderAppearance() {
  const a = state.cfg.appearance;
  const grid = $('#theme-grid');
  grid.innerHTML = '';
  for (const t of THEMES) {
    const card = document.createElement('div');
    card.className = 'theme-card theme-thumb-' + t.id + (a.theme === t.id ? ' selected' : '');
    card.innerHTML = `<div class="t-name">${t.name}</div>`;
    card.onclick = async () => {
      const res = await klim.settings.set({ appearance: { theme: t.id } });
      state.cfg = res; applyAppearance(res); renderAppearance();
    };
    grid.appendChild(card);
  }
  $('#a-bgpath').value = a.bgImage || '';
  $('#a-dim').value = a.bgDim ?? 0.45;
  $('#a-blur').value = a.bgBlur || 0;

  const accents = $('#accent-row');
  accents.innerHTML = '';
  for (const c of ACCENTS) {
    const dot = document.createElement('div');
    dot.className = 'accent-dot' + (a.accent === c ? ' selected' : '');
    dot.style.background = c;
    dot.onclick = async () => {
      const res = await klim.settings.set({ appearance: { accent: c } });
      state.cfg = res; applyAppearance(res); renderAppearance();
    };
    accents.appendChild(dot);
  }
}

$('#a-bgpick').onclick = async () => {
  const path = await klim.dialog.pickBackground();
  if (!path) return;
  const res = await klim.settings.set({ appearance: { bgImage: path } });
  state.cfg = res; applyAppearance(res); renderAppearance();
  toast('Фон обновлён', 'ok');
};
$('#a-bgclear').onclick = async () => {
  const res = await klim.settings.set({ appearance: { bgImage: null } });
  state.cfg = res; applyAppearance(res); renderAppearance();
};
$('#a-dim').oninput = async (e) => {
  $('#bg-dim').style.setProperty('--bg-dim', e.target.value);
  await klim.settings.set({ appearance: { bgDim: +e.target.value } });
};
$('#a-blur').oninput = async (e) => {
  const custom = $('#bg-custom');
  custom.style.setProperty('--bg-blur', e.target.value + 'px');
  custom.classList.toggle('blurred', +e.target.value > 0);
  await klim.settings.set({ appearance: { bgBlur: +e.target.value } });
};

/* ---------- Карточки главной (полная сборка) ---------- */
async function renderHomeCards() {
  if (state.info.edition === 'lite') return;
  const container = $('#cards-home');
  const local = await klim.versions.local().catch(() => []);
  const cards = [
    { icon: '▶', title: 'Играть', sub: 'Запустить выбранную версию', action: () => $('#btn-play').click() },
    { icon: '🗂', title: 'Менеджер версий', sub: 'Все версии Mojang + мод-лоадеры', action: () => navigate('versions') },
    { icon: '📦', title: `Установлено версий: ${local.length}`, sub: local.slice(0, 3).join(', ') || 'Пока ничего не установлено', action: () => navigate('versions') },
    { icon: '🖼', title: 'Внешний вид', sub: 'Темы, свой фон, акцентный цвет', action: () => navigate('appearance') },
    { icon: '⚙', title: 'Настройки', sub: 'Память, Java, окно, папка игры', action: () => navigate('settings') },
  ];
  container.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'card glass';
    el.innerHTML = `<div class="card-icon">${c.icon}</div><div class="card-title"></div><div class="card-sub"></div>`;
    el.querySelector('.card-title').textContent = c.title;
    el.querySelector('.card-sub').textContent = c.sub;
    el.onclick = c.action;
    bindTilt(el);
    container.appendChild(el);
  }
  stagger(container, ':scope > .card', 60, 500);
}

/* ---------- Старт ---------- */
(async function boot() {
  state.info = await klim.app.info();
  state.cfg = await klim.settings.get();
  document.body.classList.toggle('edition-lite', state.info.edition === 'lite');
  $('#edition-badge').textContent = state.info.edition === 'lite' ? 'Lite' : 'v' + state.info.version;
  $('#about-text').textContent = `Klim Launcher v${state.info.version} (${state.info.edition}) — оффлайн-лаунчер Minecraft с поддержкой Fabric и Forge.`;
  applyAppearance(state.cfg);
  renderAccounts();
  bindSettings();
  await loadVersions();
  await renderHomeCards();
  $('#chk-deferred').checked = !!state.cfg.deferredLaunch;
  $('#chk-refresh').checked = !!state.cfg.refreshClient;
  // Dev-навигация: index.html#versions / #settings / #appearance
  const hash = location.hash.replace('#', '');
  if (['versions', 'settings', 'appearance'].includes(hash)) navigate(hash);
})();
