// Read-only production-build smoke test; all API responses are fixtures.
import express from 'express'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
// Keep runs separate: the desktop preview may still hold an earlier PNG open on Windows.
const output = path.resolve('test-results/ui-smoke', 'run-' + Date.now())
await mkdir(output, { recursive: true })
const app = express(), root = path.resolve('dist')
app.use(express.static(root)); app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const fixture = { trips: [], marks: [], canvas_groups: [], entries: [{ id: 'entry', entry_date: '2026-10-26', photos: [{ id: 'photo', url: '/journal-demo/west-lake.jpg', components: [{ type: 'place', value: { name: '武汉市' } }] }] }], notebooks: [{ id: 'book', name: '沿途拾光', cover_mode: 'solid', cover_color: '#e3e9dd', canvas_x: 0, canvas_y: 0 }], notebook_pages: [{ id: 'page', notebook_id: 'book', sort_order: 0 }], notebook_items: [] }
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
const results = [], errors = []
try {
  for (const theme of ['light', 'dark']) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 }, colorScheme: theme })
    let loggedIn = false
    await context.route('**/api/**', route => {
      const routePath = new URL(route.request().url()).pathname
      if (routePath === '/api/auth/login') loggedIn = true
      const session = { user: loggedIn ? { id: 'smoke-user', email: 'smoke@example.com', email_verified: true } : null, csrfToken: loggedIn ? 'test-csrf' : null }
      return route.fulfill({ json: routePath.startsWith('/api/auth/') ? session : routePath === '/api/journal' ? fixture : [] })
    })
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
    const label = theme + (mobile ? '-mobile' : '-desktop')
    async function snapshot(name) {
      await page.screenshot({ path: path.join(output, label + '-' + name + '.png'), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, label + '-' + name + ' overflow')
      results.push(label + '-' + name)
    }
    await page.goto(base)
    await page.getByRole('button', { name: '登录', exact: true }).waitFor()
    await snapshot('login')
    await page.getByLabel('邮箱', { exact: true }).fill('smoke@example.com')
    await page.getByLabel('密码', { exact: true }).fill('smoke-password-123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '足迹版图', exact: true }).click()
    await page.getByRole('button', { name: '聚焦地点：武汉市 · 1 张照片' }).waitFor()
    for (const name of ['账号', '备份', '留下一刻']) assert.ok(await page.getByRole('button', { name, exact: true }).isVisible())
    await page.getByRole('button', { name: '聚焦地点：武汉市 · 1 张照片' }).locator(':scope > path').click()
    await snapshot('atlas-focus')
    if (mobile) {
      const panel = await page.getByRole('complementary', { name: '武汉市的回忆' }).boundingBox()
      assert.ok(panel.y > 350 && panel.width > 320, 'mobile focus should use bottom sheet')
      await page.getByRole('button', { name: '收起地点详情' }).click()
      assert.equal(await page.getByRole('button', { name: '展开地点详情' }).getAttribute('aria-expanded'), 'false')
      await page.getByRole('button', { name: '自由画布', exact: true }).click()
      const opener = page.getByRole('button', { name: '沿途拾光', exact: true })
      await opener.click()
      const reader = page.getByRole('dialog', { name: '沿途拾光，翻页手帐' })
      await reader.waitFor()
      for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); assert.ok(await reader.evaluate(node => node.contains(document.activeElement))) }
      await snapshot('reader')
      await page.getByRole('button', { name: '合上手札', exact: true }).click()
      assert.ok(await opener.evaluate(node => node === document.activeElement))
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'smoke-results.json'), JSON.stringify({ results, errors, api: 'mocked; no real data touched' }, null, 2))
  console.log(`Production UI smoke: ${results.length} states, no runtime errors or horizontal overflow; mobile actions, sheet and reader focus passed.`)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
