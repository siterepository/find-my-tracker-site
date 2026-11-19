// Run: node --test map/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTime, parseItemRows, parseLatestRows, dayKey, pointsForDay, buildTimeline,
  pathMeters, positionAt, describeDuration, describeDistance, daysWithData,
} from './history.js';

const HEADER = ['Date', 'Time (Mountain)', 'Latitude', 'Longitude', 'Find My accuracy (± m)',
  'Matches Find My pin (± m)', 'Address', 'Place', 'Category', 'Find My shows',
  'Find My last update', 'Change', 'Map'];

const row = (date, time, lat, lon, extra = {}) => [
  date, time, lat, lon, extra.acc ?? '', extra.match ?? '', extra.address ?? '1 Main St',
  extra.place ?? '', extra.category ?? 'street', extra.shows ?? 'Near Home', '', extra.change ?? 'Same place', 'Open map',
];

test('parseTime reads Mountain standard and daylight times as exact instants', () => {
  assert.equal(parseTime('2026-11-19', '11:27:03 PM MST').toISOString(), '2026-11-20T06:27:03.000Z');
  assert.equal(parseTime('2026-07-04', '12:05:00 AM MDT').toISOString(), '2026-07-04T06:05:00.000Z');
  assert.equal(parseTime('2026-07-04', '12:05:00 PM MDT').toISOString(), '2026-07-04T18:05:00.000Z');
});

test('parseTime accepts Sheets serial numbers for date and time', () => {
  // 46345 = 2026-11-19; 0.5 = noon. Mountain standard time in November.
  assert.equal(parseTime(46345, 0.5).toISOString(), '2026-11-19T19:00:00.000Z');
});

test('parseTime returns null for junk', () => {
  assert.equal(parseTime('', ''), null);
  assert.equal(parseTime('2026-11-19', 'noonish'), null);
});

test('parseItemRows skips the header, rows without coordinates, and sorts oldest first', () => {
  const rows = [
    HEADER,
    row('2026-11-19', '10:10:00 AM MST', 40.5, -111.9, { change: 'Moved 1.2 mi' }),
    row('2026-11-19', '10:05:00 AM MST', '', '', { shows: 'No location found' }),
    row('2026-11-19', '10:00:00 AM MST', '40.4', '-111.8', { acc: '12', match: '0.4' }),
  ];
  const pts = parseItemRows(rows);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].lat, 40.4);
  assert.equal(pts[0].accuracy, 12);
  assert.equal(pts[1].change, 'Moved 1.2 mi');
  assert.ok(pts[0].time < pts[1].time);
});

test('parseItemRows ignores out-of-range coordinates', () => {
  const pts = parseItemRows([row('2026-11-19', '10:00:00 AM MST', 140, -111.9)]);
  assert.equal(pts.length, 0);
});

test('parseLatestRows reads the Latest tab item column', () => {
  const rows = [['Item', ...HEADER], ['Keys', ...row('2026-11-19', '10:00:00 AM MST', 40.4, -111.8)]];
  const items = parseLatestRows(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].item, 'Keys');
  assert.equal(items[0].lat, 40.4);
});

test('dayKey uses the Mountain calendar day, not UTC', () => {
  assert.equal(dayKey(new Date('2026-11-20T06:27:03Z')), '2026-11-19');
});

test('pointsForDay keeps only that Mountain day', () => {
  const pts = parseItemRows([
    row('2026-11-18', '11:59:00 PM MST', 40, -111),
    row('2026-11-19', '12:01:00 AM MST', 40, -111),
  ]);
  assert.equal(pointsForDay(pts, '2026-11-19').length, 1);
  assert.deepEqual(daysWithData(pts), ['2026-11-19', '2026-11-18']);
});

test('buildTimeline merges nearby readings into stops and keeps moves between them', () => {
  const t = (m) => `10:${String(m).padStart(2, '0')}:00 AM MST`;
  const pts = parseItemRows([
    row('2026-11-19', t(0), 40.0, -111.0, { place: 'Home' }),
    row('2026-11-19', t(5), 40.00005, -111.0),
    row('2026-11-19', t(10), 40.0001, -111.0),
    row('2026-11-19', t(15), 40.05, -111.0),
    row('2026-11-19', t(20), 40.1, -111.0, { place: 'Store' }),
    row('2026-11-19', t(25), 40.10002, -111.0),
  ]);
  const tl = buildTimeline(pts);
  assert.deepEqual(tl.map((s) => s.kind), ['stop', 'move', 'stop']);
  assert.equal(tl[0].points.length, 3);
  assert.equal(tl[0].label, 'Home');
  assert.equal(tl[0].end - tl[0].start, 10 * 60000);
  assert.equal(tl[2].label, 'Store');
});

test('buildTimeline joins consecutive single readings into one move and ends on a stop', () => {
  const t = (m) => `10:${String(m).padStart(2, '0')}:00 AM MST`;
  const pts = parseItemRows([
    row('2026-11-19', t(0), 40.0, -111.0),
    row('2026-11-19', t(5), 40.0, -111.0),
    row('2026-11-19', t(10), 40.02, -111.0),
    row('2026-11-19', t(15), 40.04, -111.0),
    row('2026-11-19', t(20), 40.06, -111.0),
  ]);
  const tl = buildTimeline(pts);
  assert.deepEqual(tl.map((s) => `${s.kind}:${s.points.length}`), ['stop:2', 'move:2', 'stop:1']);
});

test('buildTimeline handles empty and single-point days', () => {
  assert.deepEqual(buildTimeline([]), []);
  const one = buildTimeline(parseItemRows([row('2026-11-19', '10:00:00 AM MST', 40, -111)]));
  assert.equal(one.length, 1);
  assert.equal(one[0].kind, 'stop');
});

test('pathMeters ignores jitter inside the accuracy radius', () => {
  const pts = parseItemRows([
    row('2026-11-19', '10:00:00 AM MST', 40.0, -111.0),
    row('2026-11-19', '10:05:00 AM MST', 40.00003, -111.0),
    row('2026-11-19', '10:10:00 AM MST', 40.01, -111.0),
  ]);
  const m = pathMeters(pts);
  assert.ok(m > 1100 && m < 1120, String(m));
});

test('positionAt returns the latest reading at or before a time', () => {
  const pts = parseItemRows([
    row('2026-11-19', '10:00:00 AM MST', 40.0, -111.0),
    row('2026-11-19', '10:10:00 AM MST', 41.0, -111.0),
  ]);
  assert.equal(positionAt(pts, pts[0].time.getTime() + 60000).lat, 40);
  assert.equal(positionAt(pts, pts[1].time.getTime()).lat, 41);
  assert.equal(positionAt(pts, pts[0].time.getTime() - 1), null);
});

test('describe helpers', () => {
  assert.equal(describeDuration(4 * 3600000 + 25 * 60000), '4h 25m');
  assert.equal(describeDuration(5 * 60000), '5m');
  assert.equal(describeDuration(0), 'under 1m');
  assert.equal(describeDistance(150), '150 m');
  assert.equal(describeDistance(1609.344 * 2.25), '2.3 mi');
});
