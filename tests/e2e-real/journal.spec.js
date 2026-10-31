import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

test('real accounts upload, keep media private, save a notebook, back up, restore and revoke logout', async ({ page, context, browser }, testInfo) => {
  const email = `${testInfo.project.name}-a@example.com`, password = 'disposable-browser-password-123'
  const errors = [], featureLoads = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/\/assets\/(?:PlaceAtlas|NotebookReader|EntryEditor)-[^/]+\.js$/.test(request.url())) featureLoads.push(request.url())
  })
  await page.goto('/')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '账号', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '自由画布', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(featureLoads).toEqual([])
  const session = await (await context.request.get('/api/auth/session')).json()
  const headers = { Origin: testInfo.project.use.baseURL, 'X-CSRF-Token': session.csrfToken }
  const image = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#aabbcc' } }).png().toBuffer()
  await page.getByRole('button', { name: '留下一刻', exact: true }).first().click()
  const editor = page.getByRole('dialog', { name: '留下一刻', exact: true })
  await expect(editor).toBeVisible()
  expect(featureLoads.some(url => url.includes('/EntryEditor-'))).toBe(true)
  expect(featureLoads.some(url => /\/(?:PlaceAtlas|NotebookReader)-/.test(url))).toBe(false)
  await editor.getByLabel('选择旅行照片').setInputFiles({ name: 'memory.png', mimeType: 'image/png', buffer: image })
  const saved = page.waitForResponse(r => r.url().endsWith('/journal/entries') && r.request().method() === 'POST')
  await editor.getByRole('button', { name: '留下', exact: true }).click()
  expect((await saved).status()).toBe(201)
  await expect(editor).toBeHidden()
  await page.reload()
  let journal = await (await context.request.get('/api/journal')).json()
  expect(journal.entries).toHaveLength(1)
  const photo = journal.entries[0].photos[0]
  const media = await context.request.get(photo.url)
  expect(media.status()).toBe(200)
  expect((await sharp(await media.body()).metadata()).width).toBe(30)

  if (testInfo.project.name === 'desktop') {
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    const card = page.locator(`[data-photo-id="${photo.id}"]`)
    await expect(card).toBeVisible()
    const original = await card.evaluate(node => node.style.transform), attempts = []
    let fail = true
    await page.route('**/api/journal/layout', async route => {
      attempts.push(route.request().postDataJSON())
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: '真实回归模拟断网' } }) }
      return route.continue()
    })
    const box = await card.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 20, { steps: 4 }); await page.mouse.up()
    await expect(page.getByRole('alert').filter({ hasText: '真实回归模拟断网' })).toBeVisible()
    const retained = await card.evaluate(node => node.style.transform)
    expect(retained).not.toBe(original)
    // Cancelling a real browser refresh must leave the in-memory draft intact.
    const leaving = page.waitForEvent('dialog')
    // A cancelled navigation has no load event; do not await page.reload().
    await page.evaluate(() => { setTimeout(() => location.reload(), 0) })
    const leaveDialog = await leaving
    expect(leaveDialog.type()).toBe('beforeunload')
    await leaveDialog.dismiss()
    expect(await card.evaluate(node => node.style.transform)).toBe(retained)
    const retry = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await retry
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    expect(attempts[1]).toEqual(attempts[0]); expect(typeof attempts[0].items[0].expected_version).toBe('string')
    const undo = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.getByRole('button', { name: '撤销布局', exact: true }).click(); await undo
    await expect.poll(() => card.evaluate(node => node.style.transform)).toBe(original)
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    const redo = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.getByRole('button', { name: '重做布局', exact: true }).click(); await redo
    await expect.poll(() => card.evaluate(node => node.style.transform)).toBe(retained)
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    await page.unroute('**/api/journal/layout')

    // Both pages read the same baseline; the second writer must not overwrite it.
    const sibling = await context.newPage()
    try {
      await sibling.goto('/')
      await expect(sibling.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      const siblingCard = sibling.locator(`[data-photo-id="${photo.id}"]`)
      async function drag(target, targetCard, dx) {
        const bounds = await targetCard.boundingBox()
        const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
        await target.mouse.move(cx, cy); await target.mouse.down()
        await target.mouse.move(cx + dx, cy + 15, { steps: 4 }); await target.mouse.up()
      }
      const updated = sibling.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
      await drag(sibling, siblingCard, 35); await updated
      await expect(sibling.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      const confirmed = await (await context.request.get('/api/journal')).json()
      const remoteTransform = await siblingCard.evaluate(node => node.style.transform)
      const conflictResponse = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 409)
      await drag(page, card, -35); await conflictResponse
      await expect(page.getByRole('alert').filter({ hasText: '其他页面已修改布局' })).toBeVisible()
      await expect(page.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
      const localDraft = await card.evaluate(node => node.style.transform)
      const reload = page.getByRole('button', { name: '丢弃本页布局并重新载入', exact: true })
      page.once('dialog', dialog => dialog.dismiss())
      await reload.click()
      expect(await card.evaluate(node => node.style.transform)).toBe(localDraft)
      await expect(reload).toBeVisible()
      const unchanged = await (await context.request.get('/api/journal')).json()
      expect(unchanged).toEqual(confirmed)
      page.once('dialog', dialog => dialog.accept())
      await reload.click()
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      await expect(reload).toHaveCount(0)
      await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: '重做布局', exact: true })).toBeDisabled()
      await expect.poll(() => card.evaluate(node => node.style.transform)).toBe(remoteTransform)
      // A confirmed baseline can refresh without a beforeunload prompt.
      await page.reload()
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      expect(await card.evaluate(node => node.style.transform)).toBe(remoteTransform)
    } finally { await sibling.close() }

    const canvas = page.getByRole('region', { name: /旅行照片画布/ })
    const keyboardBaseline = (await (await context.request.get('/api/journal')).json()).entries[0].photos[0]
    let keyboardWrites = 0
    const countKeyboardWrites = request => { if (request.url().endsWith('/journal/layout') && request.method() === 'PATCH') keyboardWrites++ }
    page.on('request', countKeyboardWrites)
    await page.getByRole('button', { name: '多选内容', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+a')
    const nudge = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.keyboard.press('ArrowRight')
    const nudgeBody = (await nudge).request().postDataJSON()
    expect(nudgeBody.items[0]).toMatchObject({ id: photo.id, x: keyboardBaseline.canvas_x + 1, expected_version: keyboardBaseline.layout_version })
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    const keyboardUndo = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.keyboard.press('ControlOrMeta+z'); await keyboardUndo
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    expect((await (await context.request.get('/api/journal')).json()).entries[0].photos[0].canvas_x).toBe(keyboardBaseline.canvas_x)
    const keyboardRedo = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.keyboard.press('ControlOrMeta+Shift+z'); await keyboardRedo
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    const keyboardAttempts = []
    await page.route('**/api/journal/layout', route => {
      keyboardAttempts.push(route.request().postDataJSON())
      if (keyboardAttempts.length === 1) return route.fulfill({ status: 503, json: { error: '键盘保存失败回归' } })
      return route.continue()
    })
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('alert').filter({ hasText: '键盘保存失败回归' })).toBeVisible()
    const retryKeyboard = page.waitForResponse(r => r.url().endsWith('/journal/layout') && r.status() === 200)
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await retryKeyboard
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    expect(keyboardAttempts[1]).toEqual(keyboardAttempts[0])
    await page.unroute('**/api/journal/layout')
    await canvas.focus()
    await page.keyboard.press('f'); await expect(canvas).toBeFocused()
    expect(keyboardWrites).toBe(5)
    page.off('request', countKeyboardWrites)
    await page.reload()
    await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    expect((await (await context.request.get('/api/journal')).json()).entries[0].photos[0].canvas_x).toBe(keyboardBaseline.canvas_x + 1)
    expect((await (await context.request.get('/api/journal')).json()).entries[0].photos[0].canvas_y).toBe(keyboardBaseline.canvas_y + 1)
  }

  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
  try {
    expect((await other.request.get(photo.url)).status()).toBe(401)
    const login = await other.request.post('/api/auth/login', { headers: { Origin: testInfo.project.use.baseURL }, data: { email: `${testInfo.project.name}-b@example.com`, password } })
    expect(login.status()).toBe(200)
    const otherSession = await login.json()
    expect((await other.request.get(photo.url)).status()).toBe(404)
    expect((await (await other.request.get('/api/journal')).json()).entries).toEqual([])
    expect((await other.request.delete('/api/journal/entries/' + journal.entries[0].id, { headers: { Origin: testInfo.project.use.baseURL, 'X-CSRF-Token': otherSession.csrfToken } })).status()).toBe(404)
  } finally { await other.close() }

  await page.getByRole('button', { name: /创建手札/ }).first().click()
  const settings = page.getByRole('dialog', { name: '创建主题手帐' })
  await settings.getByLabel('手札名称', { exact: true }).fill('真实旅行手札')
  await settings.getByRole('tab', { name: '自定义上传' }).click()
  await settings.getByLabel('上传封面图片', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image })
  const bookCreated = page.waitForResponse(r => r.url().endsWith('/journal/notebooks') && r.request().method() === 'POST')
  await settings.getByRole('button', { name: '保存手札', exact: true }).click()
  expect((await bookCreated).status()).toBe(201)
  await expect(settings).toBeHidden()
  const reader = page.getByRole('dialog', { name: '真实旅行手札，翻页手帐' })
  await expect(reader).toBeVisible()
  expect(featureLoads.some(url => url.includes('/NotebookReader-'))).toBe(true)
  expect(featureLoads.some(url => url.includes('/PlaceAtlas-'))).toBe(false)
  await reader.getByRole('button', { name: '合上手札', exact: true }).click()

  await page.getByRole('button', { name: '足迹版图', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的中国足迹', exact: true })).toBeVisible()
  expect(featureLoads.some(url => url.includes('/PlaceAtlas-'))).toBe(true)
  await page.getByRole('button', { name: '自由画布', exact: true }).click()

  await page.getByRole('button', { name: '备份', exact: true }).click()
  const backup = page.getByRole('dialog', { name: '备份与还原' })
  const downloadEvent = page.waitForEvent('download')
  await backup.getByRole('button', { name: '导出备份文件' }).click()
  const download = await downloadEvent
  expect(await download.failure()).toBeNull()
  const archive = await readFile(await download.path())
  expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304')
  page.once('dialog', dialog => dialog.accept())
  const restored = page.waitForResponse(r => r.url().endsWith('/journal/restore'))
  await backup.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: archive })
  expect((await restored).status()).toBe(200)
  await expect(backup.getByRole('status')).toContainText('已还原 1 张照片')
  journal = await (await context.request.get('/api/journal')).json()
  expect(journal.entries).toHaveLength(2)
  expect(journal.notebooks).toHaveLength(2)
  const oldBook = journal.notebooks.find(book => book.cover_url.startsWith('/uploads/cover-'))
  expect((await context.request.delete('/api/journal/notebooks/' + oldBook.id, { headers })).status()).toBe(200)
  expect((await context.request.get(oldBook.cover_url)).status()).toBe(404)
  await backup.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '账号', exact: true }).click()
  const logoutResponse = page.waitForResponse(r => r.url().endsWith('/auth/logout'))
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  expect((await logoutResponse).status()).toBe(200)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect((await context.request.get(photo.url)).status()).toBe(401)
  await page.reload()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
