// Pure logic for the map page: sheet rows → timed points → day timeline.
// No DOM, no network, so it runs under `node --test` as well as in the browser.

export const ZONE = 'America/Denver';
const COL = { date: 0, time: 1, lat: 2, lon: 3, acc: 4, match: 5, address: 6, place: 7, category: 8, shows: 9, seen: 10, change: 11 };
const ABBR_OFFSET = { MST: -7, MDT: -6 };
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Offset of America/Denver from UTC, in hours, at an instant. */
function zoneOffsetHours(instantMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  const asUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return Math.round((asUTC - instantMs) / 3600000);
}

/** Wall-clock Mountain time → instant, honouring the zone's offset on that day. */
function mountainToInstant(y, mo, d, h, mi, s, abbr) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (abbr in ABBR_OFFSET) return new Date(wall - ABBR_OFFSET[abbr] * 3600000);
  const guess = wall - zoneOffsetHours(wall) * 3600000;
  return new Date(wall - zoneOffsetHours(guess) * 3600000);
}

/**
 * The sheet's Date ("2026-11-19") and Time ("11:27:03 PM MST") cells → Date.
 * Also accepts Sheets serial numbers, in case a cell was stored as a real date.
 */
export function parseTime(dateCell, timeCell) {
  let y, mo, d;
  if (typeof dateCell === 'number') {
    const dt = new Date(SHEETS_EPOCH_MS + Math.floor(dateCell) * 86400000);
    [y, mo, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateCell ?? '').trim());
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  let h, mi, s, abbr = '';
  if (typeof timeCell === 'number') {
    const secs = Math.round((timeCell % 1) * 86400);
    [h, mi, s] = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  } else {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*([A-Z]{2,5})?$/i.exec(String(timeCell ?? '').trim());
    if (!m) return null;
    h = Number(m[1]) % 12 + (m[4].toUpperCase() === 'PM' ? 12 : 0);
    [mi, s, abbr] = [Number(m[2]), Number(m[3] ?? 0), (m[5] ?? '').toUpperCase()];
  }
  return mountainToInstant(y, mo, d, h, mi, s, abbr);
}

const num = (v) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v == null ? '' : String(v).trim());

function toPoint(r, offset = 0) {
  const time = parseTime(r[offset + COL.date], r[offset + COL.time]);
  const lat = num(r[offset + COL.lat]);
  const lon = num(r[offset + COL.lon]);
  if (!time || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    time, lat, lon,
    accuracy: num(r[offset + COL.acc]),
    pinMatch: num(r[offset + COL.match]),
    address: text(r[offset + COL.address]),
    place: text(r[offset + COL.place]),
    category: text(r[offset + COL.category]),
    shows: text(r[offset + COL.shows]),
    change: text(r[offset + COL.change]),
  };
}

/** An item tab's values (header included or not) → points, oldest first. */
export function parseItemRows(rows) {
  return (rows ?? []).map((r) => toPoint(r)).filter(Boolean).sort((a, b) => a.time - b.time);
}

/** The Latest tab (Item column first) → one point per item. */
export function parseLatestRows(rows) {
  return (rows ?? []).map((r) => {
    const p = toPoint(r, 1);
    return p && { item: text(r[0]), ...p };
  }).filter(Boolean);
}

/** "2026-11-19" for the Mountain calendar day an instant falls on. */
export function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export const pointsForDay = (points, key) => points.filter((p) => dayKey(p.time) === key);

/** Days that have readings, newest first. */
export const daysWithData = (points) => [...new Set(points.map((p) => dayKey(p.time)))].sort().reverse();

export function meters(a, b) {
  const r = 6371008.8, rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How far two readings must be apart to count as movement (same rule as the sheet's Change column). */
const moveThreshold = (a, b) => Math.max(30, 2 * (a.pinMatch ?? 0), 2 * (b.pinMatch ?? 0), a.accuracy ?? 0, b.accuracy ?? 0);

/**
 * Groups a day's points into stops and moves. A run is consecutive readings within the move
 * threshold of the run's first reading. Runs of 2+ readings are stops; single readings are
 * moves (joined when consecutive), except the last run, which is where the item is now.
 */
export function buildTimeline(points) {
  const runs = [];
  for (const p of points) {
    const run = runs.at(-1);
    if (run && meters(run[0], p) <= moveThreshold(run[0], p)) run.push(p);
    else runs.push([p]);
  }
  const out = [];
  runs.forEach((run, i) => {
    const kind = run.length > 1 || i === runs.length - 1 ? 'stop' : 'move';
    const prev = out.at(-1);
    if (kind === 'move' && prev?.kind === 'move') prev.points.push(...run);
    else out.push({ kind, points: [...run] });
  });
  return out.map((s) => {
    const first = s.points[0];
    const named = s.points.find((p) => p.place) ?? first;
    return {
      kind: s.kind, points: s.points,
      start: first.time.getTime(), end: s.points.at(-1).time.getTime(),
      lat: s.points.reduce((t, p) => t + p.lat, 0) / s.points.length,
      lon: s.points.reduce((t, p) => t + p.lon, 0) / s.points.length,
      label: named.place || named.address || named.category || 'Unnamed spot',
      address: named.address,
    };
  });
}

/** Distance travelled across consecutive readings, ignoring jitter within accuracy. */
export function pathMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = meters(points[i - 1], points[i]);
    if (d > moveThreshold(points[i - 1], points[i])) total += d;
  }
  return total;
}

/** The latest reading at or before `ms`, or null. */
export function positionAt(points, ms) {
  let best = null;
  for (const p of points) { if (p.time.getTime() <= ms) best = p; else break; }
  return best;
}

export function describeDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under 1m';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function describeDistance(m) {
  const miles = m / 1609.344;
  return miles >= 0.2 ? `${miles.toFixed(1)} mi` : `${Math.round(m)} m`;
}

export function clockTime(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}
