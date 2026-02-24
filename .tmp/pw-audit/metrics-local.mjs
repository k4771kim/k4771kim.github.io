import { chromium, devices } from 'playwright';
import fs from 'fs/promises';

const url = 'http://127.0.0.1:4321';
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

const browser = await chromium.launch({ headless: true });
const report = [];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const data = await page.evaluate(() => {
    const vw = window.innerWidth;
    const all = Array.from(document.querySelectorAll('body *'));
    let maxRight = 0;
    let minLeft = 0;
    let overflowCount = 0;

    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
      if (r.right > maxRight) maxRight = r.right;
      if (r.left < minLeft) minLeft = r.left;
      if (r.right > vw + 1 || r.left < -1) overflowCount += 1;
    }

    const clickable = Array.from(document.querySelectorAll('a,button,[role="button"]'));
    const smallTargets = clickable
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 30),
          aria: el.getAttribute('aria-label') || '',
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter(t => t.w < 44 || t.h < 44)
      .slice(0, 20);

    return {
      overflow: { maxRight: Math.round(maxRight), minLeft: Math.round(minLeft), overflowCount },
      smallTargets,
      sections: Array.from(document.querySelectorAll('section[id]')).map(s => s.id),
    };
  });
  report.push({ name: vp.name, ...data });
  await page.close();
}

const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.screenshot({ path: '.tmp/pw-audit/local-mobile-full.png', fullPage: true });
await context.close();

const page2 = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
await page2.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page2.screenshot({ path: '.tmp/pw-audit/local-desktop-full.png', fullPage: true });
await page2.close();

await browser.close();
await fs.writeFile('.tmp/pw-audit/metrics-local.json', JSON.stringify(report, null, 2));
console.log('ok');
