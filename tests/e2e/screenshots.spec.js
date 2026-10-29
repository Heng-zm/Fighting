const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const screenshotDir = path.resolve(__dirname, '../../docs/QA/screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function setupPlayer(page, nickname) {
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

  await expect(profileName).toContainText(nickname, { timeout: 8000 });
}

test.describe('Shadow Clash UI/UX Screenshot Suite', () => {
  test('Capture desktop views', async ({ browser }) => {
    test.setTimeout(60000);
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const desktopPage = await desktopContext.newPage();
    await setupPlayer(desktopPage, 'Viper');

    // Menu screenshot
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({ path: path.join(screenshotDir, 'desktop-main-menu.png') });

    // Character select
    await desktopPage.click('#btn-change-fighter');
    await expect(desktopPage.locator('#screen-select')).toHaveClass(/active/);
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({ path: path.join(screenshotDir, 'character-select.png') });

    // Back to menu
    await desktopPage.click('#select-back');
    await expect(desktopPage.locator('#screen-menu')).toHaveClass(/active/);

    // Settings Modal
    await desktopPage.click('#btn-settings');
    await expect(desktopPage.locator('#settings-modal')).not.toHaveClass(/hidden/);
    await desktopPage.waitForTimeout(300);
    await desktopPage.screenshot({ path: path.join(screenshotDir, 'settings-modal.png') });
    await desktopPage.click('#settings-close');

    // Lobby
    await desktopPage.click('#btn-invite');
    await expect(desktopPage.locator('#screen-lobby')).toHaveClass(/active/);
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({ path: path.join(screenshotDir, 'lobby-view.png') });

    await desktopContext.close();
  });

  test('Capture mobile landscape and in-game combat HUD', async ({ browser }) => {
    test.setTimeout(60000);
    const mobileContext = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await mobileContext.newPage();
    await setupPlayer(mobilePage, 'MobileHero');
    await mobilePage.screenshot({ path: path.join(screenshotDir, 'mobile-landscape-menu.png') });

    const mobilePage2 = await mobileContext.newPage();
    await setupPlayer(mobilePage2, 'Opponent');

    await mobilePage.click('#btn-invite');
    await expect(mobilePage.locator('#screen-lobby')).toHaveClass(/active/, { timeout: 10000 });
    const roomCodeEl = mobilePage.locator('#room-code');
    await expect(roomCodeEl).not.toHaveText('----');
    const roomCode = (await roomCodeEl.textContent()).trim();

    await mobilePage2.click('#btn-join');
    await mobilePage2.fill('#join-code', roomCode);
    await mobilePage2.click('#join-form button[type="submit"]');

    await expect(mobilePage2.locator('#screen-lobby')).toHaveClass(/active/, { timeout: 10000 });
    await expect(mobilePage.locator('.lobby-slot.filled')).toHaveCount(2, { timeout: 10000 });

    await mobilePage.click('#lobby-ready');
    await mobilePage2.click('#lobby-ready');

    await expect(mobilePage.locator('#screen-game')).toHaveClass(/active/, { timeout: 15000 });
    await mobilePage.waitForTimeout(1500); // let combat state and HUD render

    // Capture in-game HUD on mobile showing floating joystick zone and touch cluster
    await mobilePage.screenshot({ path: path.join(screenshotDir, 'mobile-combat-hud.png') });

    await mobileContext.close();
  });
});
