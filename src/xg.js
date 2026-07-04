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
const tournState = {};     // eventId → { tournamentId, seasonId, homeMatches, awayMatches, prevHomeRank, prevAwayRank, isLive }
const finishedCache = {};  // `${tournamentId}:${seasonId}` → [{id, homeTeam:{id}, awayTeam:{id}}]

const POLL_MS = 20_000;

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

// Chrome intensive throttling (>5min background) freezes even Web Workers.
// On tab focus: immediately re-fetch + restart worker for all live matches.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  for (const eventId of Object.keys(timers)) {
    refreshLive(eventId);
    pollWorker.postMessage({ cmd: 'start', eventId, intervalMs: POLL_MS });
    startCountdown(eventId);
  }
});

function removeId(id) {
  pollWorker.postMessage({ cmd: 'stop', eventId: id });
  stopCountdown(id);
  panels[id]?.remove();
  delete panels[id];
  delete timers[id];
  delete tournState[id];
}

// --- main load ---
function domain() { return DOMAINS[state.env]; }
function eventUrl(id) { return `${domain()}/api/v2/football/event/${id}?language=en-GB`; }
function shotmapUrl(id) { return `${domain()}/api/v2/football/event/${id}/shotmap?language=en-GB`; }
function tournamentEventsUrl(tournamentId, seasonId, page) {
  return `${domain()}/api/v2/football/unique-tournament/${tournamentId}/seasons/${seasonId}/events/finished/page/${page}?language=en-GB`;
}

function xgCell(value, max, extraCls = '') {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return `<td class="n hi xg-cell ${extraCls}"><div class="xg-bar" style="width:${pct}%"></div><span class="xg-val">${value.toFixed(2)}</span></td>`;
}

function sectionHeader(icon, title, subtitle) {
  return `
    <div class="section-hdr">
      <span class="section-icon">${icon}</span>
      <div>
        <div class="section-title">${title}</div>
        ${subtitle ? `<div class="section-sub">${subtitle}</div>` : ''}
      </div>
    </div>`;
}

function extractShots(json) {
  return Array.isArray(json) ? json
    : Array.isArray(json.shotmap) ? json.shotmap
    : Array.isArray(json.data?.shotmap) ? json.data.shotmap
    : Array.isArray(json.data) ? json.data : [];
}

// fetch every page of finished events for a tournament+season (cached per key)
async function getFinishedEvents(tournamentId, seasonId) {
  const key = `${tournamentId}:${seasonId}`;
  if (finishedCache[key]) return finishedCache[key];
  const events = [];
  let page = 1;
  while (true) {
    const res = await fetch(tournamentEventsUrl(tournamentId, seasonId, page), { cache: 'no-store' });
    if (!res.ok) break;
    const json = await res.json();
    const pageEvents = json.data?.events ?? [];
    events.push(...pageEvents);
    const pagination = json.data?.pagination;
    if (!pagination?.hasNextPage) break;
    page++;
  }
  finishedCache[key] = events;
  return events;
}

// which matches (of the finished list + current match) a given team played in this tournament,
// and whether that team was home or away in each — needed since shot.isHome is per-match, not per-team
function collectTeamMatches(events, teamId, currentEventId, currentEv) {
  const byId = new Map(); // eventId → teamWasHome
  for (const ev of events) {
    if (ev.homeTeam?.id === teamId) byId.set(ev.id, true);
    else if (ev.awayTeam?.id === teamId) byId.set(ev.id, false);
  }
  if (currentEv?.homeTeam?.id === teamId) byId.set(currentEventId, true);
  else if (currentEv?.awayTeam?.id === teamId) byId.set(currentEventId, false);
  return [...byId.entries()].map(([id, teamWasHome]) => ({ id, teamWasHome }));
}

// fetch shotmaps one by one (not in parallel) and sum xg/xgot per player for a team across matches
async function fetchTeamAggregate(matches) {
  const byPlayer = {};
  for (const m of matches) {
    try {
      const res = await fetch(shotmapUrl(m.id), { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      for (const shot of extractShots(json)) {
        if (Boolean(shot.isHome) !== m.teamWasHome) continue; // keep only this team's shots
        const pid = shot.player?.id ?? shot.playerId ?? 'unknown';
        if (!byPlayer[pid]) {
          byPlayer[pid] = {
            name: shot.player?.shortName ?? shot.player?.name ?? pid,
            position: shot.player?.position ?? '',
            shots: 0, goals: 0, xg: 0, xgot: 0, matches: new Set(),
          };
        }
        const p = byPlayer[pid];
        p.shots++;
        p.xg += parseFloat(shot.xg ?? 0);
        p.xgot += parseFloat(shot.xgot ?? 0);
        if (shot.shotType === 'goal') p.goals++;
        p.matches.add(m.id);
      }
    } catch { /* skip failed match, keep aggregating the rest */ }
  }
  return byPlayer;
}

function renderTeamAggregate(byPlayer, side, prevRank, showArrows) {
  const ranked = Object.values(byPlayer).sort((a, b) => b.xg - a.xg);
  const maxXg = Math.max(0, ...ranked.map(p => p.xg));
  const rows = ranked.map((p, i) => {
    let arrow = '<span class="rank-arrow slot"></span>';
    if (showArrows) {
      const prev = prevRank.get(p._pid);
      if (prev !== undefined) {
        if (i < prev) arrow = '<span class="rank-arrow up">▲</span>';
        else if (i > prev) arrow = '<span class="rank-arrow down">▼</span>';
        else arrow = '<span class="rank-arrow flat">•</span>';
      }
    }
    return `
      <tr class="${side}-row">
        <td class="rank">${arrow}<span class="rank-num">${i === 0 ? '🏅' : i + 1}</span></td>
        <td class="pcell">
          <span class="pname">${p.name}</span>
          <span class="pmeta">${p.position}</span>
        </td>
        <td class="n">${p.matches.size}</td>
        <td class="n">${p.shots}</td>
        <td class="n">${p.goals}</td>
        ${xgCell(p.xg, maxXg)}
        <td class="n">${p.xgot.toFixed(2)}</td>
      </tr>`;
  }).join('');
  const tot = {
    shots: ranked.reduce((s, p) => s + p.shots, 0),
    goals: ranked.reduce((s, p) => s + p.goals, 0),
    xg: ranked.reduce((s, p) => s + p.xg, 0),
    xgot: ranked.reduce((s, p) => s + p.xgot, 0),
  };
  return `
    <table class="xg-table">
      <thead>
        <tr>
          <th>#</th>
          <th><span class="side-dot ${side}"></span>${side === 'home' ? 'Home' : 'Away'}</th>
          <th class="n">M</th>
          <th class="n">Sh</th>
          <th class="n">G</th>
          <th class="n hi">xG</th>
          <th class="n">xGOT</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="total-lbl">${ranked.length} players</td>
          <td class="n">${tot.shots}</td>
          <td class="n">${tot.goals}</td>
          <td class="n hi">${tot.xg.toFixed(2)}</td>
          <td class="n">${tot.xgot.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>`;
}

async function loadTournamentTotals(eventId, ev, isLive) {
  const wrap = document.getElementById('ptourn-' + eventId);
  if (!wrap) return;
  const tournamentId = ev.tournament?.id;
  const seasonId = ev.season?.id ?? ev.season_id;
  const homeTeamId = ev.homeTeam?.id;
  const awayTeamId = ev.awayTeam?.id;
  if (!tournamentId || !seasonId || !homeTeamId || !awayTeamId) {
    wrap.innerHTML = '<div class="no-data">Tournament data unavailable for this match.</div>';
    return;
  }
  wrap.innerHTML = '<div class="loading-msg">Fetching tournament totals…</div>';
  try {
    const finished = await getFinishedEvents(tournamentId, seasonId);
    const homeMatches = collectTeamMatches(finished, homeTeamId, eventId, ev);
    const awayMatches = collectTeamMatches(finished, awayTeamId, eventId, ev);
    tournState[eventId] = {
      tournamentId, seasonId, homeMatches, awayMatches, isLive,
      prevHomeRank: new Map(), prevAwayRank: new Map(),
    };
    await refreshTournamentTotals(eventId);
  } catch (e) {
    wrap.innerHTML = `<div class="no-data err">Tournament totals error: ${e.message}</div>`;
  }
}

async function refreshTournamentTotals(eventId) {
  const wrap = document.getElementById('ptourn-' + eventId);
  const st = tournState[eventId];
  if (!wrap || !st) return;
  const [homeByPlayer, awayByPlayer] = [
    await fetchTeamAggregate(st.homeMatches),
    await fetchTeamAggregate(st.awayMatches),
  ];
  // stamp each player with its pid so renderTeamAggregate can look up prev rank
  for (const [pid, p] of Object.entries(homeByPlayer)) p._pid = pid;
  for (const [pid, p] of Object.entries(awayByPlayer)) p._pid = pid;

  const matchCount = new Set([...st.homeMatches, ...st.awayMatches].map(m => m.id)).size;
  const subtitle = `Cumulative across ${matchCount} match${matchCount === 1 ? '' : 'es'} this stage` +
    (st.isLive ? ' · <span class="live-tag">● rank updates live</span>' : '');

  wrap.innerHTML = `
    ${sectionHeader('🏆', 'Tournament totals', subtitle)}
    <div class="tables-grid">
      <div class="team-table-wrap">${renderTeamAggregate(homeByPlayer, 'home', st.prevHomeRank, st.isLive)}</div>
      <div class="team-table-wrap">${renderTeamAggregate(awayByPlayer, 'away', st.prevAwayRank, st.isLive)}</div>
    </div>
    <div class="updated">Updated ${new Date().toLocaleTimeString()}</div>
  `;

  st.prevHomeRank = new Map(Object.values(homeByPlayer).sort((a, b) => b.xg - a.xg).map((p, i) => [p._pid, i]));
  st.prevAwayRank = new Map(Object.values(awayByPlayer).sort((a, b) => b.xg - a.xg).map((p, i) => [p._pid, i]));
}

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
      <div id="ptourn-${eventId}" class="xg-wrap tourn-wrap"></div>
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

    // fetch shotmap once, then aggregate xg/xgot across all of both teams' matches this tournament
    await fetchShotmap(eventId);
    await loadTournamentTotals(eventId, ev, isLive);

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

    if (tournState[eventId]) tournState[eventId].isLive = isLive;

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
  await refreshTournamentTotals(eventId);
}

async function fetchShotmap(eventId) {
  const wrap = document.getElementById('ptable-' + eventId);
  if (!wrap) return;
  try {
    const res = await fetch(shotmapUrl(eventId), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const shots = extractShots(json);

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
      const maxXg = Math.max(0, ...players.map(p => p.xg));
      return `
        <table class="xg-table">
          <thead>
            <tr>
              <th>#</th>
              <th><span class="side-dot ${side}"></span>${side === 'home' ? 'Home' : 'Away'}</th>
              <th class="n">Sh</th>
              <th class="n">G</th>
              <th class="n hi">xG</th>
              <th class="n">xGOT</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p, i) => `
              <tr class="${side}-row">
                <td class="rank">${i === 0 ? '🏅' : i + 1}</td>
                <td class="pcell">
                  <span class="pname">${p.shortName}</span>
                  <span class="pmeta">${p.position}</span>
                </td>
                <td class="n">${p.shots}</td>
                <td class="n">${p.goals}</td>
                ${xgCell(p.xg, maxXg)}
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
      ${sectionHeader('⚡', 'This match', 'Shots recorded in this fixture only')}
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

