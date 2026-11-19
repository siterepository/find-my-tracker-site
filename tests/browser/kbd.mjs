// Browser probe for map/. Run: python3 -m http.server 8765 (repo root), then: npx -y -p playwright@1.48.2 node tests/browser/kbd.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();
const snap = (p) => p.evaluate(() => { const icons = [...document.querySelectorAll('.leaflet-marker-icon')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y); }); const z = [...document.querySelectorAll('.leaflet-tile')].map((t) => (t.src.match(/\/(\d+)\/\d+\/\d+/) || [])[1]).filter(Boolean); return { icons: icons.join(' '), zooms: [...new Set(z)].join(',') }; });
for (const mode of ['mouse', 'Space', 'Enter']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => sessionStorage.setItem('trails.item', 'Keys (demo)'));
  await p.goto('http://127.0.0.1:8765/map/?demo', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const segs = await p.$$('.seg');
  const target = segs[segs.length - 1]; // oldest row, away from the current pin
  const before = await snap(p);
  if (mode === 'mouse') await target.click(); else { await target.focus(); await p.keyboard.press(mode); }
  await p.waitForTimeout(1500);
  const after = await snap(p);
  console.log(mode, 'rows', segs.length, '| moved:', before.icons !== after.icons, '| zoom', before.zooms, '->', after.zooms);
  await ctx.close();
}
await b.close();
