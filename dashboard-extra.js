// Public local information. No API keys or private calendar data in this file.
const MADRING_IMAGE = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Madring_%282026%29.svg/960px-Madring_%282026%29.svg.png';
const ANTONELLI_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Antonelli_Barcelona_2024.jpg';
let fuelSnapshot = null;
const FUEL_LOCAL_RADIUS_KM = 20;
let extrasBusy = false;

function perthTime(date) {
  return date.toLocaleTimeString('en-AU', {timeZone:'Australia/Perth', hour:'numeric', minute:'2-digit'});
}

function safeImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

async function readJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch(url, {signal:ctrl.signal});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function cachedJSON(key, url, age) {
  const hit = cacheGet(key);
  if (hit && Date.now() - hit.savedAt < age) return hit.value;
  try {
    const value = await readJSON(url);
    cacheSet(key, value);
    return value;
  } catch (error) {
    if (hit && Date.now() - hit.savedAt < 7 * 86400000) return hit.value;
    throw error;
  }
}

function renderWeekStrip(events = []) {
  const today = new Date();
  today.setHours(0,0,0,0);
  document.getElementById('week-strip').innerHTML = Array.from({length:7}, (_, i) => {
    const date = new Date(today.getTime() + i * 86400000);
    const busy = events.some(e => e.start < new Date(date.getTime() + 86400000) && (e.end ? e.end > date : e.start >= date));
    return '<div class="week-day' + (i === 0 ? ' today' : '') + (busy ? ' busy' : '') + '">' +
      '<span>' + date.toLocaleDateString('en-AU',{weekday:'short'}) + '</span><strong>' + date.getDate() + '</strong><i aria-hidden="true"></i></div>';
  }).join('');
}

function numberOrDash(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? value + suffix : '—';
}

function renderWeatherExtras(w) {
  const daily = w.daily;
  if (!daily) return;
  const today = perthDateKey(new Date());
  const entries = daily.time.map((date,i) => ({date,i})).filter(x => x.date >= today).slice(0,4);
  document.getElementById('forecast').innerHTML = entries.map(({date,i}) => {
    const label = date === today ? 'Today' : new Date(date+'T12:00:00+08:00').toLocaleDateString('en-AU',{timeZone:'Australia/Perth',weekday:'short'});
    return '<div class="forecast-day"><span>' + label + '</span><span class="forecast-icon" aria-hidden="true">' + (WMO_ICONS[daily.weather_code[i]] || '☁️') +
      '</span><strong>' + Math.round(daily.temperature_2m_max[i]) + '° <span>' + Math.round(daily.temperature_2m_min[i]) + '°</span></strong><span>' +
      numberOrDash(daily.precipitation_probability_max[i],'% rain') + '</span></div>';
  }).join('');
  const i = daily.time.indexOf(today);
  document.getElementById('sun-strip').innerHTML = i < 0 ? '' :
    '<span>↑ ' + perthTime(new Date(daily.sunrise[i]+'+08:00')) + '</span><span>↓ ' + perthTime(new Date(daily.sunset[i]+'+08:00')) +
    ' sunset</span><span class="uv">UV ' + numberOrDash(daily.uv_index_max[i]) + ' max</span>';
  fitFuelRows();
}

function fuelRow(station, rank) {
  const maps = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(station.latitude + ',' + station.longitude);
  return '<a class="fuel-row" href="' + maps + '" target="_blank" rel="noopener" title="Directions to ' + escapeHtml(station.name) +
    '"><span class="fuel-rank">' + String(rank).padStart(2,'0') + '</span><div><div class="fuel-name">' + escapeHtml(station.name) +
    '</div><div class="fuel-address">' + escapeHtml(station.suburb) + ' · ' + station.distanceKm.toFixed(1) + ' km</div></div><div class="fuel-price">' +
    station.price.toFixed(1) + '<small>cents / litre</small></div></a>';
}

function renderFuel() {
  const el = document.getElementById('fuel-content');
  const stations = fuelSnapshot?.days?.[perthDateKey(new Date())];
  if (!stations?.length) {
    el.innerHTML = '<p class="fuel-note">Today’s prices haven’t arrived yet.</p>';
    return;
  }
  // Membership-only deals aren't prices the family can actually pay.
  const ranked = stations
    .filter(s => !s.restrictions && Number.isFinite(s.price))
    .sort((a,b) => a.price - b.price || a.distanceKm - b.distanceKm);
  if (!ranked.length) { el.innerHTML = '<p class="fuel-note">No open prices available today.</p>'; return; }

  const best = ranked[0];
  // When the metro-wide cheapest is already nearby, listing it again under
  // the local heading would read as a duplicate — show the rest instead, and
  // say "also" so the heading stays true either way.
  const bestIsLocal = best.distanceKm <= FUEL_LOCAL_RADIUS_KM;
  const local = ranked.filter(s => s.distanceKm <= FUEL_LOCAL_RADIUS_KM && s !== best);

  let html = '<div class="fuel-group"><div class="fuel-group-label">Cheapest in Perth</div>' + fuelRow(best, 1) + '</div>';
  if (local.length) {
    html += '<div class="fuel-group" id="fuel-local"><div class="fuel-group-label">' +
      (bestIsLocal ? 'Also within ' : 'Cheapest within ') + FUEL_LOCAL_RADIUS_KM + ' km</div>' +
      local.slice(0, 7).map((s, i) => fuelRow(s, i + 1)).join('') + '</div>';
  }
  el.innerHTML = html;
  fitFuelRows();
}

// The card is stretched to the foot of the column, so how many rows fit
// depends on the screen. Drop whole local rows from the end until the
// content sits inside the card, so a row is never sliced in half. The
// Perth-wide row always survives.
function fitFuelRows() {
  const panel = document.getElementById('fuel-panel');
  const group = document.getElementById('fuel-local');
  if (!panel || !group) return;
  const rows = [...group.querySelectorAll('.fuel-row')];
  group.hidden = false;
  rows.forEach(row => { row.hidden = false; });
  for (let i = rows.length - 1; i >= 0; i--) {
    if (panel.scrollHeight <= panel.clientHeight) break;
    rows[i].hidden = true;
  }
  if (rows.every(row => row.hidden)) group.hidden = true;
}

async function refreshFuel() {
  // Read the raw public snapshot so scheduled GITHUB_TOKEN commits do not need
  // to trigger a Pages rebuild. Same-origin copy remains an offline fallback.
  const bucket = Math.floor(Date.now() / (15 * 60000));
  const urls = ['https://raw.githubusercontent.com/Sleqa/Family-Dashboard/main/data/fuel.json?v=' + bucket, 'data/fuel.json?v=' + bucket];
  for (const url of urls) {
    try {
      const data = await readJSON(url);
      if (data.product !== 2 || !data.days || !data.updatedAt) throw new Error('Invalid fuel snapshot');
      if (!fuelSnapshot || new Date(data.updatedAt) >= new Date(fuelSnapshot.updatedAt)) {
        fuelSnapshot = data;
        cacheSet('fuel:95:metro', data);
      }
      renderFuel();
      return;
    } catch { /* try the deployed copy without discarding cached data */ }
  }
  renderFuel();
}

// ── F1 session timing (OpenF1) ───────────────────────────────────────────
// session_result covers every session type, but shapes the times differently:
// practice gives one best lap, qualifying an array of Q1/Q2/Q3 times, and the
// race a total duration with gaps that may read "+1 LAP".
function f1LapTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes ? minutes + ':' + rest.toFixed(3).padStart(6, '0') : rest.toFixed(3);
}

function f1Gap(gap) {
  if (typeof gap === 'string') return gap;
  if (typeof gap === 'number' && Number.isFinite(gap)) return gap ? '+' + gap.toFixed(3) : '';
  return '';
}

function f1Best(value) {
  // Qualifying reports [Q1, Q2, Q3]; the last time set is the one that counts.
  if (Array.isArray(value)) {
    const times = value.filter(v => typeof v === 'number' && Number.isFinite(v));
    return times.length ? times[times.length - 1] : null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function f1DriverLabel(driver, number) {
  if (!driver) return '#' + number;
  return driver.name_acronym || driver.last_name || driver.full_name || ('#' + number);
}

async function loadF1Session() {
  try {
    const sessions = await readJSON('https://api.openf1.org/v1/sessions?session_key=latest');
    const session = Array.isArray(sessions) ? sessions[0] : null;
    if (!session) return null;

    const start = new Date(session.date_start).getTime();
    const end = new Date(session.date_end).getTime();
    const now = Date.now();
    const live = now >= start && now <= end;
    const name = session.session_name || session.session_type || '';

    const drivers = await cachedJSON('f1:drivers:' + session.session_key,
      'https://api.openf1.org/v1/drivers?session_key=' + session.session_key, 6 * 3600000).catch(() => []);
    const byNumber = new Map((Array.isArray(drivers) ? drivers : []).map(d => [d.driver_number, d]));

    if (live) {
      // Positions are a change log, so the last entry per driver is the
      // current order. Intervals are huge over a full race — ask only for the
      // last few minutes and keep the newest row per driver.
      const since = new Date(now - 5 * 60000).toISOString();
      const [positions, intervals] = await Promise.all([
        readJSON('https://api.openf1.org/v1/position?session_key=' + session.session_key),
        readJSON('https://api.openf1.org/v1/intervals?session_key=' + session.session_key +
          '&date%3E=' + encodeURIComponent(since)).catch(() => []),
      ]);
      const newest = (rows, key) => {
        const latest = new Map();
        for (const row of (Array.isArray(rows) ? rows : [])) {
          const prev = latest.get(row.driver_number);
          if (!prev || new Date(row.date) >= new Date(prev.date)) latest.set(row.driver_number, row);
        }
        return latest;
      };
      const places = newest(positions);
      const gaps = newest(intervals);
      const field = [...places.values()]
        .filter(p => Number.isFinite(p.position))
        .sort((a, b) => a.position - b.position)
        .map(p => {
          const driver = byNumber.get(p.driver_number);
          const gap = gaps.get(p.driver_number);
          return {
            position: p.position,
            code: f1DriverLabel(driver, p.driver_number),
            team: driver?.team_name || '',
            colour: driver?.team_colour ? '#' + driver.team_colour : '',
            gap: p.position === 1 ? 'Leader' : f1Gap(gap?.gap_to_leader),
          };
        });
      if (!field.length) return null;
      return { live: true, name, field };
    }

    if (now < start) return null;   // nothing has run yet this weekend
    const result = await readJSON('https://api.openf1.org/v1/session_result?session_key=' + session.session_key)
      .catch(() => null);
    if (!Array.isArray(result) || !result.length) return null;

    const isRace = (session.session_type || '') === 'Race';
    const top = result
      .filter(r => Number.isFinite(r.position) && r.position <= 3)
      .sort((a, b) => a.position - b.position)
      .map(r => {
        const driver = byNumber.get(r.driver_number);
        const best = f1Best(r.duration);
        return {
          position: r.position,
          code: f1DriverLabel(driver, r.driver_number),
          team: driver?.team_name || '',
          colour: driver?.team_colour ? '#' + driver.team_colour : '',
          value: r.position === 1
            ? (isRace ? 'Winner' : f1LapTime(best))
            : f1Gap(Array.isArray(r.gap_to_leader) ? f1Best(r.gap_to_leader) : r.gap_to_leader),
        };
      });
    return top.length ? { live: false, name, top } : null;
  } catch { return null; }
}

async function loadF1Data() {
  try {
    const year = new Date().getFullYear();
    const [next, standings, drivers, meetings, session] = await Promise.all([
      readJSON('https://api.jolpi.ca/ergast/f1/current/next.json'),
      readJSON('https://api.jolpi.ca/ergast/f1/current/driverStandings.json').catch(() => null),
      cachedJSON('f1:drivers','https://api.openf1.org/v1/drivers?session_key=latest',6*3600000).catch(() => []),
      cachedJSON('f1:meetings:'+year,'https://api.openf1.org/v1/meetings?year='+year,6*3600000).catch(() => []),
      loadF1Session(),
    ]);
    const race = next.MRData?.RaceTable?.Races?.[0];
    if (!race) return {empty:true};
    const date = new Date(race.date+'T'+(race.time || '00:00:00Z'));
    if (isNaN(date)) return null;
    const leader = standings?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.[0];
    const driver = (Array.isArray(drivers) ? drivers : []).find(d => d.name_acronym === leader?.Driver?.code);
    const meeting = (Array.isArray(meetings) ? meetings : []).find(m => !m.is_cancelled &&
      new Date(m.date_start) <= date && new Date(m.date_end).getTime()+86400000 >= date.getTime());
    const commons = !meeting?.circuit_image && race.Circuit?.circuitId === 'madring';
    return {
      session,
      date, raceName:race.raceName || '', circuit:race.Circuit?.circuitName || '', country:race.Circuit?.Location?.country || '',
      circuitImage:safeImageUrl(meeting?.circuit_image) || (commons ? MADRING_IMAGE : ''), circuitCredit:commons ? 'commons':'openf1',
      sessions:['Qualifying','Sprint'].filter(key => race[key]?.date).map(key => ({name:key,date:race[key].date+'T'+(race[key].time || '00:00:00Z')})),
      leader:leader ? {
        name:[leader.Driver?.givenName,leader.Driver?.familyName].filter(Boolean).join(' '),
        points:leader.points,team:leader.Constructors?.[0]?.name || '',image:safeImageUrl(driver?.headshot_url),
        fallbackImage:leader.Driver?.code === 'ANT' ? ANTONELLI_IMAGE : '',
      }:null,
    };
  } catch { return null; }
}

// team_colour comes from the API, so only let a plain hex through to CSS.
function f1Colour(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : 'var(--muted)';
}

function f1LiveRows(field) {
  return field.map(row =>
    '<div class="f1-live-row"><span class="f1-live-pos">' + row.position +
    '</span><span class="f1-live-bar" style="background:' + f1Colour(row.colour) +
    '"></span><span class="f1-live-code">' + escapeHtml(row.code) +
    '</span><span class="f1-live-team">' + escapeHtml(row.team) +
    '</span><span class="f1-live-gap">' + escapeHtml(row.gap) + '</span></div>').join('');
}

function f1ResultRows(top) {
  return top.map(row =>
    '<div class="f1-result-row"><span class="f1-live-pos">' + row.position +
    '</span><span class="f1-live-bar" style="background:' + f1Colour(row.colour) +
    '"></span><span class="f1-live-code">' + escapeHtml(row.code) +
    '</span><span class="f1-live-team">' + escapeHtml(row.team) +
    '</span><span class="f1-live-gap">' + escapeHtml(row.value) + '</span></div>').join('');
}

function drawF1Card(data) {
  const card = document.getElementById('f1-card');
  if (!data || data.empty || !data.date || Date.now()-new Date(data.date)>6*3600000) {card.hidden=true;card.dataset.live='0';card.dataset.solo='0';card.innerHTML='';return;}
  card.hidden=false;
  const session = data.session;

  // A session actually running takes over the card and, upstairs, the whole
  // sidebar: full field, positions and gaps, nothing else competing for space.
  if (session && session.live && session.field?.length) {
    card.dataset.live = '1';
    card.dataset.solo = '1';
    card.innerHTML =
      '<div class="f1-top"><div class="sports-card-header"><span>FORMULA 1<span class="sports-live-dot"></span></span>' +
      '<span>' + escapeHtml(session.name) + ' · live</span></div>' +
      '<div class="f1-live-race">' + escapeHtml(data.raceName) + '</div></div>' +
      '<div class="f1-live">' + f1LiveRows(session.field) + '</div>';
    return;
  }

  const ms=new Date(data.date)-Date.now(), minutes=Math.max(0,Math.floor(ms/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes/60)%24;
  // Lights out has happened but the race can't have finished yet — treat it as live.
  card.dataset.live = (ms < 0 && Date.now()-new Date(data.date) < 3*3600000) ? '1' : '0';
  card.dataset.solo = '0';
  const countdown=ms<0?'Scheduled race time has passed':days?days+'d '+hours+'h to lights out':hours+'h '+minutes%60+'m to lights out';
  const time=date=>new Date(date).toLocaleString('en-AU',{timeZone:'Australia/Perth',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  const track=safeImageUrl(data.circuitImage),portrait=safeImageUrl(data.leader?.image || data.leader?.fallbackImage);
  card.innerHTML='<div class="f1-top"><div class="sports-card-header"><span>FORMULA 1</span><span>Race weekend</span></div></div>'+
    (track?'<img class="f1-track" src="'+escapeHtml(track)+'" alt="'+escapeHtml(data.circuit)+' circuit layout" data-hide-on-error>':'')+
    '<div class="f1-race-info"><div class="sports-f1-race">'+escapeHtml(data.raceName)+'</div><div class="sports-f1-circuit">'+escapeHtml(data.circuit)+' · '+escapeHtml(data.country)+
    '</div><div class="sports-f1-time">'+time(data.date)+' AWST</div><div class="sports-f1-countdown">'+countdown+'</div><div class="f1-sessions">'+
    (data.sessions || []).map(s=>'<div><span>'+s.name+'</span>'+time(s.date)+'</div>').join('')+'</div></div>'+
    (session && session.top?.length
      ? '<div class="f1-results"><div class="f1-results-label">' + escapeHtml(session.name) + ' · top 3</div>' +
        f1ResultRows(session.top) + '</div>'
      : '')+
    (data.leader?'<div class="sports-f1-leader">'+(portrait?'<img class="driver-portrait" src="'+escapeHtml(portrait)+'" alt="'+escapeHtml(data.leader.name)+
      '" data-fallback="'+escapeHtml(safeImageUrl(data.leader.fallbackImage))+'" data-hide-on-error>':'')+
      '<div><div class="sports-f1-leader-label">Championship leader</div><div class="sports-f1-leader-name">'+escapeHtml(data.leader.name)+
      '</div><div class="sports-f1-leader-points">'+escapeHtml(data.leader.points)+' pts · '+escapeHtml(data.leader.team)+'</div></div></div>':'')+
    // Data-source notes are gone, but the Wikimedia circuit diagram is
    // CC BY-SA 3.0 — displaying it without credit would breach the licence,
    // so this one line stays whenever that particular image is shown.
    (data.circuitCredit==='commons'&&track?'<div class="image-credit"><a href="https://commons.wikimedia.org/wiki/File:Madring_(2026).svg" target="_blank" rel="noopener">Circuit: GabrielStella · CC BY-SA 3.0</a></div>':'');
}

async function refreshHomeExtras() {
  renderFuel();
  if (extrasBusy || !isOnline()) return;
  extrasBusy = true;
  try { await refreshFuel(); }
  finally { extrasBusy = false; }
}

function initialiseHomeExtras() {
  fuelSnapshot = cacheGet('fuel:95:metro')?.value || null;
  renderWeekStrip();
  refreshHomeExtras();
  setInterval(refreshHomeExtras, 15*60000);
  setInterval(renderFuel, 60000);
  let manualRefreshBusy=false;
  document.getElementById('refresh-button').addEventListener('click',async()=>{
    if(manualRefreshBusy)return;
    manualRefreshBusy=true;
    const button=document.getElementById('refresh-button');button.disabled=true;
    try{await Promise.allSettled([fetchWeather(),refreshCalendar(),refreshSports(),refreshHomeExtras()]);}
    finally{manualRefreshBusy=false;button.disabled=false;}
  });
  document.getElementById('fullscreen-button').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}catch{/* device does not support full screen */}
  });
  window.addEventListener('resize', fitFuelRows);
  if (document.fonts?.ready) document.fonts.ready.then(fitFuelRows);
  document.addEventListener('error',event=>{
    const image=event.target;
    if(image.tagName!=='IMG')return;
    if(image.dataset.fallback){const fallback=image.dataset.fallback;delete image.dataset.fallback;if(image.src!==fallback){image.src=fallback;return;}}
    image.hidden=true;
  },true);
}
