import { defineConfig } from '@playwright/test'

if (!process.env.E2E_BASE_URL || !/^footprint_security_test_[a-f0-9]{12}$/.test(process.env.SECURITY_TEST_DATABASE || '')) throw new Error('Use npm run test:e2e to create an isolated database')
export default defineConfig({
  testDir: './tests/e2e-real',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: 'list',
  outputDir: 'test-results/real-e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { channel: process.platform === 'win32' ? 'msedge' : undefined },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
