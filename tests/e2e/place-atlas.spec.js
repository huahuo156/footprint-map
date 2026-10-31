import { test, expect } from '@playwright/test'

async function panAtlas(page, dx, dy) {
  const box = await page.locator('.j-atlas-viewport').boundingBox()
  await page.mouse.move(box.x + 8, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(box.x + 8 + dx, box.y + 80 + dy, { steps: 8 })
  await page.mouse.up()
}

const mapCenter = page => page.locator('.j-atlas-world').evaluate(element => {
  const rect = element.getBoundingClientRect(), scale = new DOMMatrix(getComputedStyle(element).transform).a
  return { x: rect.x + 550 * scale, y: rect.y + 390 * scale }
})

test('explores place groups, city clusters and visited provinces on the infinite atlas', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const batches = [
    { name: '武汉市', count: 14, image: 'west-lake', date: '2024-10-01' },
    { name: '成都市', count: 3, image: 'jiuzhaigou', date: '2025-03-15' },
    { name: '杭州市', count: 2, image: 'palace', date: '' },
  ]
  const entries = batches.map((batch, index) => ({ id: `explore-${index}`, entry_date: batch.date, photos: Array.from({ length: batch.count }, (_, i) => ({
    id: `explore-${index}-${i}`, url: `/journal-demo/${batch.image}.jpg`,
    components: [{ type: 'place', value: { name: batch.name } }, ...(batch.date ? [{ type: 'date', value: batch.date }] : [])],
  })) }))
  await page.route('**/api/journal', route => route.fulfill({ json: { entries, trips: [], marks: [], notebooks: [] } }))
  await page.route('**/api/landmarks', route => route.fulfill({ json: [] }))
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('shitu-atlas-layout-v1'))
  await page.getByRole('button', { name: '地点视图', exact: true }).click()
  await expect(page.getByRole('button', { name: '创建手札', exact: true })).toHaveCount(0)
  await expect(page.locator('.j-atlas-province.is-visited')).toHaveCount(3)
  await page.getByRole('button', { name: '下一组照片' }).click()
  await expect(page.locator('.j-atlas-photo')).toHaveCount(7)
  await panAtlas(page, 100, -60)
  const overviewTransform = await page.locator('.j-atlas-world').getAttribute('style')
  await page.screenshot({ path: 'test-results/atlas-provinces-overview.png' })
  const pin = page.getByRole('button', { name: '聚焦地点：武汉市 · 14 张照片' })
  await pin.locator(':scope > path').click()
  await expect(page.getByRole('complementary', { name: '武汉市的回忆' })).toBeVisible()
  await expect(page.locator('.j-atlas-photo:not(.is-muted)')).toHaveCount(12)
  await page.getByRole('button', { name: '下一组照片' }).click()
  await expect(page.locator('.j-atlas-photo:not(.is-muted)')).toHaveCount(2)
  const focused = await page.locator('.j-atlas-photo:not(.is-muted)').first().boundingBox()
  await page.mouse.move(focused.x + focused.width / 2, focused.y + focused.height / 2)
  await page.mouse.down()
  await page.mouse.move(focused.x + focused.width / 2 + 50, focused.y + focused.height / 2 + 25, { steps: 5 })
  await page.mouse.up()
  expect(await page.evaluate(() => localStorage.getItem('shitu-atlas-layout-v1'))).toBeNull()
  await pin.locator(':scope > path').click()
  await expect(page.getByRole('complementary')).toHaveCount(0)
  await expect(page.locator('.j-atlas-photo')).toHaveCount(7)
  await expect(page.locator('.j-atlas-world')).toHaveAttribute('style', overviewTransform)
  const zoom = page.getByRole('slider', { name: '快速缩放地点视图' })
  await zoom.focus()
  await zoom.press('Home')
  for (let step = 0; step < 10; step++) await zoom.press('ArrowRight')
  await expect(zoom).toHaveValue('60')
  await expect(page.locator('.j-atlas-photo')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '聚焦城市：武汉市 · 14 张照片' })).toBeVisible()
  await page.screenshot({ path: 'test-results/atlas-city-clusters.png' })
  await page.getByRole('button', { name: '聚焦城市：武汉市 · 14 张照片' }).click()
  await expect(zoom).toHaveValue('100')
  await page.getByRole('button', { name: '返回全景' }).click()
  await expect(zoom).toHaveValue('60')
  await page.getByRole('button', { name: '适合窗口' }).click()
  const province = page.getByRole('button', { name: '查看湖北省足迹，14 张照片' })
  await province.focus()
  await province.press('Enter')
  const panel = page.getByRole('complementary', { name: '湖北省的回忆' })
  await expect(panel.getByLabel('到访次数')).toHaveText('1 次')
  await expect(panel.getByText('2024-10-01')).toBeVisible()
  await page.screenshot({ path: 'test-results/atlas-province-focus.png' })
  await panel.getByRole('button', { name: /查看原片/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: '查看浙江省足迹，2 张照片' }).click()
  await expect(page.getByRole('complementary', { name: '浙江省的回忆' }).getByText('暂无日期')).toBeVisible()
})

test('place view keeps photos separate, opens them and can enter their scene', async ({ page }) => {
  const photos = Array.from({ length: 14 }, (_, index) => ({
    id: `atlas-${index}`, url: '/journal-demo/west-lake.jpg',
    components: [{ type: 'place', value: { name: '西湖', lat: 30.25, lng: 120.15 } }],
  }))
  await page.route('**/api/journal', route => route.fulfill({ json: {
    entries: [{ id: 'atlas-entry', entry_date: '2026-10-26', photos }], trips: [], marks: [], notebooks: [],
  } }))
  await page.route('**/api/landmarks', route => route.fulfill({ json: [] }))
  await page.goto('/')
  await page.getByRole('button', { name: '地点视图', exact: true }).click()
  const quickZoom = page.getByRole('slider', { name: '快速缩放地点视图' })
  await quickZoom.focus()
  await quickZoom.press('End')
  await expect(quickZoom).toHaveValue('400')
  await expect.poll(() => page.locator('.j-atlas-world').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBe(4)
  await page.getByRole('button', { name: '适合窗口' }).click()
  await expect(quickZoom).toHaveValue('100')
  const viewport = page.locator('.j-atlas-viewport')
  const viewBox = await viewport.boundingBox()
  const center = await mapCenter(page)
  await page.mouse.move(viewBox.x + 150, viewBox.y + 200)
  await page.mouse.wheel(0, -120)
  await expect(quickZoom).toHaveValue('110')
  const zoomedCenter = await mapCenter(page)
  expect(zoomedCenter.x).toBeCloseTo(center.x, 1)
  expect(zoomedCenter.y).toBeCloseTo(center.y, 1)
  await page.mouse.wheel(0, 120)
  await expect(quickZoom).toHaveValue('100')
  expect((await page.locator('.j-atlas-heading').boundingBox()).height).toBeLessThanOrEqual(42)
  expect(await viewport.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 0, y: 0 })
  await panAtlas(page, -1600, 300)
  const pannedCenter = await mapCenter(page)
  expect(pannedCenter.x).toBeCloseTo(center.x - 1600, 1)
  expect(pannedCenter.y).toBeCloseTo(center.y + 300, 1)
  await page.getByRole('button', { name: '适合窗口' }).click()
  await page.screenshot({ path: 'test-results/atlas-infinite-canvas.png' })
  await expect(page.locator('.j-atlas-photo')).toHaveCount(12)
  const boxes = await page.locator('.j-atlas-photo').evaluateAll(nodes => nodes.map(node => {
    const { left, right, top, bottom } = node.getBoundingClientRect()
    return { left, right, top, bottom }
  }))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
  }
  await page.getByRole('button', { name: '下一组照片' }).click()
  await expect(page.locator('.j-atlas-photo')).toHaveCount(2)
  await page.locator('.j-atlas-photo').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '走进西湖 3D' }).click()
  await expect(page.getByRole('button', { name: '自由画布', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('city-only photos get pins and loose photos keep a draggable scattered layout after refresh', async ({ page }) => {
  const photos = Array.from({ length: 11 }, (_, index) => ({
    id: `scatter-${index}`, url: `/journal-demo/${['west-lake', 'palace', 'wuzhen', 'jiuzhaigou'][index % 4]}.jpg`,
    components: index === 0 ? [{ type: 'place', value: { name: '武汉市' } }] : [],
  }))
  await page.route('**/api/journal', route => route.fulfill({ json: {
    entries: [{ id: 'city-entry', entry_date: '2026-10-26', photos }], trips: [], marks: [], notebooks: [],
  } }))
  await page.route('**/api/landmarks', route => route.fulfill({ json: [] }))
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('shitu-atlas-layout-v1'))
  await page.getByRole('button', { name: '地点视图', exact: true }).click()
  await expect(page.locator('.j-atlas-photo')).toHaveCount(1)
  await expect(page.locator('.j-atlas-photo')).toHaveAttribute('title', '武汉市 · 城市中心位置')
  await expect(page.locator('.j-atlas-loose-photo')).toHaveCount(10)
  await expect(page.locator('.j-atlas-loose-photo img')).toHaveCount(10)
  await expect.poll(() => page.locator('.j-atlas-loose-photo img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  const card = page.locator('[data-atlas-photo="scatter-1"]')
  await panAtlas(page, 0, -950)
  const cardBox = await card.boundingBox()
  const canvasBox = await page.locator('.j-atlas-viewport').boundingBox()
  await panAtlas(page, canvasBox.x + canvasBox.width / 2 - cardBox.x - cardBox.width / 2, canvasBox.y + canvasBox.height / 2 - cardBox.y - cardBox.height / 2)
  const before = await card.boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 70, before.y + before.height / 2 + 65, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shitu-atlas-layout-v1')).loose['scatter-1'])
  expect(saved.x).toBeGreaterThan(0)
  const after = await card.evaluate(node => ({ left: node.style.left, top: node.style.top }))
  await page.screenshot({ path: 'test-results/atlas-scatter-desktop.png', fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: '地点视图', exact: true }).click()
  await expect.poll(() => page.locator('.j-atlas-loose-photo img').evaluateAll(images => images.length === 10 && images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  await expect.poll(() => card.evaluate(node => ({ left: node.style.left, top: node.style.top }))).toEqual(after)
  const boxes = await page.locator('.j-atlas-loose-photo').evaluateAll(nodes => nodes.map(node => {
    const { left, right, top, bottom } = node.getBoundingClientRect()
    return { left, right, top, bottom }
  }))
  for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) {
    const a = boxes[i]
    expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
  }
})
