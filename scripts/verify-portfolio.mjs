import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PORTFOLIO_URL ?? 'http://127.0.0.1:4321';
const screenshotDir = new URL('../.omx/qa/portfolio/', import.meta.url);
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
];
const expectedCounts = {
  all: 6,
  'AI Agent': 1,
  Web: 2,
  Mobile: 3,
};
const expectedProjectTitles = [
  'Linchpin',
  'HDHub',
  'Allatte',
  'Boolio',
  'Elice Mobile',
  '포룸 인테리어',
];

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').waitFor();
    await page.waitForTimeout(500);

    const h1 = (await page.locator('h1').innerText()).replaceAll('\n', ' ');
    assert.match(h1, /AI Agent\s+&\s+Full-Stack\s+Engineer/);

    const firstSkill = page.locator('button[aria-controls^="skill-panel-"]').first();
    await firstSkill.waitFor();
    assert.match(await firstSkill.innerText(), /AI Agent Engineering/);
    assert.equal(await firstSkill.getAttribute('aria-expanded'), 'true');

    await page.screenshot({
      path: new URL(`${viewport.name}-hero.png`, screenshotDir).pathname,
    });

    const linchpinTags = await page
      .locator('[data-areas="AI Agent"] [aria-label="Linchpin 기술 스택"] span')
      .allTextContents();
    const normalizedTags = linchpinTags.map((tag) => tag.trim());
    assert.ok(normalizedTags.includes('LangChain · LangGraph'));
    assert.ok(!normalizedTags.includes('LangChain'));
    assert.ok(!normalizedTags.includes('LangGraph'));

    const hdhubCard = page.locator('#project-grid > div').filter({ hasText: 'HDHub' }).first();
    assert.match(await hdhubCard.locator('img').getAttribute('src'), /hdhub-logo/);
    await hdhubCard.screenshot({
      path: new URL(`${viewport.name}-hdhub-card.png`, screenshotDir).pathname,
    });

    const projectTitles = await page.locator('#project-grid h4').allTextContents();
    assert.deepEqual(
      projectTitles.map((title) => title.trim()),
      expectedProjectTitles,
    );
    assert.equal(await page.locator('.modal').count(), expectedProjectTitles.length);

    const filterLabels = await page.locator('.filter-btn').allTextContents();
    assert.deepEqual(
      filterLabels.map((label) => label.trim()),
      ['All', 'AI Agent', 'Web', 'Mobile'],
    );

    for (const [filter, expectedCount] of Object.entries(expectedCounts)) {
      await page.locator(`.filter-btn[data-filter="${filter}"]`).click();
      assert.equal(
        await page.locator('#project-grid > div:not([hidden])').count(),
        expectedCount,
        `${filter} filter count`,
      );
    }

    const aiAgentFilter = page.locator('.filter-btn[data-filter="AI Agent"]');
    await aiAgentFilter.focus();
    await aiAgentFilter.press('Enter');
    assert.equal(await aiAgentFilter.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#project-grid > div:not([hidden])').count(), 1);

    await page.locator('#projects').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: new URL(`${viewport.name}-projects.png`, screenshotDir).pathname,
    });

    const detailButton = page.locator('#project-grid > div:not([hidden]) .detail-btn').first();
    const modalId = await detailButton.getAttribute('data-modal-target');
    assert.ok(modalId);
    await detailButton.focus();
    await detailButton.press('Enter');
    assert.equal(await page.locator(`#${modalId}`).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`#${modalId}`).isHidden(), true);

    const allFilter = page.locator('.filter-btn[data-filter="all"]');
    await allFilter.focus();
    await allFilter.press('Space');
    assert.equal(await allFilter.getAttribute('aria-pressed'), 'true');
    assert.equal(
      await page.locator('#project-grid > div:not([hidden])').count(),
      expectedCounts.all,
    );

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `${viewport.name} horizontal overflow`,
    );
    assert.deepEqual(pageErrors, [], `${viewport.name} page errors`);
    assert.deepEqual(consoleErrors, [], `${viewport.name} console errors`);

    await page.close();
  }
} finally {
  await browser.close();
}

console.log('Portfolio verification passed for mobile, tablet, and desktop viewports.');
