// Interaction and projection checks use fixtures, never the user's database.
import express from 'express'
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const app = express(), root = path.resolve('dist')
app.use(express.static(root))
app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
const output = path.resolve('test-results/atlas-perspective')
const captureScreenshots = process.env.ATLAS_SCREENSHOTS !== '0'
await mkdir(output, { recursive: true })
const errors = []
const places = [
  { name: '清华大学', lat: 40.002, lng: 116.322 },
  { name: '哈尔滨工业大学', lat: 45.747, lng: 126.634 },
  { name: '陕西师范大学长安校区', lat: 34.157, lng: 108.899 },
  { name: '武汉市', lat: 30.584, lng: 114.299 },
  { name: '西湖', lat: 30.25, lng: 120.15 },
]
const images = ['wuzhen.jpg', 'west-lake.jpg', 'great-wall.jpg', 'emei.jpg']
function fixture(count) {
  return { trips: [], marks: [], notebooks: [], notebook_items: [], notebook_pages: [], canvas_groups: [], entries: Array.from({ length: count }, (_, index) => ({
    id: 'entry-' + index, entry_date: '2026-10-27', components: [], photos: [{ id: 'photo-' + index, url: '/journal-demo/' + images[index % images.length], components: [{ type: 'place', value: places[index % places.length] }], canvas_absolute: 1, canvas_x: index % 10 * 600, canvas_y: Math.floor(index / 10) * 600, rotation: 0 }],
  })) }
}
try {
  for (const [count, colorScheme, mobile] of [[20, 'dark', false], [20, 'light', false], [80, 'dark', false], [20, 'dark', true]]) {
    const data = fixture(count), context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, isMobile: mobile, hasTouch: mobile })
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url()).pathname
      if (url.startsWith('/api/auth/')) return route.fulfill({ json: { user: { id: 'atlas-user', email: 'test@example.com', email_verified: true }, csrfToken: 'fixture' } })
      if (url === '/api/journal') return route.fulfill({ json: data })
      if (url === '/api/landmarks') return route.fulfill({ json: [] })
      throw new Error('Unexpected API request: ' + route.request().method() + ' ' + url)
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await expect(page.getByRole('navigation', { name: '手札视图' })).toHaveCSS('display', 'flex')
    await expect(page.getByRole('button', { name: '自由画布', exact: true })).toHaveCSS('display', 'flex')
    await page.reload()
    await expect(page.getByRole('navigation', { name: '手札视图' })).toHaveCSS('display', 'flex')
    await expect(page.getByRole('button', { name: '足迹版图', exact: true })).toHaveCSS('display', 'flex')
    if (!mobile && captureScreenshots) await page.locator('.j-app-header').screenshot({ path: path.join(output, `${colorScheme}-${count}-initial-header.png`) })
    await page.getByRole('button', { name: '足迹版图', exact: true }).click()
    await expect(page.locator('.j-atlas-photo')).toHaveCount(count)
    await expect(page.getByRole('button', { name: '下一组照片' })).toHaveCount(0)
    await expect(page.locator('.j-atlas-map-surface')).toHaveAttribute('data-atlas-tilt', '20.00')
    await page.waitForFunction(() => [...document.querySelectorAll('.j-atlas-photo img')].every(image => image.complete && image.naturalWidth > 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const overlap = await page.locator('.j-atlas-photo').evaluateAll(elements => {
      const boxes = elements.map(element => element.getBoundingClientRect())
      return boxes.some((a, index) => boxes.slice(index + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top))
    })
    assert.equal(overlap, false, `${count} photos must have no collisions`)
    if (!mobile) {
      if (captureScreenshots) await page.screenshot({ path: path.join(output, `${colorScheme}-${count}-overview.png`) })
      // Exercise the real wheel handler, then settle at a known zoom for geometry.
      await page.locator('.j-atlas-viewport').hover({ position: { x: 500, y: 400 } })
      await page.mouse.wheel(0, -120)
      await expect.poll(async () => Number(await page.locator('.j-atlas-map-surface').getAttribute('data-atlas-tilt'))).toBeLessThan(20)
      await page.getByRole('slider', { name: '快速缩放地点视图' }).fill('160')
      await expect.poll(async () => Number(await page.locator('.j-atlas-map-surface').getAttribute('data-atlas-tilt'))).toBeLessThan(15)
    } else {
      await page.getByRole('button', { name: '放大地点视图' }).click()
      await expect.poll(async () => Number(await page.locator('.j-atlas-map-surface').getAttribute('data-atlas-tilt'))).toBeLessThan(20)
    }
    const alignment = await page.evaluate(placeList => {
      const surface = document.querySelector('.j-atlas-map-surface svg')
      const pins = [...document.querySelectorAll('.j-atlas-pin')]
      return placeList.map(place => {
        const pin = pins.find(element => element.getAttribute('aria-label').includes(place.name))
        const probe = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        probe.setAttribute('cx', 550 + (place.lng - 104) * 7.2)
        probe.setAttribute('cy', 360 + (33 - place.lat) * 6.8)
        probe.setAttribute('r', '.001'); probe.style.pointerEvents = 'none'
        surface.append(probe)
        const marker = probe.cloneNode()
        marker.setAttribute('cx', 0); marker.setAttribute('cy', 0)
        pin.append(marker)
        const mapBox = probe.getBoundingClientRect(), pinBox = marker.getBoundingClientRect()
        const error = Math.hypot(mapBox.x + mapBox.width / 2 - pinBox.x - pinBox.width / 2, mapBox.y + mapBox.height / 2 - pinBox.y - pinBox.height / 2)
        marker.remove(); probe.remove()
        return { place: place.name, error }
      })
    }, places)
    assert.ok(alignment.every(item => item.error < 1), JSON.stringify(alignment))
    const line = await page.locator('.j-atlas-thread').first().evaluate(element => ({ stroke: getComputedStyle(element).stroke, width: getComputedStyle(element).strokeWidth, effect: getComputedStyle(element).vectorEffect }))
    const pinColor = await page.getByRole('button', { name: `聚焦地点：清华大学 · ${count / 5} 张照片` }).evaluate(element => getComputedStyle(element).fill)
    assert.equal(line.stroke, pinColor, 'the connector must use the corresponding PIN color')
    const colorsMatch = await page.evaluate(({ places, count }) => {
      return Array.from({ length: count }, (_, index) => {
        const place = places[index % places.length]
        const pin = [...document.querySelectorAll('.j-atlas-pin')].find(element => element.getAttribute('aria-label').includes(place.name))
        const thread = document.querySelector(`[data-atlas-thread="photo-${index}"]`)
        return getComputedStyle(pin).fill === getComputedStyle(thread).stroke
      }).every(Boolean)
    }, { places, count })
    assert.ok(colorsMatch, 'all connections must match their own PIN, across provinces')
    assert.equal(line.effect, 'non-scaling-stroke')
    assert.ok(Number.parseFloat(line.width) >= 1.25)
    if (!mobile) {
      await page.getByRole('slider', { name: '快速缩放地点视图' }).fill('242')
    } else {
      for (let index = 0; index < 4; index++) await page.getByRole('button', { name: '放大地点视图' }).click()
    }
    await expect(page.locator('.j-atlas-map-surface')).toHaveAttribute('data-atlas-tilt', '0.00')
    const matrix = await page.locator('.j-atlas-map-surface').evaluate(element => {
      const m = new DOMMatrix(getComputedStyle(element).transform)
      return { x: m.m11, y: m.m22, z: m.m23 }
    })
    assert.ok(Math.abs(matrix.x - matrix.y) < .0001 && Math.abs(matrix.z) < .0001, 'zoomed map must be parallel to the screen without vertical foreshortening')
    if (!mobile && captureScreenshots) await page.screenshot({ path: path.join(output, `${colorScheme}-${count}-tilted.png`) })
    await page.getByRole('button', { name: '适合窗口', exact: true }).click()
    await expect(page.locator('.j-atlas-map-surface')).toHaveAttribute('data-atlas-tilt', '20.00')
    if (!mobile) {
      await page.locator('[data-atlas-photo="photo-0"]').hover()
      await expect(page.locator('[data-atlas-thread="photo-0"]')).toHaveClass(/is-active/)
      await expect(page.locator('[data-atlas-thread="photo-0"]')).toHaveCSS('stroke-width', '2.25px')
      await expect(page.locator('[data-atlas-thread="photo-0"]')).toHaveCSS('stroke', pinColor)
      const province = page.getByRole('button', { name: `查看北京市足迹，${count / 5} 张照片` })
      await province.focus(); await province.press('Enter')
      await expect(page.getByRole('complementary', { name: '北京市的回忆' })).toBeVisible()
      await page.getByRole('button', { name: '返回全景', exact: true }).click()
    }
    const pin = page.getByRole('button', { name: `聚焦地点：清华大学 · ${count / 5} 张照片` })
    await pin.locator(':scope > path').click()
    await expect(page.getByRole('complementary', { name: '清华大学的回忆' })).toBeVisible()
    await expect(page.locator('.j-atlas-photo:not(.is-muted)')).toHaveCount(count / 5)
    await expect(page.locator('.j-atlas-selection-photos button')).toHaveCount(count / 5)
    await page.getByRole('button', { name: '返回全景', exact: true }).click()
    await expect(page.locator('.j-atlas-photo')).toHaveCount(count)
    if (!mobile && count === 20) {
      const transform = await page.locator('.j-atlas-world').evaluate(element => element.style.transform)
      const photo = page.locator('.j-atlas-photo').first(), bounds = await photo.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 55, { steps: 10 })
      await page.mouse.up()
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('shitu-atlas-layout-v1:atlas-user'))?.map?.['photo-0'])
      assert.equal(await page.locator('.j-atlas-world').evaluate(element => element.style.transform), transform, 'dropping a photo must not move or rescale the camera')
      await page.getByRole('button', { name: '适合窗口', exact: true }).click()
    }
    await context.close()
    console.log(`PASS ${colorScheme} ${mobile ? 'mobile' : 'desktop'} ${count} photos: all-photo layout, zoom/tilt, projected pin alignment, focus/return; thread ${line.stroke}`)
  }
  assert.deepEqual(errors, [])
  console.log('Screenshots: ' + output)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
