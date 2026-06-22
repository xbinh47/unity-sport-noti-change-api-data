import './style.css';

const DOMAINS = {
  prod: 'https://api.unik8s.com',
  staging: 'https://opta-api.uniscore.vn',
};
const DEFAULT_ENDPOINT = {
  prod: '/api/v2/football/event/{match_id}/shotmap?language={language}',
  staging: '/api/v2/football/event/{match_id}/shotmap?language={language}',
};
// default value per variable, per env
const VAR_DEFAULTS = {
  prod: { match_id: 'mx7a61lr8ggxwi4', language: 'en-GB' },
  staging: { match_id: '54cvbml38l5avp4', language: 'en-GB' },
};

const $ = (id) => document.getElementById(id);
const els = {
  envSeg: $('envSeg'),
  notifySeg: $('notifySeg'),
  domain: $('domain'),
  endpoint: $('endpoint'),
  varsField: $('varsField'),
  vars: $('vars'),
  interval: $('interval'),
  fullUrl: $('fullUrl'),
  startBtn: $('startBtn'),
  stopBtn: $('stopBtn'),
  pollOnceBtn: $('pollOnceBtn'),
  status: $('status'),
  wakeLock: $('wakeLock'),
  permBadge: $('permBadge'),
  notiBanner: $('notiBanner'),
  nbTitle: $('nbTitle'),
  nbDesc: $('nbDesc'),
  nbBtn: $('nbBtn'),
  counter: $('counter'),
  nextIn: $('nextIn'),
  log: $('log'),
};

// --- segmented control state ---
const state = { env: 'prod', notifyMode: 'change', vars: {} };
function setSeg(seg, attr, value) {
  [...seg.querySelectorAll('.seg-btn')].forEach((b) =>
    b.classList.toggle('active', b.dataset[attr] === value)
  );
}
function syncSegUI() {
  setSeg(els.envSeg, 'env', state.env);
  setSeg(els.notifySeg, 'mode', state.notifyMode);
}

// --- persisted settings ---
const LS = 'api-poller-settings';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS));
    if (!s) return;
    state.env = s.env ?? 'prod';
    state.notifyMode = s.notifyMode ?? 'change';
    state.vars = s.vars ?? {};
    els.domain.value = s.domain ?? '';
    els.endpoint.value = s.endpoint ?? '';
    els.interval.value = s.interval ?? 30;
  } catch {}
}
function saveSettings() {
  localStorage.setItem(LS, JSON.stringify({
    env: state.env,
    domain: els.domain.value,
    endpoint: els.endpoint.value,
    interval: els.interval.value,
    notifyMode: state.notifyMode,
    vars: state.vars,
  }));
}

function applyEnvDefaults() {
  const env = state.env;
  els.domain.value = DOMAINS[env];
  els.endpoint.value = DEFAULT_ENDPOINT[env];
  state.vars = { ...VAR_DEFAULTS[env] };
  renderVars();
  updateUrl();
}

// extract {tokens} from endpoint template, in order, unique
function parseVars() {
  const names = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(els.endpoint.value)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// render one input per template variable
function renderVars() {
  const names = parseVars();
  els.varsField.hidden = names.length === 0;
  els.vars.innerHTML = '';
  for (const name of names) {
    if (state.vars[name] === undefined) state.vars[name] = VAR_DEFAULTS[state.env]?.[name] ?? '';
    const wrap = document.createElement('div');
    wrap.className = 'var-row';
    const tag = document.createElement('span');
    tag.className = 'var-key';
    tag.textContent = name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = state.vars[name];
    input.placeholder = name;
    input.addEventListener('input', () => {
      state.vars[name] = input.value;
      updateUrl();
      saveSettings();
    });
    wrap.append(tag, input);
    els.vars.append(wrap);
  }
}

function buildUrl() {
  const d = els.domain.value.replace(/\/+$/, '');
  let e = els.endpoint.value.startsWith('/') ? els.endpoint.value : '/' + els.endpoint.value;
  e = e.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) =>
    encodeURIComponent(state.vars[name] ?? '')
  );
  return d + e;
}
function updateUrl() {
  els.fullUrl.textContent = buildUrl();
}

function log(msg, cls = '') {
  const empty = els.log.querySelector('.log-empty');
  if (empty) empty.remove();
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-line ' + cls;
  div.textContent = `[${time}] ${msg}`;
  els.log.prepend(div);
  while (els.log.children.length > 200) els.log.removeChild(els.log.lastChild);
}

// --- notifications ---
async function ensureNotifyPermission() {
  if (!('Notification' in window)) {
    log('Notification API not supported in this browser', 'err');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    log('Notifications blocked. Click the 🔒 in the address bar → Notifications → Allow, then reload.', 'err');
    return false;
  }
  // permission === 'default' → native browser prompt (must be from a user gesture)
  log('Requesting notification permission…');
  const p = await Notification.requestPermission();
  updatePermBadge();
  if (p === 'granted') {
    log('Notifications enabled ✓', 'ok');
    new Notification('Notifications enabled', { body: 'You will be alerted when data changes.' });
    return true;
  }
  log('Permission ' + p + ' — running in log-only mode.', 'err');
  return false;
}
function updatePermBadge() {
  const p = ('Notification' in window) ? Notification.permission : 'unsupported';
  els.permBadge.textContent = 'noti: ' + p;
  els.permBadge.className = 'badge ' + (p === 'granted' ? 'ok' : 'warn');
  updateBanner(p);
}
function updateBanner(p) {
  const b = els.notiBanner;
  if (p === 'granted') { b.hidden = true; return; }
  b.hidden = false;
  if (p === 'unsupported') {
    b.className = 'noti-banner err';
    els.nbTitle.textContent = 'Notifications not supported';
    els.nbDesc.textContent = 'This browser has no Notification API.';
    els.nbBtn.hidden = true;
    return;
  }
  if (p === 'denied') {
    b.className = 'noti-banner err';
    els.nbTitle.textContent = 'Notifications blocked';
    els.nbDesc.textContent = 'Click the 🔒 (or ⚙️) in the address bar → Notifications → Allow, then reload this page.';
    els.nbBtn.hidden = false;
    els.nbBtn.textContent = 'Reload';
    return;
  }
  // default
  b.className = 'noti-banner';
  els.nbTitle.textContent = 'Enable notifications';
  els.nbDesc.textContent = 'Get an alert when the data changes — even when this tab is in the background.';
  els.nbBtn.hidden = false;
  els.nbBtn.textContent = '🔔 Enable';
}
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: 'api-poller', renotify: true });
  } catch (e) {
    log('notify failed: ' + e.message, 'err');
  }
}

// --- wake lock (best-effort; only holds while tab visible) ---
let wakeLockSentinel = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    els.wakeLock.textContent = 'wakelock: n/a';
    els.wakeLock.className = 'badge warn';
    return;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    els.wakeLock.textContent = 'wakelock: on';
    els.wakeLock.className = 'badge ok';
    wakeLockSentinel.addEventListener('release', () => {
      els.wakeLock.textContent = 'wakelock: released';
      els.wakeLock.className = 'badge warn';
    });
  } catch (e) {
    els.wakeLock.textContent = 'wakelock: fail';
    els.wakeLock.className = 'badge warn';
  }
}
function releaseWakeLock() {
  if (wakeLockSentinel) { wakeLockSentinel.release().catch(() => {}); wakeLockSentinel = null; }
  els.wakeLock.textContent = '';
  els.wakeLock.className = 'badge';
}
// re-acquire wake lock when tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && !wakeLockSentinel) requestWakeLock();
});

// --- polling via worker ---
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let running = false;
let pollCount = 0;
let lastHash = null;
let nextTimer = null;
let nextAt = 0;

worker.onmessage = (e) => {
  if (e.data.type === 'tick') poll();
};

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return h;
}

async function poll() {
  const url = buildUrl();
  pollCount++;
  els.counter.textContent = `polls: ${pollCount}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) {
      log(`HTTP ${res.status} — ${text.slice(0, 200)}`, 'err');
      notify('API error', `HTTP ${res.status}`);
      return;
    }
    const h = hash(text);
    const changed = lastHash !== null && h !== lastHash;
    const mode = state.notifyMode;
    if (lastHash === null) {
      log(`first response (${text.length} bytes)`, 'ok');
    } else if (changed) {
      log(`DATA CHANGED (${text.length} bytes)`, 'change');
      notify('Data changed', url);
    } else {
      log(`no change (${text.length} bytes)`, '');
    }
    if (mode === 'always' && lastHash !== null && !changed) {
      notify('Polled (no change)', url);
    }
    lastHash = h;
  } catch (e) {
    log('fetch failed: ' + e.message, 'err');
    notify('Fetch failed', e.message);
  }
}

function startCountdown() {
  clearInterval(nextTimer);
  const intervalMs = Math.max(1, Number(els.interval.value)) * 1000;
  nextAt = Date.now() + intervalMs;
  nextTimer = setInterval(() => {
    const s = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    els.nextIn.textContent = `next: ${s}s`;
    if (s === 0) nextAt = Date.now() + intervalMs;
  }, 250);
}

async function start() {
  if (running) return;
  // flip UI + start polling immediately so it's obvious it's running.
  // permission prompt + wake lock run in parallel, NOT blocking the start.
  saveSettings();
  running = true;
  pollCount = 0;
  lastHash = null;
  els.status.textContent = '● running';
  els.status.className = 'badge ok';
  els.startBtn.disabled = true;
  els.startBtn.textContent = '● Running…';
  els.stopBtn.disabled = false;
  const intervalMs = Math.max(1, Number(els.interval.value)) * 1000;
  log(`▶ started — polling every ${intervalMs / 1000}s`, 'ok');
  worker.postMessage({ cmd: 'start', intervalMs });
  startCountdown();
  ensureNotifyPermission(); // async, non-blocking
  requestWakeLock();
}

function stop() {
  if (!running) return;
  running = false;
  worker.postMessage({ cmd: 'stop' });
  clearInterval(nextTimer);
  releaseWakeLock();
  els.status.textContent = '● idle';
  els.status.className = 'badge idle';
  els.startBtn.disabled = false;
  els.startBtn.textContent = '▶ Start';
  els.stopBtn.disabled = true;
  els.nextIn.textContent = '';
  log('■ stopped');
}

// --- wire up ---
els.envSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.env = btn.dataset.env;
  syncSegUI();
  applyEnvDefaults();
  saveSettings();
});
els.notifySeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.notifyMode = btn.dataset.mode;
  syncSegUI();
  saveSettings();
});
els.domain.addEventListener('input', () => { updateUrl(); saveSettings(); });
els.endpoint.addEventListener('input', () => { renderVars(); updateUrl(); saveSettings(); });
els.interval.addEventListener('input', saveSettings);
els.nbBtn.addEventListener('click', async () => {
  if (Notification.permission === 'denied') { location.reload(); return; }
  await ensureNotifyPermission(); // shows native prompt when state is 'default'
});
els.startBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', stop);
els.pollOnceBtn.addEventListener('click', async () => { await ensureNotifyPermission(); poll(); });

loadSettings();
syncSegUI();
if (!els.domain.value) applyEnvDefaults();
else { renderVars(); updateUrl(); }
updatePermBadge();
