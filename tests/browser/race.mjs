// Browser probe for map/. Run: python3 -m http.server 8765 (repo root), then: npx -y -p playwright@1.48.2 node tests/browser/race.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const demoSrc = fs.readFileSync(new URL('../../map/demo.js', import.meta.url), 'utf8');
const body = demoSrc.replace('async rows(tab) {', "async rows(tab) { if (window.__slow && tab === window.__slow) await new Promise((r) => setTimeout(r, 1500)); if (window.__fail && tab === 'Latest') throw new Error('Failed to fetch');");
if (body === demoSrc) throw new Error('needle');
const b = await chromium.launch();
for (const mode of ['quiet-fails', 'quiet-ok']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { const si = window.setInterval; window.setInterval = (fn, ms) => { window.__tick = fn; return si(() => {}, 1e9); }; });
  await p.route('**/map/demo.js', (r) => r.fulfill({ contentType: 'text/javascript', body }));
  await p.goto('http://127.0.0.1:8765/map/?demo', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  // user taps Keys; while its rows are loading the 5-min quiet refresh fires
  await p.evaluate(() => { window.__slow = 'Keys (demo)'; });
  await p.click('.chip[data-item="Keys (demo)"]');
  await p.waitForTimeout(200);
  await p.evaluate((m) => { window.__slow = null; if (m === 'quiet-fails') window.__fail = true; window.__tick(); }, mode);
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ pressed: document.querySelector('.chip[aria-pressed="true"]')?.textContent, body: document.querySelector('#body').textContent.replace(/\s+/g, ' ').trim().slice(0, 60), status: document.querySelector('#status').textContent, pinNow: !!document.querySelector('.pin-now'), pinNowInView: (() => { const e = document.querySelector('.pin-now'); if (!e) return null; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && !document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#panel'); })() }));
  console.log(mode, JSON.stringify(r), 'errors:', errs.length ? errs : 'none');
  await ctx.close();
}
await b.close();
