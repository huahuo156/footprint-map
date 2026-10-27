import { test, expect } from '@playwright/test'

for (const colorScheme of ['light', 'dark']) {
  test(`atlas mouse focus has no bounding box in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname
      const data = pathname.startsWith('/api/auth/')
        ? { user: { id: 'atlas-focus-user', email: 'atlas@example.com', email_verified: true }, csrfToken: 'fixture' }
        : pathname === '/api/journal'
          ? { entries: [{ id: 'entry', photos: [{ id: 'photo', url: '/journal-demo/west-lake.jpg', components: [{ type: 'place', value: { name: '武汉市' } }] }] }], trips: [], marks: [], notebooks: [] }
          : []
      return route.fulfill({ json: data })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '足迹版图', exact: true }).click()
    const pin = page.getByRole('button', { name: '聚焦地点：武汉市 · 1 张照片' })
    await pin.locator(':scope > path').click()
    await expect(page.getByRole('complementary', { name: '武汉市的回忆' })).toBeVisible()
    await expect(pin).toBeFocused()
    await expect(pin).toHaveCSS('outline-style', 'none')
    await page.screenshot({ path: `test-results/atlas-focus-${colorScheme}.png` })
    // Keyboard navigation keeps a visible cue without the SVG bounding box.
    await page.keyboard.press('Tab')
    await pin.focus()
    await expect(pin.locator('.j-atlas-pin-label')).toHaveCSS('opacity', '1')
    await expect(pin).not.toHaveCSS('filter', 'none')
    await page.getByRole('button', { name: '返回全景' }).click()
    const province = page.getByRole('button', { name: '查看湖北省足迹，1 张照片' })
    await province.focus()
    await expect(province).toHaveCSS('outline-style', 'none')
    await province.press('Enter')
    await expect(page.getByRole('complementary', { name: '湖北省的回忆' })).toBeVisible()
    await expect(province).toHaveCSS('fill-opacity', '0.6')
    await page.getByRole('button', { name: '返回全景' }).click()
    const zoom = page.getByRole('slider', { name: '快速缩放地点视图' })
    await zoom.focus()
    await zoom.press('Home')
    for (let step = 0; step < 10; step++) await zoom.press('ArrowRight')
    const city = page.getByRole('button', { name: '聚焦城市：武汉市 · 1 张照片' })
    await city.focus()
    await expect(city).toBeFocused()
    await expect(city).toHaveCSS('outline-style', 'none')
    await expect(city.locator('rect')).toHaveCSS('stroke-width', '2.5px')
    await city.locator('rect').click()
    await expect(page.getByRole('complementary', { name: '武汉市的回忆' })).toBeVisible()
  })
}
