import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('https://k4771kim.github.io', { waitUntil: 'networkidle' });
await page.screenshot({ path: '.tmp/pw-audit/desktop-hero.png' });
await page.locator('#projects').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: '.tmp/pw-audit/desktop-projects.png' });
await browser.close();
console.log('ok');
