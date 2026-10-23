import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    launchOptions: { channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:3001/api/health', reuseExistingServer: true, timeout: 30000 },
  ],
})
