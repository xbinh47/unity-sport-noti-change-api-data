import './xg.css';

const DOMAINS = {
  prod: 'https://api.unik8s.com',
  staging: 'https://opta-api.uniscore.vn',
};

// status.type values from uni-football-api
const LIVE_TYPES = new Set(['inprogress']);
const FINISHED_TYPES = new Set(['finished']);

const state = { env: 'staging' };
// Web Worker handles poll timers — not throttled on hidden tabs
const pollWorker = new Worker(new URL('./xg-worker.js', import.meta.url), { type: 'module' });
pollWorker.onmessage = (e) => {
  if (e.data.type === 'tick') refreshLive(e.data.eventId);
};
const timers = {};         // eventId → true (just tracks active)
const countdowns = {};     // eventId → { timer, nextAt }
const panels = {};         // eventId → panelEl

const POLL_MS = 10_000;

function startCountdown(eventId) {
  stopCountdown(eventId);
  countdowns[eventId] = { nextAt: Date.now() + POLL_MS };
  countdowns[eventId].timer = setInterval(() => {
    const cd = countdowns[eventId];
    if (!cd) return;
    const remaining = Math.max(0, cd.nextAt - Date.now());
    const pct = (remaining / POLL_MS) * 100;
    const bar = document.getElementById('pbar-' + eventId);
    const txt = document.getElementById('pcd-' + eventId);
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = `↻ ${Math.ceil(remaining / 1000)}s`;
    if (remaining === 0) cd.nextAt = Date.now() + POLL_MS;
  }, 100);
}
function stopCountdown(eventId) {
  if (countdowns[eventId]?.timer) clearInterval(countdowns[eventId].timer);
  delete countdowns[eventId];
  const bar = document.getElementById('pbar-' + eventId);
  const txt = document.getElementById('pcd-' + eventId);
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '';
}
function flashPanel(eventId) {
  const wrap = document.getElementById('ptable-' + eventId);
  if (!wrap) return;
  wrap.classList.remove('flash');
  void wrap.offsetWidth; // reflow
  wrap.classList.add('flash');
}

// --- env seg ---
const envSeg = document.getElementById('envSeg');
envSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.env = btn.dataset.env;
  [...envSeg.querySelectorAll('.seg-btn')].forEach(b =>
    b.classList.toggle('active', b.dataset.env === state.env));
});

// --- check button ---
const matchInput = document.getElementById('matchInput');
const checkBtn = document.getElementById('checkBtn');

checkBtn.addEventListener('click', () => {
  const id = matchInput.value.trim();
  if (!id) return;
  matchInput.value = '';
  loadMatch(id);
});
matchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkBtn.click();
});

function removeId(id) {
  pollWorker.postMessage({ cmd: 'stop', eventId: id });
  stopCountdown(id);
  panels[id]?.remove();
  delete panels[id];
  delete timers[id];
}

// --- main load ---
function domain() { return DOMAINS[state.env]; }
function eventUrl(id) { return `${domain()}/api/v2/football/event/${id}?language=en-GB`; }
function shotmapUrl(id) { return `${domain()}/api/v2/football/event/${id}/shotmap?language=en-GB`; }

async function loadMatch(eventId) {
  // upsert panel
  let panel = panels[eventId];
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'panel-' + eventId;
    panel.className = 'card match-panel loading';
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <span class="live-dot hidden" id="dot-${eventId}"></span>
          <strong id="ptitle-${eventId}">Loading…</strong>
          <span class="status-badge" id="pstatus-${eventId}"></span>
          <span class="cd-badge" id="pcd-${eventId}"></span>
        </div>
        <div class="panel-actions">
          <span class="panel-meta" id="pmeta-${eventId}"></span>
          <button class="remove-btn" data-id="${eventId}" title="Remove">✕</button>
        </div>
      </div>
      <div class="progress-track" id="ptrack-${eventId}"><div class="progress-bar" id="pbar-${eventId}" style="width:0%"></div></div>
      <div class="score-row" id="pscore-${eventId}"></div>
      <div id="ptable-${eventId}" class="xg-wrap"><div class="loading-msg">Fetching…</div></div>
    `;
    panel.querySelector('.remove-btn').addEventListener('click', (e) => removeId(e.target.dataset.id));
    document.getElementById('panels').prepend(panel);
    panels[eventId] = panel;
  }

  try {
    const res = await fetch(eventUrl(eventId), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const ev = json.data?.event ?? json.event ?? json.data ?? json;

    const home = ev.homeTeam?.name ?? '?';
    const away = ev.awayTeam?.name ?? '?';
    const homeShort = ev.homeTeam?.shortName ?? home;
    const awayShort = ev.awayTeam?.shortName ?? away;
    const statusType = ev.status?.type ?? '';  // "inprogress" | "finished" | "not_started" | ...
    const statusDesc = ev.status?.description ?? statusType;
    const isLive = LIVE_TYPES.has(statusType);
    const isFinished = FINISHED_TYPES.has(statusType);
    const homeScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '–';
    const awayScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '–';
    const minute = ev.time?.played ?? ev.time?.minutes ?? null;

    document.getElementById('ptitle-' + eventId).textContent = `${home} vs ${away}`;

    const dot = document.getElementById('dot-' + eventId);
    dot.classList.toggle('hidden', !isLive);

    const statusBadge = document.getElementById('pstatus-' + eventId);
    const badgeText = isLive ? (minute ? `${minute}'` : 'LIVE')
      : isFinished ? 'FT'
      : statusDesc || statusType;
    statusBadge.textContent = badgeText;
    statusBadge.className = 'status-badge ' + (isLive ? 'live' : isFinished ? 'ft' : 'ns');

    document.getElementById('pscore-' + eventId).innerHTML =
      `<span class="team home">${homeShort}</span>` +
      `<span class="score-num">${homeScore} – ${awayScore}</span>` +
      `<span class="team away">${awayShort}</span>`;

    const comp = ev.tournament?.name ?? ev.season?.tournament?.name ?? '';
    const season = ev.season?.year ?? '';
    document.getElementById('pmeta-' + eventId).textContent =
      [comp, season].filter(Boolean).join(' · ');

    panel.classList.remove('loading');

    // fetch shotmap once
    await fetchShotmap(eventId);

    // interval only when live
    pollWorker.postMessage({ cmd: 'stop', eventId });
    if (isLive) {
      pollWorker.postMessage({ cmd: 'start', eventId, intervalMs: POLL_MS });
      timers[eventId] = true;
      startCountdown(eventId);
    } else {
      delete timers[eventId];
      stopCountdown(eventId);
    }
  } catch (e) {
    document.getElementById('ptitle-' + eventId).textContent = `Error loading ${eventId}`;
    document.getElementById('ptable-' + eventId).innerHTML =
      `<div class="no-data err">${e.message}</div>`;
    panel.classList.remove('loading');
  }

}

async function refreshLive(eventId) {
  try {
    const res = await fetch(eventUrl(eventId), { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const ev = json.data?.event ?? json.event ?? json.data ?? json;
    const statusType = ev.status?.type ?? '';
    const isLive = LIVE_TYPES.has(statusType);
    const isFinished = FINISHED_TYPES.has(statusType);
    const minute = ev.time?.played ?? ev.time?.minutes ?? null;

    const dot = document.getElementById('dot-' + eventId);
    if (dot) dot.classList.toggle('hidden', !isLive);

    const badge = document.getElementById('pstatus-' + eventId);
    if (badge) {
      badge.textContent = isLive ? (minute ? `${minute}'` : 'LIVE') : isFinished ? 'FT' : (ev.status?.description ?? statusType);
      badge.className = 'status-badge ' + (isLive ? 'live' : isFinished ? 'ft' : 'ns');
    }

    const homeScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '–';
    const awayScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '–';
    const homeShort = ev.homeTeam?.shortName ?? ev.homeTeam?.name ?? '?';
    const awayShort = ev.awayTeam?.shortName ?? ev.awayTeam?.name ?? '?';
    const scoreEl = document.getElementById('pscore-' + eventId);
    if (scoreEl) scoreEl.innerHTML =
      `<span class="team home">${homeShort}</span>` +
      `<span class="score-num">${homeScore} – ${awayScore}</span>` +
      `<span class="team away">${awayShort}</span>`;

    if (!isLive) {
      pollWorker.postMessage({ cmd: 'stop', eventId });
      delete timers[eventId];
      stopCountdown(eventId);
    } else {
      // reset countdown on each tick so it stays accurate
      if (countdowns[eventId]) countdowns[eventId].nextAt = Date.now() + 10_000;
    }
  } catch {}
  await fetchShotmap(eventId);
}

async function fetchShotmap(eventId) {
  const wrap = document.getElementById('ptable-' + eventId);
  if (!wrap) return;
  try {
    const res = await fetch(shotmapUrl(eventId), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const shots = Array.isArray(json) ? json
      : Array.isArray(json.shotmap) ? json.shotmap
      : Array.isArray(json.data?.shotmap) ? json.data.shotmap
      : Array.isArray(json.data) ? json.data : [];

    if (!shots.length) {
      wrap.innerHTML = '<div class="no-data">No shots recorded.</div>';
      return;
    }

    const byPlayer = {};
    for (const shot of shots) {
      const pid = shot.player?.id ?? shot.playerId ?? 'unknown';
      if (!byPlayer[pid]) {
        byPlayer[pid] = {
          name: shot.player?.name ?? pid,
          shortName: shot.player?.shortName ?? shot.player?.name ?? pid,
          position: shot.player?.position ?? '',
          isHome: shot.isHome,
          shots: 0, goals: 0, xg: 0, xgot: 0,
        };
      }
      const p = byPlayer[pid];
      p.shots++;
      p.xg += parseFloat(shot.xg ?? 0);
      p.xgot += parseFloat(shot.xgot ?? 0);
      if (shot.shotType === 'goal') p.goals++;
    }

    const allRanked = Object.values(byPlayer).sort((a, b) => b.xg - a.xg);
    const home = allRanked.filter(p => p.isHome);
    const away = allRanked.filter(p => !p.isHome);

    function teamTable(players, side) {
      const tot = {
        shots: players.reduce((s, p) => s + p.shots, 0),
        goals: players.reduce((s, p) => s + p.goals, 0),
        xg: players.reduce((s, p) => s + p.xg, 0),
        xgot: players.reduce((s, p) => s + p.xgot, 0),
      };
      return `
        <table class="xg-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${side === 'home' ? 'Home' : 'Away'}</th>
              <th class="n">Sh</th>
              <th class="n">G</th>
              <th class="n hi">xG</th>
              <th class="n">xGOT</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p, i) => `
              <tr class="${side}-row">
                <td class="rank">${i + 1}</td>
                <td class="pcell">
                  <span class="pname">${p.shortName}</span>
                  <span class="pmeta">${p.position}</span>
                </td>
                <td class="n">${p.shots}</td>
                <td class="n">${p.goals}</td>
                <td class="n hi">${p.xg.toFixed(2)}</td>
                <td class="n">${p.xgot.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="total-lbl">${players.length} players · ${tot.shots} sh</td>
              <td class="n">${tot.shots}</td>
              <td class="n">${tot.goals}</td>
              <td class="n hi">${tot.xg.toFixed(2)}</td>
              <td class="n">${tot.xgot.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      `;
    }

    wrap.innerHTML = `
      <div class="tables-grid">
        <div class="team-table-wrap">${teamTable(home, 'home')}</div>
        <div class="team-table-wrap">${teamTable(away, 'away')}</div>
      </div>
      <div class="updated">Updated ${new Date().toLocaleTimeString()}</div>
    `;
    flashPanel(eventId);
  } catch (e) {
    wrap.innerHTML = `<div class="no-data err">Shotmap error: ${e.message}</div>`;
  }
}

