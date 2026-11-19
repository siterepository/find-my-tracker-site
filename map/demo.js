// Sample data for ?demo: made-up items around public places, in the sheet's own row format.
import { dayKey } from './history.js';

const HEADER = ['Date', 'Time (Mountain)', 'Latitude', 'Longitude', 'Find My accuracy (± m)', 'Matches Find My pin (± m)',
  'Address', 'Place', 'Category', 'Find My shows', 'Find My last update', 'Change', 'Map'];
const PLACES = [
  { name: 'Library', lat: 40.7596, lon: -111.8853, address: '210 E 400 S, Salt Lake City, UT 84111', category: 'library' },
  { name: 'Coffee shop', lat: 40.7637, lon: -111.8900, address: '55 W 200 S, Salt Lake City, UT 84101', category: 'cafe' },
  { name: 'Gym', lat: 40.7473, lon: -111.8778, address: '1200 S State St, Salt Lake City, UT 84111', category: 'gym' },
  { name: 'Park', lat: 40.7397, lon: -111.8722, address: 'Liberty Park, Salt Lake City, UT 84105', category: 'park' },
];

function fmtTime(d) {
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(d);
  return t.replace(/ /g, ' ');
}

function itemRows(seed, route) {
  const rows = [];
  const now = Date.now();
  const start = now - 30 * 3600 * 1000;
  let step = 0;
  for (let t = start; t <= now; t += 5 * 60 * 1000, step++) {
    const leg = Math.floor(step / 24) % route.length;
    const a = PLACES[route[leg]], b = PLACES[route[(leg + 1) % route.length]];
    const k = step % 24;
    const moving = k >= 20; // last 4 readings of each 2-hour block travel to the next place
    const f = moving ? (k - 19) / 5 : 0;
    const jitter = ((seed * 9301 + step * 49297) % 233280) / 233280 - 0.5;
    const lat = a.lat + (b.lat - a.lat) * f + jitter * 0.00008;
    const lon = a.lon + (b.lon - a.lon) * f + jitter * 0.00008;
    const at = moving ? null : a;
    rows.push([dayKey(new Date(t)), fmtTime(new Date(t)), lat, lon, 8 + Math.round(Math.abs(jitter) * 20), 0.4,
      at ? at.address : '', at ? at.name : '', at ? at.category : 'street', at ? `Near ${at.name}` : 'Moving', '', moving ? 'Moved' : 'Same place', '']);
  }
  return [HEADER, ...rows.reverse()];
}

export function demoSource() {
  const data = { 'Keys (demo)': itemRows(1, [0, 1, 2, 3]), 'Backpack (demo)': itemRows(2, [3, 1]) };
  return {
    kind: 'demo',
    signedIn: true,
    async items() { return Object.keys(data); },
    async rows(tab) {
      if (tab === 'Latest') return [['Item', ...HEADER], ...Object.entries(data).map(([k, v]) => [k, ...v[1]])];
      return data[tab] ?? [];
    },
  };
}
