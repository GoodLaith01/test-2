import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on('console', (m) => console.log('[console]', m.type(), m.text()));
p.on('requestfailed', (r) => console.log('[failed]', r.url().slice(0, 120), r.failure()?.errorText));
await p.goto('https://goodlaith01.github.io/test-2/', { waitUntil: 'networkidle' });
await p.click('.nav-btn[data-goto=search]');
for (const q of ['adele', 'lofi']) {
  await p.fill('#search', q);
  await p.waitForTimeout(5000);
  console.log(`--- query ${q} ---`);
  console.log(await p.$$eval('.result-section', (s) => s.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 600))));
  const imgs = await p.$$eval('.thumb', (i) => i.map((x) => x.tagName === 'IMG' ? `${x.naturalWidth}x${x.naturalHeight}` : 'placeholder'));
  console.log('thumbs', JSON.stringify(imgs));
  const shot = await p.screenshot({ type: 'jpeg', quality: 40, fullPage: false });
  console.log(`SHOT_${q}:` + shot.toString('base64'));
}
await b.close();
