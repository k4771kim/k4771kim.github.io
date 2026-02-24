import { chromium, devices } from 'playwright';
import fs from 'fs/promises';

const url = 'https://k4771kim.github.io';
const outDir = '.tmp/pw-audit';

async function runDesktop() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.screenshot({ path: `${outDir}/desktop-full.png`, fullPage: true });

  const data = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(el => ({ tag: el.tagName, text: el.textContent?.trim() || '' }));
    const links = Array.from(document.querySelectorAll('a')).map(a => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') || '', aria: a.getAttribute('aria-label') || '' }));
    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({ text: (b.textContent || '').trim(), aria: b.getAttribute('aria-label') || '' }));
    const sectionIds = Array.from(document.querySelectorAll('section[id]')).map(s => s.id);
    return { title: document.title, headings, links, buttons, sectionIds };
  });

  await fs.writeFile(`${outDir}/desktop-structure.json`, JSON.stringify(data, null, 2));
  await browser.close();
}

async function runMobile() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.screenshot({ path: `${outDir}/mobile-full.png`, fullPage: true });
  await browser.close();
}

await runDesktop();
await runMobile();
console.log('captured');
