import { chromium } from 'playwright';
import fs from 'fs/promises';

const url = 'https://k4771kim.github.io';
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
    const vh = window.innerHeight;
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
          text: (el.textContent || '').trim().slice(0, 40),
          aria: el.getAttribute('aria-label') || '',
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter(t => t.w < 40 || t.h < 40)
      .slice(0, 20);

    const styleOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, lineHeight: s.lineHeight, color: s.color };
    };

    return {
      viewport: { vw, vh },
      overflow: { maxRight: Math.round(maxRight), minLeft: Math.round(minLeft), overflowCount },
      counts: {
        sections: document.querySelectorAll('section').length,
        h1: document.querySelectorAll('h1').length,
        h2: document.querySelectorAll('h2').length,
        h3: document.querySelectorAll('h3').length,
        links: document.querySelectorAll('a').length,
        buttons: document.querySelectorAll('button').length,
      },
      sampleStyles: {
        h1: styleOf('h1'),
        p: styleOf('p'),
        navLink: styleOf('nav a'),
      },
      smallTargets,
    };
  });

  report.push({ name: vp.name, ...data });
  await page.close();
}

await browser.close();
await fs.writeFile('.tmp/pw-audit/metrics.json', JSON.stringify(report, null, 2));
console.log('ok');
