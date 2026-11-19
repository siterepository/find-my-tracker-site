// Item Trails: reads the private "Find My Tracker" sheet in the browser with the signed-in
// user's own Google token (drive.file scope) and draws each item's day on a map.
// Nothing is stored or sent anywhere else; the token lives only in this tab's memory.
import { CLIENT_ID, SHEET_NAME, LATEST_TAB, REFRESH_MS } from './config.js';
import {
  parseItemRows, parseLatestRows, dayKey, pointsForDay, daysWithData, buildTimeline,
  pathMeters, positionAt, describeDuration, describeDistance, clockTime,
} from './history.js';
import { demoSource } from './demo.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  source: null, items: [], latest: [], selected: store.get('trails.item') || '__all',
  day: null, points: [], loadedAt: null, busy: false,
};

/* ---------- map ---------- */
const dark = matchMedia('(prefers-color-scheme: dark)');
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([39.5, -111.9], 7);
L.control.zoom({ position: 'topright' }).addTo(map);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const paintTiles = () => {
  const el = tiles.getContainer();
  el?.classList.toggle('dark-tiles', dark.matches);
  el?.classList.toggle('light-tiles', !dark.matches);
};
paintTiles();
dark.addEventListener('change', paintTiles);
const layer = L.layerGroup().addTo(map);
let scrubMarker = null;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
const icon = (cls, html = '') => L.divIcon({ className: '', html: `<div class="${cls}">${html}</div>`, iconSize: null });
const labelIcon = (text) => L.divIcon({ className: '', html: `<div class="pin-label">${esc(text)}</div>`, iconSize: null, iconAnchor: [-10, 10] });

function fit(latlngs) {
  if (!latlngs.length) return;
  const wide = innerWidth >= 900;
  const pad = wide ? { paddingTopLeft: [420, 40], paddingBottomRight: [40, 40] }
    : { paddingTopLeft: [30, 40], paddingBottomRight: [30, Math.min(innerHeight * 0.62, 420)] };
  if (latlngs.length === 1) map.setView(latlngs[0], 16);
  else map.fitBounds(L.latLngBounds(latlngs), { ...pad, maxZoom: 17 });
}

/* ---------- Google source ---------- */
function googleSource() {
  let token = null;
  let sheetId = null;
  let tokenClient = null;

  async function api(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { token = null; throw Object.assign(new Error('Signed out'), { signedOut: true }); }
    if (!res.ok) throw new Error(`Google returned ${res.status}`);
    return res.json();
  }
  const quote = (t) => `'${t.replace(/'/g, "''")}'`;

  return {
    kind: 'google',
    get signedIn() { return !!token; },
    signIn() {
      return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) { reject(new Error('Google sign-in is still loading. Try again in a moment.')); return; }
        tokenClient ??= google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {},
        });
        tokenClient.callback = (r) => {
          if (r.error) { reject(new Error(r.error === 'access_denied' ? 'Sign-in was cancelled.' : r.error)); return; }
          token = r.access_token; store.set('trails.hint', '1'); resolve();
        };
        tokenClient.error_callback = (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : (e.message || 'Sign-in failed.')));
        tokenClient.requestAccessToken({ prompt: store.get('trails.hint') ? '' : 'consent' });
      });
    },
    async items() {
      if (!sheetId) {
        const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
        const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id)`);
        sheetId = r.files?.[0]?.id;
        if (!sheetId) throw new Error(`No "${SHEET_NAME}" spreadsheet found for this Google account.`);
      }
      const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(title,index)`);
      return r.sheets.map((s) => s.properties).sort((a, b) => a.index - b.index).map((p) => p.title).filter((t) => t !== LATEST_TAB);
    },
    async rows(tab) {
      const range = encodeURIComponent(`${quote(tab)}!A1:N`);
      const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
      return r.values ?? [];
    },
  };
}

/* ---------- loading ---------- */
function setStatus(text) { $('#status').textContent = text; }

async function load({ quiet = false } = {}) {
  if (state.busy || !state.source?.signedIn) return;
  state.busy = true;
  if (!quiet) setStatus('Loading…');
  try {
    state.items = await state.source.items();
    state.latest = parseLatestRows(await state.source.rows(LATEST_TAB));
    if (state.selected !== '__all' && !state.items.includes(state.selected)) state.selected = '__all';
    state.points = state.selected === '__all' ? [] : parseItemRows(await state.source.rows(state.selected));
    state.loadedAt = Date.now();
    render({ refit: !quiet });
  } catch (e) {
    if (e.signedOut) renderSignIn('Your Google sign-in expired. Sign in again to keep the map live.');
    else renderError(e.message);
  } finally {
    state.busy = false;
    updateStatus();
  }
}

function updateStatus() {
  if (!state.loadedAt) return;
  const newest = state.latest.reduce((m, p) => Math.max(m, p.time.getTime()), 0);
  setStatus(newest ? `last check ${clockTime(newest)}` : `updated ${clockTime(state.loadedAt)}`);
}

/* ---------- rendering ---------- */
function renderChips() {
  const chip = (value, label) => `<button class="chip" data-item="${esc(value)}" aria-pressed="${state.selected === value}">${esc(label)}</button>`;
  $('#items').innerHTML = chip('__all', 'All items') + state.items.map((t) => chip(t, t)).join('');
  $('#items').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => selectItem(b.dataset.item)));
  $('#items .chip[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function selectItem(item) {
  state.selected = item; state.day = null; store.set('trails.item', item);
  renderChips();
  if (item === '__all') { state.points = []; render({ refit: true }); return; }
  $('#body').innerHTML = '<p class="note">Loading trail…</p>';
  try {
    state.points = parseItemRows(await state.source.rows(item));
    render({ refit: true });
  } catch (e) {
    if (e.signedOut) renderSignIn('Your Google sign-in expired. Sign in again to keep the map live.');
    else renderError(e.message);
  }
}

function render({ refit }) {
  renderChips();
  layer.clearLayers(); scrubMarker = null;
  if (state.selected === '__all') renderAll(refit); else renderItem(refit);
}

function renderAll(refit) {
  const latest = [...state.latest].sort((a, b) => b.time - a.time);
  if (!latest.length) {
    $('#body').innerHTML = '<div class="note"><strong>No locations yet</strong>The tracker on your Mac hasn\'t logged an exact location yet. It checks every 5 minutes.</div>';
    return;
  }
  const pts = [];
  for (const p of latest) {
    const ll = [p.lat, p.lon]; pts.push(ll);
    L.marker(ll, { icon: icon('pin-stop'), keyboard: false }).addTo(layer);
    L.marker(ll, { icon: labelIcon(p.item), interactive: true, keyboard: false })
      .on('click', () => selectItem(p.item)).addTo(layer);
  }
  if (refit) fit(pts);
  $('#body').innerHTML = `<ol class="timeline">${latest.map((p, i) => `
    <li class="seg" tabindex="0" style="animation-delay:${i * 30}ms" data-item="${esc(p.item)}">
      <div class="when">${esc(p.time.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' }))} · ${clockTime(p.time)}</div>
      <div class="what">${esc(p.item)}</div>
      <div class="addr">${esc(p.place || p.address || p.shows)}</div>
    </li>`).join('')}</ol>${actions()}`;
  $('#body').querySelectorAll('.seg').forEach((li) => {
    const go = () => selectItem(li.dataset.item);
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  wireActions();
}

function renderItem(refit) {
  const days = daysWithData(state.points);
  if (!days.length) {
    $('#body').innerHTML = `<div class="note"><strong>No exact locations for ${esc(state.selected)}</strong>Find My hasn't shown an exact pin for this item yet, so there's nothing to draw.</div>${actions()}`;
    wireActions();
    return;
  }
  const today = dayKey(new Date());
  state.day ??= days.includes(today) ? today : days[0];
  const pts = pointsForDay(state.points, state.day);
  const tl = buildTimeline(pts);
  const stops = tl.filter((s) => s.kind === 'stop');
  const idx = days.indexOf(state.day);
  const early = css('--trail-early'), late = css('--accent');

  // Trail: one short line per hop, shading from early (pale) to late (accent).
  const lls = pts.map((p) => [p.lat, p.lon]);
  for (let i = 1; i < lls.length; i++) {
    L.polyline([lls[i - 1], lls[i]], { color: mix(early, late, i / (lls.length - 1)), weight: 4, opacity: .9, lineCap: 'round' }).addTo(layer);
  }
  pts.forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 2.5, weight: 0, fillOpacity: .9, fillColor: mix(early, late, lls.length > 1 ? i / (lls.length - 1) : 1) }).addTo(layer));
  stops.forEach((s) => {
    L.marker([s.lat, s.lon], { icon: icon('pin-stop'), keyboard: false })
      .bindPopup(`<b>${esc(s.label)}</b><br>${clockTime(s.start)} – ${clockTime(s.end)} · ${describeDuration(s.end - s.start)}<br>${esc(s.address)}`)
      .addTo(layer);
  });
  const last = pts.at(-1);
  if (last.accuracy) L.circle([last.lat, last.lon], { radius: last.accuracy, color: late, weight: 1, fillOpacity: .08 }).addTo(layer);
  L.marker([last.lat, last.lon], { icon: icon('pin-now'), keyboard: false, zIndexOffset: 1000 })
    .bindPopup(`<b>${esc(state.selected)}</b><br>${clockTime(last.time)} · ${esc(last.place || last.address)}`).addTo(layer);
  if (refit) fit(lls);

  const first = pts[0].time.getTime(), lastMs = last.time.getTime();
  const dayLabel = new Date(`${state.day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  $('#body').innerHTML = `
    <div class="day">
      <button id="older" aria-label="Previous day with data" ${idx >= days.length - 1 ? 'disabled' : ''}>‹</button>
      <label>${state.day === today ? 'Today · ' : ''}${dayLabel}<input id="pick" type="date" value="${state.day}" min="${days.at(-1)}" max="${days[0]}" aria-label="Pick a day"></label>
      <button id="newer" aria-label="Next day with data" ${idx <= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="stats">
      <div><b>${describeDistance(pathMeters(pts))}</b><small>travelled</small></div>
      <div><b>${stops.length}</b><small>${stops.length === 1 ? 'stop' : 'stops'}</small></div>
      <div><b>${pts.length}</b><small>readings</small></div>
    </div>
    ${pts.length > 1 ? `<div class="scrub">
      <div class="scrub-row"><span>${clockTime(first)}</span><b id="scrubTime">${clockTime(lastMs)}</b><span>${clockTime(lastMs)}</span></div>
      <input id="scrub" type="range" min="${first}" max="${lastMs}" step="60000" value="${lastMs}" aria-label="Where was it at this time">
    </div>` : ''}
    <ol class="timeline">${[...tl].reverse().map((s, i) => `
      <li class="seg ${s.kind}" tabindex="0" style="animation-delay:${i * 30}ms" data-lat="${s.lat}" data-lon="${s.lon}">
        <div class="when">${clockTime(s.start)}${s.end > s.start ? ` – ${clockTime(s.end)} · ${describeDuration(s.end - s.start)}` : ''}</div>
        <div class="what">${s.kind === 'stop' ? esc(s.label) : `Moving · ${describeDistance(pathMeters(s.points))}`}</div>
        ${s.kind === 'stop' && s.address && s.address !== s.label ? `<div class="addr">${esc(s.address)}</div>` : ''}
      </li>`).join('')}</ol>
    ${actions()}`;

  const goDay = (d) => { if (d) { state.day = d; render({ refit: true }); } };
  $('#older')?.addEventListener('click', () => goDay(days[idx + 1]));
  $('#newer')?.addEventListener('click', () => goDay(days[idx - 1]));
  $('#pick')?.addEventListener('change', (e) => {
    const want = e.target.value;
    goDay(days.includes(want) ? want : days.find((d) => d <= want) ?? days.at(-1));
  });
  $('#scrub')?.addEventListener('input', (e) => {
    const ms = Number(e.target.value);
    const p = positionAt(pts, ms);
    $('#scrubTime').textContent = clockTime(ms);
    if (!p) return;
    scrubMarker ??= L.circleMarker([p.lat, p.lon], { radius: 9, color: css('--ink'), weight: 2, fillColor: css('--panel'), fillOpacity: 1 }).addTo(layer);
    scrubMarker.setLatLng([p.lat, p.lon]);
    if (!map.getBounds().contains(scrubMarker.getLatLng())) map.panTo([p.lat, p.lon]);
  });
  $('#body').querySelectorAll('.seg').forEach((li) => {
    const go = () => map.flyTo([Number(li.dataset.lat), Number(li.dataset.lon)], Math.max(map.getZoom(), 16), { duration: .6 });
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  wireActions();
}

const actions = () => `<div class="row-actions"><button class="btn ghost" id="refresh">Refresh now</button></div>`;
function wireActions() { $('#refresh')?.addEventListener('click', () => load()); }

function renderSignIn(message) {
  layer.clearLayers();
  $('#items').innerHTML = '';
  $('#body').innerHTML = `<div class="note"><strong>Private map</strong>${esc(message || 'Sign in with the Google account that owns your Find My Tracker sheet. The page reads it straight from Google; nothing is stored here.')}
    <div><button class="btn" id="signin">Sign in with Google</button></div></div>`;
  $('#signin').addEventListener('click', async () => {
    try { await state.source.signIn(); await load(); } catch (e) { renderSignIn(e.message); }
  });
  setStatus('');
}

function renderError(message) {
  $('#body').innerHTML = `<div class="note"><strong>Couldn't load the trail</strong>${esc(message)}<div><button class="btn" id="retry">Try again</button></div></div>`;
  $('#retry').addEventListener('click', () => load());
}

/* ---------- panel + refresh ---------- */
$('#grab').addEventListener('click', () => {
  const collapsed = $('#panel').classList.toggle('collapsed');
  $('#grab').setAttribute('aria-expanded', String(!collapsed));
});
setInterval(() => { if (document.visibilityState === 'visible') load({ quiet: true }); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loadedAt && Date.now() - state.loadedAt > REFRESH_MS) load({ quiet: true });
});

/* ---------- start ---------- */
const demo = new URLSearchParams(location.search).has('demo');
if (demo) {
  state.source = demoSource();
  load();
} else if (!CLIENT_ID) {
  $('#body').innerHTML = '<div class="note"><strong>Almost ready</strong>This page still needs its Google sign-in ID. Until then you can <a href="?demo">preview it with sample data</a>.</div>';
} else {
  state.source = googleSource();
  renderSignIn();
}
