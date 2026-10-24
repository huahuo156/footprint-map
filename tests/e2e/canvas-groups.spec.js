import { test, expect } from '@playwright/test'

const api = '/api/journal'
test('group selected photos, move together, recover failed moves, persist and dissolve; images keep proportions', async ({ page, request }) => {
  const created = [], groups = []
  const existing = await (await request.get(api)).json()
  const existingEntries = new Set(existing.entries.map(entry => entry.id))
  const existingGroups = new Set(existing.canvas_groups.map(group => group.id))
  await page.route('**/api/journal', async route => {
    const response = await route.fetch(), data = await response.json()
    await route.fulfill({ response, json: { ...data, trips: [], marks: [], entries: data.entries.filter(entry => !existingEntries.has(entry.id)), canvas_groups: data.canvas_groups.filter(group => !existingGroups.has(group.id)) } })
  })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  try {
    const specs = [[1200, 600, -210, 0, '#95b7a0'], [600, 1200, 210, 0, '#c49d87'], [80, 40, 0, 350, '#8daebd']]
    const photoIds = []
    for (const [width, height, x, y, color] of specs) {
      const encoded = await page.evaluate(({ width, height, color }) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height)
        return canvas.toDataURL().split(',')[1]
      }, { width, height, color })
      const response = await request.post(api + '/entries', { multipart: { data: JSON.stringify({ components: [], photos: [{ upload_index: 0, components: [], canvas_x: x, canvas_y: y }] }), images: { name: 'ratio.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') } } })
      expect(response.status()).toBe(201)
      const id = (await response.json()).id; created.push(id)
      photoIds.push((await (await request.get(api)).json()).entries.find(entry => entry.id === id).photos[0].id)
    }
    await page.addInitScript(() => localStorage.removeItem('shitu-camera-v1'))
    await page.goto('/')
    const photo = id => page.locator(`[data-photo-id="${id}"]`)
    await expect(photo(photoIds[0]).locator('img')).toHaveJSProperty('naturalWidth', 1200)
    await expect.poll(() => photo(photoIds[0]).locator('img').evaluate(node => node.clientWidth / node.clientHeight)).toBeCloseTo(2, 1)
    await expect.poll(() => photo(photoIds[1]).locator('img').evaluate(node => node.clientWidth / node.clientHeight)).toBeCloseTo(.5, 1)
    expect(await photo(photoIds[2]).evaluate(node => parseFloat(node.style.width))).toBe(100)
    await page.getByRole('button', { name: '多选内容', exact: true }).click()
    await photo(photoIds[0]).click(); await photo(photoIds[1]).click()
    await page.getByRole('button', { name: '添加色块分组', exact: true }).click()
    await page.getByLabel('组名', { exact: true }).fill('湖边的片刻')
    await page.getByRole('button', { name: '天空蓝', exact: true }).click()
    const saved = page.waitForResponse(response => response.url().endsWith('/journal/groups') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '保存分组', exact: true }).click()
    const response = await saved; expect(response.status()).toBe(201); groups.push((await response.json()).id)
    await expect(page.getByRole('dialog')).toBeHidden()
    const group = page.locator(`[data-group-id="${groups[0]}"]`)
    await expect(group).toHaveAttribute('data-color', 'sky')
    const handle = page.getByRole('button', { name: '移动分组：湖边的片刻', exact: true })
    const positions = async () => (await (await request.get(api)).json()).entries.filter(entry => created.includes(entry.id)).flatMap(entry => entry.photos).sort((a, b) => a.id.localeCompare(b.id))
    const before = await positions()
    async function drag() {
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y + box.height / 2 + 45, { steps: 8 }); await page.mouse.up()
    }
    let moveResponse = page.waitForResponse(response => response.url().endsWith('/journal/layout') && response.request().method() === 'PATCH')
    let releaseMove
    const pendingMove = new Promise(resolve => { releaseMove = resolve })
    await page.route('**/api/journal/layout', async route => { await pendingMove; await route.continue() })
    const groupBefore = await group.boundingBox(), photoBefore = await photo(photoIds[0]).boundingBox()
    await drag()
    await expect(page.getByText('正在保存位置…')).toBeVisible()
    const groupPending = await group.boundingBox(), photoPending = await photo(photoIds[0]).boundingBox()
    expect(groupPending.x - groupBefore.x).toBeCloseTo(80, 0)
    expect(photoPending.x - photoBefore.x).toBeCloseTo(80, 0)
    releaseMove(); expect((await moveResponse).status()).toBe(200)
    await page.unroute('**/api/journal/layout')
    await expect(page.getByText('正在保存位置…')).toHaveCount(0)
    const after = await positions(), members = after.filter(photo => photoIds.slice(0, 2).includes(photo.id))
    const delta = members.map(photo => ({ x: photo.canvas_x - before.find(old => old.id === photo.id).canvas_x, y: photo.canvas_y - before.find(old => old.id === photo.id).canvas_y }))
    expect(delta[0].x).toBeGreaterThan(50); expect(delta[0].x).toBeCloseTo(delta[1].x, 4); expect(delta[0].y).toBeCloseTo(delta[1].y, 4)
    expect(after.find(photo => photo.id === photoIds[2])).toEqual(before.find(photo => photo.id === photoIds[2]))
    const transforms = await Promise.all(photoIds.map(id => photo(id).getAttribute('style')))
    await page.route('**/api/journal/layout', route => route.fulfill({ status: 503, json: { error: '位置未保存，请重试' } }))
    moveResponse = page.waitForResponse(response => response.url().endsWith('/journal/layout'))
    await drag(); expect((await moveResponse).status()).toBe(503)
    await expect(page.getByRole('status')).toContainText('位置未保存，请重试')
    await expect.poll(() => Promise.all(photoIds.map(id => photo(id).getAttribute('style')))).toEqual(transforms)
    await page.unroute('**/api/journal/layout')
    await page.reload()
    await expect(handle).toBeVisible()
    expect(await positions()).toEqual(after)
    await page.getByRole('button', { name: '编辑分组：湖边的片刻', exact: true }).click()
    await page.getByLabel('组名', { exact: true }).fill('湖畔')
    await page.getByRole('button', { name: '玫瑰粉', exact: true }).click()
    await page.getByRole('button', { name: '保存分组', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(group).toHaveAttribute('data-color', 'rose')
    await page.screenshot({ path: 'test-results/canvas-groups.png' })
    await page.getByRole('button', { name: '编辑分组：湖畔', exact: true }).click()
    await page.getByRole('button', { name: '解除分组', exact: true }).click()
    await expect(group).toHaveCount(0)
    for (const id of photoIds) await expect(photo(id)).toBeVisible()
    expect(await positions()).toEqual(after)
    expect(errors).toEqual([])
  } finally {
    for (const id of groups) await request.delete(api + '/groups/' + id)
    for (const id of created) await request.delete(api + '/entries/' + id)
  }
})
