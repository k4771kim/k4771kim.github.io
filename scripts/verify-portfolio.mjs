import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
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
const clientManifest = JSON.parse(
  await readFile(
    new URL('../dist/portfolio-client-manifest.json', import.meta.url),
    'utf8',
  ),
);
const heavyModulePatterns = [
  /^src\/React\/BodyGraphWrapper\.tsx$/,
  /^src\/data\/humanDesignData\.ts$/,
  /^node_modules\/@hdhub\/bodygraph-3d\//,
  /^node_modules\/@react-three\/fiber\//,
  /^node_modules\/@react-three\/drei\//,
  /^node_modules\/three\//,
];
const heavyOwnerFiles = Object.entries(clientManifest.chunks)
  .filter(([, chunk]) =>
    chunk.modules.some((moduleId) =>
      heavyModulePatterns.some((pattern) => pattern.test(moduleId)),
    ),
  )
  .map(([file]) => file);
const leafFile = Object.entries(clientManifest.chunks).find(([, chunk]) =>
  chunk.modules.includes('src/React/BodyGraphWrapper.tsx'),
)?.[0];

assert.ok(leafFile, 'BodyGraph lazy leaf is missing from the client manifest');
assert.deepEqual(
  heavyOwnerFiles,
  [leafFile],
  'BodyGraph-owned modules must be isolated in one lazy leaf',
);

const heavyResourcePaths = new Set(heavyOwnerFiles.map((file) => `/${file}`));

function internalUrl(url) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function sizeDelta(left, right) {
  return Math.max(
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
}

async function verifyBodyGraphBoundary(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const requestCounts = new Map(heavyOwnerFiles.map((file) => [file, 0]));
  const failedRequests = [];
  const failedResponses = [];
  const consoleErrors = [];
  const hydrationWarnings = [];
  const pageErrors = [];

  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.addInitScript(() => {
    window.__portfolioBodyGraph = {
      attributableLayoutShift: 0,
      listenerAdds: { touchmove: 0, wheel: 0 },
    };

    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (
        this instanceof HTMLCanvasElement &&
        (type === 'touchmove' || type === 'wheel')
      ) {
        window.__portfolioBodyGraph.listenerAdds[type] += 1;
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };

    new PerformanceObserver((list) => {
      const region = document.querySelector('[data-bodygraph-region]');
      if (!region) return;

      for (const entry of list.getEntries()) {
        const touchesRegion = entry.sources?.some(({ node }) =>
          node
            ? node === region || region.contains(node) || node.contains(region)
            : false,
        );
        if (!entry.hadRecentInput && touchesRegion) {
          window.__portfolioBodyGraph.attributableLayoutShift += entry.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (heavyResourcePaths.has(pathname)) {
      const file = pathname.slice(1);
      requestCounts.set(file, (requestCounts.get(file) ?? 0) + 1);
    }
  });
  page.on('requestfailed', (request) => {
    if (internalUrl(request.url())) failedRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (internalUrl(response.url()) && response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') consoleErrors.push(text);
    if (/hydration|did not match|server rendered|server html/i.test(text)) {
      hydrationWarnings.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const initial = await page.evaluate((resourcePaths) => {
      const region = document.querySelector('[data-bodygraph-region]');
      const shell = document.querySelector('[data-bodygraph-shell]');
      const placeholder = document.querySelector('[data-bodygraph-placeholder]');
      if (!region || !shell || !placeholder) return null;

      const box = (element) => {
        const { x, y, width, height, top } = element.getBoundingClientRect();
        return { x, y, width, height, top };
      };
      const resources = performance
        .getEntriesByType('resource')
        .filter((entry) => resourcePaths.includes(new URL(entry.name).pathname))
        .map((entry) => entry.name);

      return {
        region: box(region),
        shell: box(shell),
        placeholder: box(placeholder),
        distanceFromViewport: shell.getBoundingClientRect().top - innerHeight,
        resources,
        scrollY,
      };
    }, [...heavyResourcePaths]);

    assert.ok(initial, 'BodyGraph SSR shell and placeholder are missing');
    assert.equal(initial.scrollY, 0, 'mobile boundary test must begin at page top');
    assert.ok(
      initial.distanceFromViewport > 200,
      `BodyGraph shell is only ${initial.distanceFromViewport}px outside the viewport`,
    );
    assert.deepEqual(initial.resources, [], 'BodyGraph resource timing must be empty initially');
    assert.deepEqual(
      Object.fromEntries(requestCounts),
      Object.fromEntries(heavyOwnerFiles.map((file) => [file, 0])),
      'BodyGraph-owned chunks must not be requested before the 200px boundary',
    );
    assert.ok(sizeDelta(initial.shell, initial.placeholder) <= 1);

    await page.evaluate(() => {
      const shell = document.querySelector('[data-bodygraph-shell]');
      if (!shell) throw new Error('BodyGraph shell is missing');
      const targetScroll =
        scrollY + shell.getBoundingClientRect().top - innerHeight - 150;
      scrollTo({ top: targetScroll, behavior: 'instant' });
    });
    await page.locator('[data-bodygraph-leaf] canvas').waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const shell = document.querySelector('[data-bodygraph-shell]');
        const leaf = document.querySelector('[data-bodygraph-leaf]');
        const canvas = leaf?.querySelector('canvas');
        if (!shell || !leaf || !canvas) return false;

        const shellBox = shell.getBoundingClientRect();
        const leafBox = leaf.getBoundingClientRect();
        const canvasBox = canvas.getBoundingClientRect();
        return (
          shellBox.width > 0 &&
          shellBox.height > 0 &&
          Math.abs(shellBox.width - leafBox.width) <= 1 &&
          Math.abs(shellBox.height - leafBox.height) <= 1 &&
          Math.abs(leafBox.width - canvasBox.width) <= 1 &&
          Math.abs(leafBox.height - canvasBox.height) <= 1
        );
      },
      null,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(500);

    const rendered = await page.evaluate(() => {
      const shell = document.querySelector('[data-bodygraph-shell]');
      const leaf = document.querySelector('[data-bodygraph-leaf]');
      const canvas = leaf?.querySelector('canvas');
      if (!shell || !leaf || !canvas) return null;

      const box = (element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        shell: box(shell),
        leaf: box(leaf),
        canvas: box(canvas),
        layoutShift: window.__portfolioBodyGraph.attributableLayoutShift,
        listenerAdds: { ...window.__portfolioBodyGraph.listenerAdds },
        scrollY,
      };
    });

    assert.ok(rendered, 'BodyGraph did not render its lazy leaf and canvas');
    assert.equal(await page.locator('[data-bodygraph-leaf]').count(), 1);
    assert.equal(await page.locator('[data-bodygraph-leaf] canvas').count(), 1);
    assert.ok(sizeDelta(initial.shell, rendered.shell) <= 1);
    assert.ok(sizeDelta(initial.placeholder, rendered.leaf) <= 1);
    assert.ok(sizeDelta(rendered.leaf, rendered.canvas) <= 1);
    assert.equal(rendered.layoutShift, 0, 'BodyGraph caused an attributable layout shift');
    assert.equal(requestCounts.get(leafFile), 1, 'BodyGraph leaf must load exactly once');

    const loadedRequestCounts = Object.fromEntries(requestCounts);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(250);
    await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), rendered.scrollY);
    await page.waitForTimeout(500);

    const afterReentry = await page.evaluate(() => ({
      listenerAdds: { ...window.__portfolioBodyGraph.listenerAdds },
      leafCount: document.querySelectorAll('[data-bodygraph-leaf]').length,
      canvasCount: document.querySelectorAll('[data-bodygraph-leaf] canvas').length,
    }));
    assert.deepEqual(
      Object.fromEntries(requestCounts),
      loadedRequestCounts,
      'BodyGraph chunks were requested again after viewport re-entry',
    );
    assert.deepEqual(
      afterReentry.listenerAdds,
      rendered.listenerAdds,
      'BodyGraph registered duplicate canvas listeners after viewport re-entry',
    );
    assert.equal(afterReentry.leafCount, 1);
    assert.equal(afterReentry.canvasCount, 1);
    assert.deepEqual(failedRequests, [], 'internal request failures');
    assert.deepEqual(failedResponses, [], 'internal HTTP failures');
    assert.deepEqual(pageErrors, [], 'BodyGraph page errors');
    assert.deepEqual(consoleErrors, [], 'BodyGraph console errors');
    assert.deepEqual(hydrationWarnings, [], 'BodyGraph hydration warnings');
  } finally {
    await context.close();
  }
}

async function verifyDialogContract(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const triggers = page.locator('.detail-btn');
    assert.equal(await triggers.count(), expectedProjectTitles.length);

    const titleIds = new Set();
    for (let index = 0; index < expectedProjectTitles.length; index += 1) {
      const trigger = triggers.nth(index);
      const modalId = await trigger.getAttribute('data-modal-target');
      assert.ok(modalId, `project ${index + 1} has no dialog target`);

      const dialog = page.locator(`#${modalId}`);
      const labelledBy = await dialog.getAttribute('aria-labelledby');
      assert.ok(labelledBy, `${modalId} has no accessible name reference`);
      titleIds.add(labelledBy);
      assert.equal(await dialog.evaluate((element) => element.tagName), 'DIALOG');
      assert.equal(
        (await page.locator(`#${labelledBy}`).innerText()).trim(),
        expectedProjectTitles[index],
      );
      assert.equal(
        await dialog.locator('.modal-close').getAttribute('aria-label'),
        `${expectedProjectTitles[index]} 상세 닫기`,
      );

      for (const [pathIndex, closePath] of [
        'escape',
        'close-button',
        'backdrop',
      ].entries()) {
        const previousOverflow = pathIndex % 2 === 0 ? 'clip' : 'visible';
        await page.evaluate((overflow) => {
          document.body.style.overflow = overflow;
        }, previousOverflow);
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        await trigger.press((index + pathIndex) % 2 === 0 ? 'Enter' : 'Space');

        assert.equal(await dialog.evaluate((element) => element.open), true);
        assert.equal(await page.locator('dialog.modal[open]').count(), 1);
        assert.equal(
          await dialog.locator('.modal-close').evaluate(
            (button) => button === document.activeElement,
          ),
          true,
          `${modalId} did not focus its deterministic first control`,
        );
        assert.equal(
          await page.evaluate((id) => {
            const modal = document.getElementById(id);
            document.querySelector('#main-nav a')?.focus();
            return modal?.contains(document.activeElement) ?? false;
          }, modalId),
          true,
          `${modalId} allowed background focus while modal`,
        );

        await page.keyboard.press('Shift+Tab');
        const reverseTabState = await dialog.evaluate((element) => ({
          insideDialog: element.contains(document.activeElement),
          atDocumentBoundary: document.activeElement === document.body,
        }));
        assert.equal(
          reverseTabState.insideDialog || reverseTabState.atDocumentBoundary,
          true,
          `${modalId} moved reverse tab focus to background content`,
        );
        if (reverseTabState.atDocumentBoundary) {
          await page.keyboard.press('Tab');
          assert.equal(
            await dialog.evaluate((element) => element.contains(document.activeElement)),
            true,
            `${modalId} did not return focus from the document boundary`,
          );
        }

        await dialog.locator('[data-modal-panel]').click({
          position: { x: 24, y: 24 },
        });
        assert.equal(
          await dialog.evaluate((element) => element.open),
          true,
          `${modalId} closed after an inside-panel click`,
        );

        if (closePath === 'escape') {
          await page.keyboard.press('Escape');
        } else if (closePath === 'close-button') {
          await dialog.locator('.modal-close').click();
        } else {
          await dialog.click({ position: { x: 2, y: 2 } });
        }

        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
          (overflow) => document.body.style.overflow === overflow,
          previousOverflow,
        );
        assert.equal(await dialog.evaluate((element) => element.open), false);
        assert.equal(
          await trigger.evaluate((button) => button === document.activeElement),
          true,
          `${modalId} did not restore focus after ${closePath}`,
        );
        assert.equal(
          await page.evaluate(() => document.body.style.overflow),
          previousOverflow,
          `${modalId} did not restore body overflow after ${closePath}`,
        );
      }
    }
    assert.equal(titleIds.size, expectedProjectTitles.length);

    const firstTrigger = triggers.nth(0);
    const secondTrigger = triggers.nth(1);
    const firstModalId = await firstTrigger.getAttribute('data-modal-target');
    const secondModalId = await secondTrigger.getAttribute('data-modal-target');
    assert.ok(firstModalId && secondModalId);
    await page.evaluate(() => {
      document.body.style.overflow = 'scroll';
    });
    await firstTrigger.click();
    await page.evaluate(() => {
      document
        .querySelectorAll('.detail-btn')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await page.locator('dialog.modal[open]').count(), 1);
    assert.equal(
      await page.locator(`#${firstModalId}`).evaluate((element) => element.open),
      false,
    );
    assert.equal(
      await page.locator(`#${secondModalId}`).evaluate((element) => element.open),
      true,
    );
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await page.locator(`#${secondModalId} .modal-close`).click();
    await page.waitForFunction(
      ({ id, overflow }) =>
        document.querySelector(`[data-modal-target="${id}"]`) ===
          document.activeElement && document.body.style.overflow === overflow,
      { id: secondModalId, overflow: 'scroll' },
    );
    assert.equal(
      await secondTrigger.evaluate((button) => button === document.activeElement),
      true,
    );

    assert.deepEqual(pageErrors, [], 'dialog page errors');
    assert.deepEqual(consoleErrors, [], 'dialog console errors');
  } finally {
    await context.close();
  }
}

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
  await verifyBodyGraphBoundary(browser);
  await verifyDialogContract(browser);

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

    const pageContainerGutters = await page
      .locator('[data-page-container]')
      .evaluateAll((containers) =>
        containers.map((container) => {
          const rect = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          return {
            left: rect.left + Number.parseFloat(style.paddingLeft),
            right: innerWidth - rect.right + Number.parseFloat(style.paddingRight),
          };
        }),
      );
    const maximumGutter = viewport.width < 640 ? 24 : viewport.width < 1024 ? 40 : 144;
    assert.equal(pageContainerGutters.length, 4, 'all page containers must share the gutter contract');
    for (const gutter of pageContainerGutters) {
      assert.ok(
        Math.abs(gutter.left - gutter.right) <= 1,
        `${viewport.name} page container is not horizontally centered`,
      );
      assert.ok(
        Math.max(gutter.left, gutter.right) <= maximumGutter,
        `${viewport.name} page gutter exceeds ${maximumGutter}px: ${JSON.stringify(gutter)}`,
      );
    }

    const heroIntroGutter = await page.locator('[data-hero-intro]').evaluate((intro) => {
      const rect = intro.getBoundingClientRect();
      return {
        left: rect.left,
        right: innerWidth - rect.right,
      };
    });
    const expectedHeroGutter =
      viewport.width < 640
        ? 36
        : viewport.width < 1024
          ? 112
          : Math.max(80, (viewport.width - 1024) / 2);
    assert.ok(
      Math.abs(heroIntroGutter.left - heroIntroGutter.right) <= 1,
      `${viewport.name} hero introduction is not horizontally centered`,
    );
    assert.ok(
      Math.abs(heroIntroGutter.left - expectedHeroGutter) <= 1,
      `${viewport.name} hero introduction gutter changed: ${JSON.stringify(heroIntroGutter)}`,
    );

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
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-modal-target="${id}"]`) ===
        document.activeElement,
      modalId,
    );

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
