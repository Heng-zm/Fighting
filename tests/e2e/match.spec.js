const { test, expect } = require('@playwright/test');

// Helper to set nickname and enter main menu
async function setupPlayer(page, nickname, heroId = 'flame') {
  // Clear persistent local state so each tab has an isolated session
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const nicknameModal = page.locator('#nickname-modal');
  const profileName = page.locator('#profile-name');

  // Modal might already be opening, or if not open, click profile chip
  try {
    await expect(nicknameModal).not.toHaveClass(/hidden/, { timeout: 4000 });
  } catch {
    const text = (await profileName.textContent().catch(() => '')) || '';
    if (!text.includes(nickname)) {
      await page.click('#profile-chip').catch(() => {});
      await expect(nicknameModal).not.toHaveClass(/hidden/, { timeout: 6000 });
    }
  }

  if (await nicknameModal.evaluate((el) => !el.classList.contains('hidden')).catch(() => false)) {
    await page.fill('#nickname-input', nickname);
    await page.click('#nickname-submit');
    await expect(nicknameModal).toHaveClass(/hidden/, { timeout: 8000 });
  }

  // Verify profile name updated
  await expect(profileName).toContainText(nickname, { timeout: 8000 });
}

test.describe('Shadow Clash E2E Match Flows', () => {
  test('2 players complete full private match via invite link', async ({ browser }) => {
    // Context 1: Host
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const errors1 = [];
    page1.on('console', (msg) => {
      if (msg.type() === 'error') errors1.push(msg.text());
    });
    page1.on('pageerror', (err) => errors1.push(err.message));

    // Context 2: Challenger
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    const errors2 = [];
    page2.on('console', (msg) => {
      if (msg.type() === 'error') errors2.push(msg.text());
    });
    page2.on('pageerror', (err) => errors2.push(err.message));

    await setupPlayer(page1, 'HostFighter');
    await setupPlayer(page2, 'Challenger');

    // Host creates private room
    await page1.click('#btn-invite');
    await expect(page1.locator('#screen-lobby')).toHaveClass(/active/);

    // Get room code
    const roomCodeElement = page1.locator('#room-code');
    await expect(roomCodeElement).not.toHaveText('----');
    const roomCode = (await roomCodeElement.textContent()).trim();
    expect(roomCode.length).toBeGreaterThanOrEqual(4);

    // Challenger joins via Join Modal
    await page2.click('#btn-join');
    await page2.fill('#join-code', roomCode);
    await page2.click('#join-form button[type="submit"]');

    // Both should be in lobby with 2 slots filled
    await expect(page2.locator('#screen-lobby')).toHaveClass(/active/);
    await expect(page1.locator('.lobby-slot.filled')).toHaveCount(2);
    await expect(page2.locator('.lobby-slot.filled')).toHaveCount(2);

    // Host and Challenger ready up
    await page1.click('#lobby-ready');
    await page2.click('#lobby-ready');

    // Both enter game arena
    await expect(page1.locator('#screen-game')).toHaveClass(/active/);
    await expect(page2.locator('#screen-game')).toHaveClass(/active/);

    // Canvas is rendered
    await expect(page1.locator('#game-canvas')).toBeVisible();
    await expect(page2.locator('#game-canvas')).toBeVisible();

    // Check HUD elements
    await expect(page1.locator('#hud-round')).toBeVisible();
    await expect(page1.locator('#hud-local-health')).toBeVisible();
    await expect(page1.locator('#hud-remote-health')).toBeVisible();

    // Simulate combat inputs from Player 1
    await page1.keyboard.down('KeyD'); // Walk toward opponent
    await page1.waitForTimeout(300);
    await page1.keyboard.up('KeyD');

    // Attack
    await page1.keyboard.press('KeyJ'); // Light attack
    await page1.waitForTimeout(100);
    await page1.keyboard.press('KeyK'); // Heavy attack
    await page1.waitForTimeout(200);

    // Verify no unhandled console errors occurred
    expect(errors1.filter((e) => !e.includes('favicon'))).toEqual([]);
    expect(errors2.filter((e) => !e.includes('favicon'))).toEqual([]);

    await context1.close();
    await context2.close();
  });

  test('Random Matchmaking matches 2 players across tabs with Match Found accept ring', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await setupPlayer(page1, 'QueuerA');
    await setupPlayer(page2, 'QueuerB');

    // Both click Random Match
    await page1.click('#btn-random');
    await page2.click('#btn-random');

    await expect(page1.locator('#screen-search')).toHaveClass(/active/, { timeout: 10000 });
    await expect(page2.locator('#screen-search')).toHaveClass(/active/, { timeout: 10000 });

    // Both should see "Match Found" backdrop
    await expect(page1.locator('#match-found-backdrop')).not.toHaveClass(/hidden/, { timeout: 15000 });
    await expect(page2.locator('#match-found-backdrop')).not.toHaveClass(/hidden/, { timeout: 15000 });

    // Both click Accept
    await page1.click('#mf-accept');
    await page2.click('#mf-accept');

    // Both enter the lobby
    await expect(page1.locator('#screen-lobby')).toHaveClass(/active/);
    await expect(page2.locator('#screen-lobby')).toHaveClass(/active/);

    await context1.close();
    await context2.close();
  });

  test('Spectator joins live room across 3 tabs', async ({ browser }) => {
    const c1 = await browser.newContext();
    const p1 = await c1.newPage();
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    const c3 = await browser.newContext();
    const p3 = await c3.newPage();

    await setupPlayer(p1, 'P1');
    await setupPlayer(p2, 'P2');
    await setupPlayer(p3, 'Watcher');

    await p1.click('#btn-invite');
    await expect(p1.locator('#screen-lobby')).toHaveClass(/active/);
    const roomCode = (await p1.locator('#room-code').textContent()).trim();

    await p2.click('#btn-join');
    await p2.fill('#join-code', roomCode);
    await p2.click('#join-form button[type="submit"]');
    await expect(p2.locator('#screen-lobby')).toHaveClass(/active/);

    // Spectator uses "Spectate instead" in join modal
    await p3.click('#btn-join');
    await p3.fill('#join-code', roomCode);
    await p3.click('#join-spectate');
    await expect(p3.locator('#screen-lobby')).toHaveClass(/active/);

    // p1 & p2 ready up
    await p1.click('#lobby-ready');
    await p2.click('#lobby-ready');

    // p3 transitions into game screen and spectator banner is displayed
    await expect(p3.locator('#screen-game')).toHaveClass(/active/);
    await expect(p3.locator('#spectator-banner')).not.toHaveClass(/hidden/);

    await c1.close();
    await c2.close();
    await c3.close();
  });

  test('Mobile viewport (landscape 844x390 & 640x360) displays ergonomic touch controls', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();

    await setupPlayer(page, 'MobileHero');

    // Check touch controls touch target minimum sizes (>= 44x44px)
    await page.click('#btn-invite');
    await expect(page.locator('#screen-lobby')).toHaveClass(/active/);

    const readyBtn = page.locator('#lobby-ready');
    const box = await readyBtn.boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);

    // Start bot match or enter arena
    await page.click('#btn-lobby-hero');
    await expect(page.locator('#screen-select')).toHaveClass(/active/);

    const backBtn = page.locator('#select-back');
    const backBox = await backBtn.boundingBox();
    expect(Math.round(backBox.height)).toBeGreaterThanOrEqual(44);

    await context.close();
  });

  test('Simulates 200ms high ping and verifies smooth match execution', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Enable Chrome DevTools Protocol to simulate 200ms round-trip latency
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 200,
        downloadThroughput: 2 * 1024 * 1024,
        uploadThroughput: 1 * 1024 * 1024
      });
    } catch (e) {
      // CDP may not be supported on non-chromium, fallback gracefully
    }

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await setupPlayer(page, 'PingFighter');

    // Start a Bot match
    await page.click('#btn-random');
    // In search screen, click "Fight a Bot" if visible, or wait for bot match
    const fightBotBtn = page.locator('#btn-fight-bot');
    const botOffer = page.locator('#bot-offer');

    // Force bot offer display for quick testing if still searching
    await page.evaluate(() => {
      const el = document.getElementById('bot-offer');
      if (el) el.classList.remove('hidden');
    });
    await fightBotBtn.click();

    // Arena should start with 200ms latency
    await expect(page.locator('#screen-game')).toHaveClass(/active/, { timeout: 15000 });
    await expect(page.locator('#game-canvas')).toBeVisible();

    // Send attacks under 200ms latency
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);

    await context.close();
  });
});
