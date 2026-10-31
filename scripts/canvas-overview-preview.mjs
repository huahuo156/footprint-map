// Standalone review artifact only. Does not start the product or access its API.
import express from 'express'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
const app = express()
app.use(express.static(path.resolve('.')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/prototypes/canvas-overview.html`)
  await page.locator('.cover img').first().waitFor()
  assert.equal(await page.locator('img').count(), 4)
  assert.equal(await page.locator('.cluster').count(), 8)
  const counts = await page.locator('.cluster strong').allTextContents()
  assert.equal(counts.reduce((sum, v) => sum + Number(v), 0), 500)
  await page.getByRole('button', { name: '全选 500 张' }).click()
  assert.equal(await page.locator('#selected').textContent(), '500')
  await page.locator('.cluster').first().click()
  assert.ok(await page.locator('.photo').count() <= 120)
  assert.ok(await page.locator('img').count() <= 48)
  await page.getByRole('button', { name: '总览 25%' }).click()
  assert.equal(await page.locator('#selected').textContent(), '500')
  const target = page.locator('.cluster').first()
  await target.focus(); await page.keyboard.press('Enter')
  assert.ok(await page.locator('.photo').count() > 0)
  await page.getByRole('button', { name: '切换平板预算 24' }).click()
  assert.equal(await page.locator('img').count(), 24)
  await page.locator('.photo').first().click()
  assert.equal(await page.locator('#selected').textContent(), '499')
  await page.getByRole('button', { name: '总览 25%' }).click()
  assert.equal(await page.locator('#selected').textContent(), '499')
  assert.equal(await target.evaluate(node => node === document.activeElement), true)
  await page.getByRole('button', { name: '切换桌面预算 48' }).click()
  await page.getByRole('button', { name: '清空选择' }).click()
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  await mkdir('docs/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/screenshots/canvas-overview-500.png', fullPage: true })
  console.log('Overview prototype passed: 500 records aggregated, click/Enter zoom and return focus, persistent 500/499 selection, desktop <=48 / tablet <=24 images, <=120 detail nodes; screenshot saved.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
