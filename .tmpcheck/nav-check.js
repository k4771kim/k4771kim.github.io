const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:4322', { waitUntil: 'networkidle' });

  const before = await page.$eval('nav a[href="#home"]', (el) => el.classList.contains('active'));
  await page.click('nav a[href="#projects"]');
  await page.waitForTimeout(1000);
  const active = await page.$eval('nav a[href="#projects"]', (el) => el.classList.contains('active'));
  const y = await page.evaluate(() => window.scrollY);

  console.log(JSON.stringify({ before, active, y }));
  await browser.close();
})();
