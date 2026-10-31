// Real browser input against the production build; API and journal are fixtures.
import express from 'express'
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const output = path.resolve('test-results/canvas-ui', 'run-' + Date.now())
await mkdir(output, { recursive: true })
const app = express(), root = path.resolve('dist')
app.use(express.static(root))
app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
const results = [], errors = []
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    // Phone widths intentionally render MobileFeed instead of JourneyCanvas.
    // Use a tablet viewport to exercise the actual canvas with native touch.
    const label = (mobile ? 'touch-tablet' : 'desktop') + '-' + theme
    const context = await browser.newContext({ viewport: mobile ? { width: 1024, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile, colorScheme: theme })
    await context.tracing.start({ screenshots: true, snapshots: true })
    const writes = []
    let failNextLayout = false
    const fixture = { trips: [], marks: [], canvas_groups: [], notebooks: [], notebook_pages: [], notebook_items: [], entries: [{ id: 'e', entry_date: '2026-10-29', components: [], photos: [{ id: 'photo', url: '/journal-demo/west-lake.jpg', components: [], canvas_absolute: 1, canvas_x: 0, canvas_y: 0, rotation: 0 }] }] }
    await context.addInitScript(() => localStorage.setItem('shitu-camera-v1:canvas-smoke-user', JSON.stringify({ x: 0, y: 0, scale: .8, detail: true })))
    await context.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname
      if (request.method() !== 'GET') writes.push({ pathname, body: request.postDataJSON() })
      if (pathname.startsWith('/api/auth/')) return route.fulfill({ json: { user: { id: 'canvas-smoke-user', email: 'canvas@example.com', email_verified: true }, csrfToken: 'fixture-csrf' } })
      if (pathname === '/api/journal') {
        fixture.structure_version ??= '0'
        for (const entry of fixture.entries) { entry.layout_version ??= '0'; for (const photo of entry.photos) photo.layout_version ??= '0' }
        return route.fulfill({ json: fixture })
      }
      if (pathname === '/api/journal/layout' && request.method() === 'PATCH') {
        if (failNextLayout) {
          failNextLayout = false
          return route.fulfill({ status: 503, json: { error: '模拟布局保存失败' } })
        }
        const saved = []
        for (const item of request.postDataJSON().items) {
          const photo = fixture.entries[0].photos.find(photo => photo.id === item.id)
          assert.ok(photo)
          assert.equal(item.expected_version, photo.layout_version)
          Object.assign(photo, { canvas_x: item.x, canvas_y: item.y, rotation: item.rotation, layout_version: String(BigInt(photo.layout_version) + 1n) })
          saved.push({ kind: item.kind, id: item.id, layout_version: photo.layout_version })
        }
        return route.fulfill({ json: { saved: saved.length, items: saved } })
      }
      if (pathname.startsWith('/api/journal/groups/') && request.method() === 'PATCH') {
        const group = fixture.canvas_groups.find(group => group.id === pathname.split('/').at(-1))
        assert.ok(group, 'unexpected fixture group')
        const values = request.postDataJSON()
        if (group.collapsed !== values.collapsed) fixture.structure_version = String(BigInt(fixture.structure_version) + 1n)
        for (const position of values.positions || []) {
          const photo = fixture.entries[0].photos.find(p => p.id === position.id)
          if (photo.canvas_x !== position.x || photo.canvas_y !== position.y) Object.assign(photo, { canvas_x: position.x, canvas_y: position.y, rotation: position.rotation, layout_version: String(BigInt(photo.layout_version) + 1n) })
        }
        Object.assign(group, values)
        return route.fulfill({ json: group })
      }
      return route.fulfill({ json: {} })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(label + ': ' + error.message))
    page.setDefaultTimeout(10000)
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      const canvas = page.getByRole('region', { name: /旅行照片画布/ })
      const photo = page.locator('[data-photo-id="photo"]')
      await expect(photo).toBeVisible()
      await expect(photo.locator('img')).toHaveJSProperty('complete', true)
      await expect.poll(() => photo.locator('img').evaluate(node => node.naturalWidth)).toBeGreaterThan(0)
      const original = await photo.evaluate(node => node.style.transform)
      const box = await photo.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      // Native mouse capture and Escape must roll back without an API write.
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 15, { steps: 3 })
      assert.notEqual(await photo.evaluate(node => node.style.transform), original)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
      assert.equal(writes.length, 0, label + ' Escape must not write')

      // Native keyboard activation of camera controls must obey the same
      // gesture isolation as wheel zoom, even while a pointer is captured.
      const beforeNavigation = await page.locator('.j-world').evaluate(node => node.style.transform)
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 15, { steps: 3 })
      const overview = page.getByRole('button', { name: '查看全部旅程', exact: true })
      await overview.focus(); await page.keyboard.press('Enter')
      assert.equal(await page.locator('.j-world').evaluate(node => node.style.transform), beforeNavigation, label + ' overview must not change an active drag camera')
      await page.keyboard.press('Escape'); await page.mouse.up()
      await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
      assert.equal(writes.length, 0, label + ' ignored navigation then cancellation must not save')
      await overview.click()
      await expect.poll(() => page.locator('.j-world').evaluate(node => node.style.transform)).not.toBe(beforeNavigation)
      await page.reload()
      await expect(photo).toBeVisible()
      await expect(photo.locator('img')).toHaveJSProperty('complete', true)
      await expect.poll(() => photo.locator('img').evaluate(node => node.naturalWidth)).toBeGreaterThan(0)
      await expect(page.locator('.j-zoom-value')).toHaveText('80%')

      await page.evaluate(() => {
        window.canvasInputAudit = { blur: 0, lostCapture: 0, pointerId: null }
        window.addEventListener('blur', event => { if (event.isTrusted) window.canvasInputAudit.blur++ })
        const card = document.querySelector('[data-photo-id="photo"]')
        card.addEventListener('pointerdown', event => { window.canvasInputAudit.pointerId = event.pointerId })
        card.addEventListener('lostpointercapture', event => { if (event.isTrusted) window.canvasInputAudit.lostCapture++ })
      })
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 15, { steps: 3 })
      assert.notEqual(await photo.evaluate(node => node.style.transform), original)
      const capturedWorld = await page.locator('.j-world').evaluate(node => node.style.transform)
      await page.mouse.wheel(0, -100)
      assert.equal(await page.locator('.j-world').evaluate(node => node.style.transform), capturedWorld, label + ' wheel must not zoom during a captured drag')
      await photo.evaluate(node => node.releasePointerCapture(window.canvasInputAudit.pointerId))
      await page.mouse.move(x + 36, y + 15)
      await expect.poll(() => page.evaluate(() => window.canvasInputAudit.lostCapture)).toBeGreaterThan(0)
      await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
      await page.mouse.up()
      assert.equal(writes.length, 0, label + ' native capture loss must cancel without saving')

      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 15, { steps: 3 })
      assert.notEqual(await photo.evaluate(node => node.style.transform), original)
      const blurBefore = await page.evaluate(() => window.canvasInputAudit.blur)
      // Playwright forces every Chromium page to stay focused by default.
      // Release that override so the browser can emit a real trusted blur.
      const focusSession = await context.newCDPSession(page)
      await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      const otherTab = await context.newPage()
      try {
        await otherTab.bringToFront()
        await expect.poll(() => page.evaluate(() => window.canvasInputAudit.blur)).toBeGreaterThan(blurBefore)
        await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
      } finally {
        await otherTab.close(); await page.bringToFront()
        await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true })
        await focusSession.detach()
      }
      await page.mouse.up()
      assert.equal(writes.length, 0, label + ' tab blur must cancel without saving')

      // Keyboard focus can leave a captured pointer gesture. Opening the real
      // editor must end that gesture before the mouse is eventually released.
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y + 15, { steps: 3 })
      const add = page.getByRole('button', { name: '留下一刻', exact: true }).first()
      await add.focus(); await page.keyboard.press('Enter')
      const modal = page.getByRole('dialog', { name: '留下一刻', exact: true })
      await expect(modal).toBeVisible()
      await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
      await page.mouse.up()
      assert.equal(writes.length, 0, label + ' modal opening must cancel the pending gesture')
      await modal.getByRole('tab', { name: '文字', exact: true }).click()
      const text = modal.getByRole('textbox', { name: '想写什么？' })
      await text.fill('Editor keyboard isolation')
      await page.keyboard.press('ControlOrMeta+a')
      assert.equal(await text.evaluate(node => node.selectionEnd - node.selectionStart), 25)
      await page.keyboard.press('ControlOrMeta+z')
      assert.equal(writes.length, 0, label + ' editor undo must not write layout')
      await page.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
      await expect(add).toBeFocused()
      assert.equal(writes.length, 0, label + ' closing editor must not commit the old gesture')

      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await page.keyboard.press('ControlOrMeta+a')
      await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: '多选内容', exact: true })).toBeVisible()

      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      const viewport = await canvas.boundingBox()
      await page.mouse.move(viewport.x + 12, viewport.y + 12)
      await page.mouse.down(); await page.mouse.move(x, y, { steps: 4 })
      await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape'); await page.mouse.up()
      await expect(page.locator('.j-selection-rectangle')).toHaveCount(0)

      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await page.evaluate(() => {
        const editor = document.createElement('textarea')
        editor.id = 'canvas-smoke-editor'; editor.value = 'Independent text selection'
        editor.style.cssText = 'position:fixed;top:0;left:0;z-index:99999'
        document.body.append(editor)
      })
      await page.locator('#canvas-smoke-editor').focus()
      await page.keyboard.press('ControlOrMeta+a')
      assert.equal(await page.locator('#canvas-smoke-editor').evaluate(node => node.selectionEnd - node.selectionStart), 26)
      await expect(page.getByText('已选 0 项', { exact: true })).toBeVisible()
      await page.locator('#canvas-smoke-editor').evaluate(node => node.remove())
      await canvas.focus(); await page.keyboard.press('Escape')

      if (mobile) {
        const session = await context.newCDPSession(page)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y, id: 1 }] })
        const moved = await photo.evaluate(node => node.style.transform)
        assert.notEqual(moved, original, label + ' native touch should drag')
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 30, y, id: 1 }, { x: x - 50, y: y + 50, id: 2 }] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y, id: 1 }, { x: x - 70, y: y + 60, id: 2 }] })
        assert.equal(await photo.evaluate(node => node.style.transform), moved, label + ' second finger must not move first drag')
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(original)
        await session.detach()
      }
      // A real completed mouse drag must create exactly one layout request.
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 24, y, { steps: 3 }); await page.mouse.up()
      await expect.poll(() => writes.length).toBe(1)
      assert.equal(writes[0].pathname, '/api/journal/layout')
      assert.equal(writes[0].body.items.length, 1)
      assert.equal(writes[0].body.items[0].id, 'photo')
      assert.ok(Math.abs(writes[0].body.items[0].x - 30) < .01, '24 screen pixels at 80% = 30 world units')
      await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true })
      assert.equal(await canvas.evaluate(node => node.classList.contains('is-dragging')), false)

      const singleSaved = await photo.evaluate(node => node.style.transform)
      const savedBox = await photo.boundingBox(), sx = savedBox.x + savedBox.width / 2, sy = savedBox.y + savedBox.height / 2
      failNextLayout = true
      await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 16, sy, { steps: 3 }); await page.mouse.up()
      await expect(page.getByRole('alert').filter({ hasText: '模拟布局保存失败' })).toBeVisible()
      assert.notEqual(await photo.evaluate(node => node.style.transform), singleSaved)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      assert.equal(fixture.entries[0].photos[0].canvas_x, 30, 'failed move must not modify persisted fixture')
      await page.getByRole('button', { name: '重试保存', exact: true }).click()
      await expect.poll(() => fixture.entries[0].photos[0].canvas_x).toBe(50)
      await expect.poll(() => writes.length).toBe(3)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)

      await canvas.focus()
      await page.keyboard.press('Control+z')
      await expect.poll(() => fixture.entries[0].photos[0].canvas_x).toBe(30)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      await page.keyboard.press('Control+Shift+z')
      await expect.poll(() => fixture.entries[0].photos[0].canvas_x).toBe(50)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)

      // A nested scene must preserve the outer group's selection and rigid move.
      fixture.entries[0].photos[0].canvas_x = -200
      fixture.entries[0].photos.push({ ...fixture.entries[0].photos[0], id: 'second', canvas_x: 200 })
      fixture.canvas_groups = [
        { id: 'inner', name: '内层', photo_ids: ['photo'], parent_id: 'outer', color: 'sky' },
        { id: 'outer', name: '外层', photo_ids: ['second'], color: 'sand' },
      ]
      writes.length = 0
      await page.reload()
      const second = page.locator('[data-photo-id="second"]')
      await expect(second).toBeVisible()
      await expect(page.locator('[data-photo-id] img')).toHaveCount(2)
      await expect.poll(() => page.locator('[data-photo-id] img').evaluateAll(nodes => nodes.every(node => node.complete && node.naturalWidth > 0))).toBe(true)
      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await photo.click()
      await expect(photo).toHaveAttribute('aria-pressed', 'true')
      await expect(second).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible()
      await second.click()
      await expect(page.getByText('已选 0 项', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      const handle = page.getByRole('button', { name: '移动分组：外层', exact: true })
      const groupBox = await handle.boundingBox(), gx = groupBox.x + groupBox.width / 2, gy = groupBox.y + groupBox.height / 2
      const beforeGroup = await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))
      await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + 24, gy + 8, { steps: 3 })
      const duringGroup = await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))
      assert.notDeepEqual(duringGroup, beforeGroup, label + ' group should visibly move')
      await page.keyboard.press('Escape'); await page.mouse.up()
      await expect.poll(() => page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))).toEqual(beforeGroup)
      assert.equal(writes.length, 0, label + ' group cancellation must not write')
      if (mobile) {
        const session = await context.newCDPSession(page)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gx, y: gy, id: 1 }] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gx + 24, y: gy + 8, id: 1 }] })
        assert.notDeepEqual(await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform }))), beforeGroup)
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        await expect.poll(() => page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))).toEqual(beforeGroup)
        await session.detach()
        assert.equal(writes.length, 0, 'cancelled touch group must not write')
      }
      await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + 24, gy + 8, { steps: 3 }); await page.mouse.up()
      await expect.poll(() => writes.length).toBe(1)
      assert.equal(writes[0].pathname, '/api/journal/layout')
      const members = [...writes[0].body.items].sort((a, b) => a.id.localeCompare(b.id))
      assert.deepEqual(members.map(item => item.id), ['photo', 'second'])
      assert.ok(Math.abs(members[1].x - members[0].x - 400) < .01, 'group must preserve member spacing')
      assert.ok(Math.abs(members[0].x + 170) < .01 && Math.abs(members[1].x - 230) < .01, 'group must move both members by 30 world units')
      assert.ok(members.every(item => Math.abs(item.y - 10) < .01), 'group must move both members by 10 world units vertically')
      const collapse = page.getByRole('button', { name: '折叠分组：外层', exact: true })
      await expect(collapse).toBeEnabled()
      const positioned = await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))
      await collapse.click()
      await expect(page.locator('[data-photo-id]')).toHaveCount(0)
      await expect(page.locator('[data-group-id="inner"]')).toHaveCount(0)
      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await page.getByRole('button', { name: '移动分组：外层', exact: true }).click()
      await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '展开分组：外层', exact: true }).click()
      await expect(photo).toBeVisible()
      await expect(second).toBeVisible()
      await expect.poll(() => page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))).toEqual(positioned)
      assert.equal(writes.filter(write => write.pathname === '/api/journal/layout').length, 1, 'fold/unfold must not send an extra layout request')
      await canvas.focus(); await page.keyboard.press('Escape')
      const stableGroup = await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform })))
      const retryBox = await handle.boundingBox(), rx = retryBox.x + retryBox.width / 2, ry = retryBox.y + retryBox.height / 2
      failNextLayout = true
      await page.mouse.move(rx, ry); await page.mouse.down(); await page.mouse.move(rx + 16, ry, { steps: 3 }); await page.mouse.up()
      await expect(page.getByRole('alert').filter({ hasText: '模拟布局保存失败' })).toBeVisible()
      assert.notDeepEqual(await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, transform: node.style.transform }))), stableGroup)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      assert.equal(fixture.entries[0].photos[0].canvas_x, -170)
      assert.equal(fixture.entries[0].photos[1].canvas_x, 230)
      await page.getByRole('button', { name: '重试保存', exact: true }).click()
      await expect.poll(() => fixture.entries[0].photos[0].canvas_x).toBe(-150)
      await expect.poll(() => fixture.entries[0].photos[1].canvas_x).toBe(250)
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      await canvas.focus()
      await page.keyboard.press('Control+z')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_x)).toEqual([-170, 230])
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      await page.keyboard.press('Control+Shift+z')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_x)).toEqual([-150, 250])
      await expect(page.getByText('正在保存位置…', { exact: true })).toHaveCount(0)
      await page.screenshot({ path: path.join(output, label + '-nested-group.png'), fullPage: true })
      // Verify editor shortcuts against a canvas that really has undo history.
      await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeEnabled()
      const beforeEditorWrites = writes.length
      const beforeEditorPositions = fixture.entries[0].photos.map(photo => ({ x: photo.canvas_x, y: photo.canvas_y, version: photo.layout_version }))
      await add.click()
      await expect(modal).toBeVisible()
      await modal.getByRole('tab', { name: '文字', exact: true }).click()
      await text.fill('Canvas history must stay unchanged')
      await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+Shift+z')
      await page.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
      await expect(add).toBeFocused()
      assert.equal(writes.length, beforeEditorWrites, label + ' editor undo/redo must leave canvas history alone')
      assert.deepEqual(fixture.entries[0].photos.map(photo => ({ x: photo.canvas_x, y: photo.canvas_y, version: photo.layout_version })), beforeEditorPositions)
      await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeEnabled()
      // Move the real page inside a scrolling ancestor while native pointer
      // capture is active. Layout must follow the pointer, not the old viewport.
      const beforeScrollWrites = writes.length
      const beforeScrollTransform = await photo.evaluate(node => node.style.transform)
      await page.evaluate(() => {
        const root = document.getElementById('root'), wrapper = document.createElement('div')
        wrapper.id = 'canvas-scroll-regression'
        wrapper.style.cssText = 'position:fixed;inset:0;overflow:auto'
        const top = document.createElement('div'), bottom = document.createElement('div')
        top.style.height = '100px'; bottom.style.height = '300px'
        root.before(wrapper); wrapper.append(top, root, bottom)
      })
      const scrollBox = await photo.boundingBox()
      const px = scrollBox.x + scrollBox.width / 2, py = scrollBox.y + scrollBox.height / 2
      await page.mouse.move(px, py); await page.mouse.down()
      await page.mouse.move(px + 24, py + 16, { steps: 3 })
      const canvasTop = (await canvas.boundingBox()).y
      await page.locator('#canvas-scroll-regression').evaluate(node => { node.scrollTop = 80 })
      await expect.poll(async () => (await canvas.boundingBox()).y).toBe(canvasTop - 80)
      await page.mouse.move(px + 25, py + 16)
      const afterScrollBox = await photo.boundingBox()
      assert.ok(Math.abs(afterScrollBox.x + afterScrollBox.width / 2 - px - 25) < 1, label + ' scrolled drag x follows pointer')
      assert.ok(Math.abs(afterScrollBox.y + afterScrollBox.height / 2 - py - 16) < 1, label + ' scrolled drag y follows pointer')
      await page.keyboard.press('Escape'); await page.mouse.up()
      await expect.poll(() => photo.evaluate(node => node.style.transform)).toBe(beforeScrollTransform)
      assert.equal(writes.length, beforeScrollWrites, label + ' cancelled scrolled drag must not write')
      await page.screenshot({ path: path.join(output, label + '-parent-scroll.png'), fullPage: true })
      await page.evaluate(() => {
        const wrapper = document.getElementById('canvas-scroll-regression')
        wrapper.before(document.getElementById('root')); wrapper.remove()
      })
      const wheelBox = await photo.boundingBox()
      const wx = wheelBox.x + wheelBox.width / 2, wy = wheelBox.y + wheelBox.height / 2
      await page.mouse.move(wx, wy); await page.mouse.wheel(0, -50)
      await expect(page.locator('.j-zoom-value')).toHaveText('85%')
      const zoomedBox = await photo.boundingBox()
      assert.ok(Math.abs(zoomedBox.x + zoomedBox.width / 2 - wx) < 1, label + ' native wheel x anchor')
      assert.ok(Math.abs(zoomedBox.y + zoomedBox.height / 2 - wy) < 1, label + ' native wheel y anchor')
      await page.mouse.wheel(0, 50)
      await expect(page.locator('.j-zoom-value')).toHaveText('80%')
      assert.equal(writes.length, beforeScrollWrites, label + ' wheel zoom must not save layout')
      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await page.keyboard.press('ControlOrMeta+a')
      await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible()
      const keyboardStart = fixture.entries[0].photos.map(photo => ({ x: photo.canvas_x, y: photo.canvas_y }))
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_x)).toEqual(keyboardStart.map(p => p.x + 1))
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      await page.keyboard.press('Shift+ArrowDown')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_y)).toEqual(keyboardStart.map(p => p.y + 10))
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      await page.keyboard.press('ControlOrMeta+z')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_y)).toEqual(keyboardStart.map(p => p.y))
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect.poll(() => fixture.entries[0].photos.map(photo => photo.canvas_y)).toEqual(keyboardStart.map(p => p.y + 10))
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      const beforeFramingWrites = writes.length
      await page.keyboard.press('f')
      await expect(canvas).toBeFocused()
      const framedCamera = await page.locator('.j-world').evaluate(node => node.style.transform)
      const panBox = await canvas.boundingBox()
      await page.keyboard.down('Space')
      await page.mouse.move(panBox.x + 10, panBox.y + 10); await page.mouse.down()
      await page.mouse.move(panBox.x + 310, panBox.y + 10, { steps: 4 }); await page.mouse.up()
      await page.keyboard.up('Space')
      assert.notEqual(await page.locator('.j-world').evaluate(node => node.style.transform), framedCamera)
      await page.getByRole('button', { name: '定位选中', exact: true }).click()
      await expect(canvas).toBeFocused()
      assert.equal(await page.locator('.j-world').evaluate(node => node.style.transform), framedCamera)
      assert.equal(writes.length, beforeFramingWrites, label + ' framing must not write layout')
      await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible()
      await page.screenshot({ path: path.join(output, label + '-keyboard-selection.png'), fullPage: true })
      await page.keyboard.press('Escape')
      // A neighboring unselected photo blocks a precise nudge, rather than
      // triggering the mouse drag's search for a distant free position.
      fixture.canvas_groups = []
      fixture.structure_version = String(BigInt(fixture.structure_version) + 1n)
      Object.assign(fixture.entries[0].photos[0], { canvas_x: 0, canvas_y: 0 })
      Object.assign(fixture.entries[0].photos[1], { canvas_x: 298, canvas_y: 0 })
      await page.reload()
      await expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await photo.click()
      await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible()
      const blockedWrites = writes.length
      await canvas.focus(); await page.keyboard.press('ArrowRight')
      await expect(page.getByText('当前位置受其他内容阻挡', { exact: true })).toBeVisible()
      assert.deepEqual(fixture.entries[0].photos.map(photo => photo.canvas_x), [0, 298])
      assert.equal(writes.length, blockedWrites, label + ' collision rejection must not save')
      const editorCamera = await page.locator('.j-world').evaluate(node => node.style.transform)
      await add.click(); await expect(modal).toBeVisible()
      await modal.getByRole('tab', { name: '文字', exact: true }).click()
      await text.fill('Arrow keys belong to this editor')
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('f')
      assert.equal(writes.length, blockedWrites, label + ' editor arrows must not nudge canvas')
      assert.equal(await page.locator('.j-world').evaluate(node => node.style.transform), editorCamera, label + ' editor f must not frame canvas')
      await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0)
      results.push({ label, parentScrollDrag: true, parentScrollCancel: true, mouseCancel: true, marqueeCancel: true, editorIsolation: true, selectionKeyboard: true, nativeTouchCancel: mobile, nestedSelection: true, groupCancel: true, nativeTouchGroupCancel: mobile, groupRigidMove: true, foldedSelection: true, unfoldPreservesLayout: true, singleFailureRetained: true, singleRetry: true, groupFailureRetained: true, groupRetry: true, singleUndoRedo: true, groupUndoRedo: true, singleLayoutAttempts: 5, groupLayoutAttempts: writes.filter(write => write.pathname === '/api/journal/layout').length })
    } catch (error) {
      await page.screenshot({ path: path.join(output, label + '-failure.png'), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await context.tracing.stop({ path: path.join(output, label + '-trace.zip') })
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, api: 'mocked; no personal data or real database', touch: 'Chromium emulation; not a physical phone' }, null, 2))
  console.log(`Canvas browser smoke: ${results.length} configurations passed. Artifacts: ${output}`)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
