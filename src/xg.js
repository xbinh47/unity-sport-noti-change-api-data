import './xg.css';

const DOMAINS = {
  prod: 'https://api.unik8s.com',
  staging: 'https://opta-api.uniscore.vn',
};

const state = { env: 'staging' };
const timers = {}; // eventId → intervalId

// --- env seg ---
const envSeg = document.getElementById('envSeg');
envSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.env = btn.dataset.env;
  [...envSeg.querySelectorAll('.seg-btn')].forEach(b =>
    b.classList.toggle('active', b.dataset.env === state.env)
  );
});

document.getElementById('loadBtn').addEventListener('click', () => {
  const ids = [
    document.getElementById('match1').value.trim(),
    document.getElementById('match2').value.trim(),
  ].filter(Boolean);
  ids.forEach(loadMatch);
});

// auto-load match1 on page load
window.addEventListener('DOMContentLoaded', () => {
  const id = document.getElementById('match1').value.trim();
  if (id) loadMatch(id);
});

function domain() { return DOMAINS[state.env]; }

function eventUrl(id) { return `${domain()}/api/v2/football/event/${id}?language=en-GB`; }
function shotmapUrl(id) { return `${domain()}/api/v2/football/event/${id}/shotmap?language=en-GB`; }

async function loadMatch(eventId) {
  const panels = document.getElementById('panels');

  // upsert panel
  let panel = document.getElementById('panel-' + eventId);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'panel-' + eventId;
    panel.className = 'card match-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <span class="live-dot hidden" id="dot-${eventId}"></span>
          <strong id="title-${eventId}">Loading…</strong>
          <span class="status-badge" id="status-${eventId}"></span>
        </div>
        <div class="panel-meta" id="meta-${eventId}"></div>
      </div>
      <div class="score-row" id="score-${eventId}"></div>
      <div id="table-${eventId}" class="xg-wrap"><div class="loading-msg">Fetching shotmap…</div></div>
    `;
    panels.appendChild(panel);
  }

  // fetch event info
  try {
    const res = await fetch(eventUrl(eventId), { cache: 'no-store' });
    const json = await res.json();
    const ev = json.event ?? json;

    const home = ev.homeTeam?.name ?? ev.homeTeam?.shortName ?? '?';
    const away = ev.awayTeam?.name ?? ev.awayTeam?.shortName ?? '?';
    const homeShort = ev.homeTeam?.shortName ?? home;
    const awayShort = ev.awayTeam?.shortName ?? away;
    const statusType = ev.status?.type ?? ev.statusType ?? '';
    const isLive = statusType === 'inprogress';
    const isFinished = statusType === 'finished';
    const homeScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '–';
    const awayScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '–';
    const minute = ev.time?.played ?? ev.time?.minutes ?? null;

    document.getElementById('title-' + eventId).textContent = `${home} vs ${away}`;

    const dot = document.getElementById('dot-' + eventId);
    dot.classList.toggle('hidden', !isLive);

    const statusBadge = document.getElementById('status-' + eventId);
    statusBadge.textContent = isLive ? (minute ? `${minute}'` : 'LIVE') : isFinished ? 'FT' : statusType;
    statusBadge.className = 'status-badge ' + (isLive ? 'live' : isFinished ? 'ft' : 'ns');

    document.getElementById('score-' + eventId).innerHTML =
      `<span class="team home">${homeShort}</span>` +
      `<span class="score">${homeScore} – ${awayScore}</span>` +
      `<span class="team away">${awayShort}</span>`;

    document.getElementById('meta-' + eventId).textContent =
      ev.tournament?.name ? ev.tournament.name + (ev.season?.name ? ' · ' + ev.season.name : '') : '';

    // fetch shotmap
    await fetchShotmap(eventId);

    // poll every 10s only if live
    clearInterval(timers[eventId]);
    if (isLive) {
      timers[eventId] = setInterval(() => refreshLive(eventId), 10_000);
    }
  } catch (e) {
    document.getElementById('title-' + eventId).textContent = `Error: ${e.message}`;
  }
}

async function refreshLive(eventId) {
  // re-check status + refresh shotmap
  try {
    const res = await fetch(eventUrl(eventId), { cache: 'no-store' });
    const json = await res.json();
    const ev = json.event ?? json;
    const statusType = ev.status?.type ?? ev.statusType ?? '';
    const isLive = statusType === 'inprogress';
    const minute = ev.time?.played ?? ev.time?.minutes ?? null;

    const dot = document.getElementById('dot-' + eventId);
    if (dot) dot.classList.toggle('hidden', !isLive);

    const statusBadge = document.getElementById('status-' + eventId);
    if (statusBadge) {
      const isFinished = statusType === 'finished';
      statusBadge.textContent = isLive ? (minute ? `${minute}'` : 'LIVE') : isFinished ? 'FT' : statusType;
      statusBadge.className = 'status-badge ' + (isLive ? 'live' : isFinished ? 'ft' : 'ns');
    }

    const homeScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '–';
    const awayScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '–';
    const homeShort = ev.homeTeam?.shortName ?? ev.homeTeam?.name ?? '?';
    const awayShort = ev.awayTeam?.shortName ?? ev.awayTeam?.name ?? '?';
    const scoreEl = document.getElementById('score-' + eventId);
    if (scoreEl) {
      scoreEl.innerHTML =
        `<span class="team home">${homeShort}</span>` +
        `<span class="score">${homeScore} – ${awayScore}</span>` +
        `<span class="team away">${awayShort}</span>`;
    }

    if (!isLive) clearInterval(timers[eventId]);
  } catch {}

  await fetchShotmap(eventId);
}

async function fetchShotmap(eventId) {
  const wrap = document.getElementById('table-' + eventId);
  if (!wrap) return;
  try {
    const res = await fetch(shotmapUrl(eventId), { cache: 'no-store' });
    const json = await res.json();
    // shotmap lives at root array, or .shotmap, or .data
    const shots = Array.isArray(json) ? json
      : Array.isArray(json.shotmap) ? json.shotmap
      : Array.isArray(json.data) ? json.data
      : [];

    if (!shots.length) {
      wrap.innerHTML = '<div class="no-data">No shots yet.</div>';
      return;
    }

    // aggregate per player
    const byPlayer = {};
    for (const shot of shots) {
      const pid = shot.player?.id ?? shot.playerId ?? 'unknown';
      if (!byPlayer[pid]) {
        byPlayer[pid] = {
          id: pid,
          name: shot.player?.name ?? shot.playerName ?? pid,
          shortName: shot.player?.shortName ?? shot.player?.name ?? pid,
          position: shot.player?.position ?? '',
          isHome: shot.isHome,
          shots: 0, goals: 0,
          xg: 0, xgot: 0,
        };
      }
      const p = byPlayer[pid];
      p.shots++;
      p.xg += parseFloat(shot.xg ?? 0);
      p.xgot += parseFloat(shot.xgot ?? 0);
      if (shot.shotType === 'goal') p.goals++;
    }

    const ranked = Object.values(byPlayer).sort((a, b) => b.xg - a.xg);

    wrap.innerHTML = `
      <table class="xg-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th class="num">Shots</th>
            <th class="num">Goals</th>
            <th class="num accent">xG</th>
            <th class="num">xGOT</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map((p, i) => `
            <tr class="${p.isHome ? 'home' : 'away'}">
              <td class="rank">${i + 1}</td>
              <td class="player-cell">
                <span class="player-name">${p.shortName}</span>
                <span class="player-meta">${p.position}${p.isHome ? ' · H' : ' · A'}</span>
              </td>
              <td class="num">${p.shots}</td>
              <td class="num">${p.goals}</td>
              <td class="num accent">${p.xg.toFixed(2)}</td>
              <td class="num">${p.xgot.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" class="total-label">Total (${shots.length} shots)</td>
            <td class="num">${ranked.reduce((s,p)=>s+p.shots,0)}</td>
            <td class="num">${ranked.reduce((s,p)=>s+p.goals,0)}</td>
            <td class="num accent">${ranked.reduce((s,p)=>s+p.xg,0).toFixed(2)}</td>
            <td class="num">${ranked.reduce((s,p)=>s+p.xgot,0).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="updated">Updated ${new Date().toLocaleTimeString()}</div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="no-data err">Shotmap error: ${e.message}</div>`;
  }
}
