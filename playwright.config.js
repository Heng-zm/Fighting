const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true
  },
  webServer: {
    command: 'node scripts/generateAssets.js && node server/index.js',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-iphone',
      use: {
        ...devices['iPhone 14'],
        defaultBrowserType: 'chromium',
        viewport: { width: 844, height: 390 }, // landscape orientation
        hasTouch: true,
        isMobile: true
      }
    },
    {
      name: 'mobile-android',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 640, height: 360 }, // landscape orientation
        hasTouch: true,
        isMobile: true
      }
    }
  ]
});

