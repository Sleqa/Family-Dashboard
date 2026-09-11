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

async function loadF1Data() {
  try {
    const year = new Date().getFullYear();
    const [next, standings, drivers, meetings] = await Promise.all([
      readJSON('https://api.jolpi.ca/ergast/f1/current/next.json'),
      readJSON('https://api.jolpi.ca/ergast/f1/current/driverStandings.json').catch(() => null),
      cachedJSON('f1:drivers','https://api.openf1.org/v1/drivers?session_key=latest',6*3600000).catch(() => []),
      cachedJSON('f1:meetings:'+year,'https://api.openf1.org/v1/meetings?year='+year,6*3600000).catch(() => []),
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

function drawF1Card(data) {
  const card = document.getElementById('f1-card');
  if (!data || data.empty || !data.date || Date.now()-new Date(data.date)>6*3600000) {card.hidden=true;card.dataset.live='0';card.innerHTML='';return;}
  card.hidden=false;
  const ms=new Date(data.date)-Date.now(), minutes=Math.max(0,Math.floor(ms/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes/60)%24;
  // Lights out has happened but the race can't have finished yet — treat it as live.
  card.dataset.live = (ms < 0 && Date.now()-new Date(data.date) < 3*3600000) ? '1' : '0';
  const countdown=ms<0?'Scheduled race time has passed':days?days+'d '+hours+'h to lights out':hours+'h '+minutes%60+'m to lights out';
  const time=date=>new Date(date).toLocaleString('en-AU',{timeZone:'Australia/Perth',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  const track=safeImageUrl(data.circuitImage),portrait=safeImageUrl(data.leader?.image || data.leader?.fallbackImage);
  card.innerHTML='<div class="f1-top"><div class="sports-card-header"><span>FORMULA 1</span><span>Race weekend</span></div></div>'+
    (track?'<img class="f1-track" src="'+escapeHtml(track)+'" alt="'+escapeHtml(data.circuit)+' circuit layout" data-hide-on-error>':'')+
    '<div class="f1-race-info"><div class="sports-f1-race">'+escapeHtml(data.raceName)+'</div><div class="sports-f1-circuit">'+escapeHtml(data.circuit)+' · '+escapeHtml(data.country)+
    '</div><div class="sports-f1-time">'+time(data.date)+' AWST</div><div class="sports-f1-countdown">'+countdown+'</div><div class="f1-sessions">'+
    (data.sessions || []).map(s=>'<div><span>'+s.name+'</span>'+time(s.date)+'</div>').join('')+'</div></div>'+
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
