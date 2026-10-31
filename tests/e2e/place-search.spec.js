import { test, expect } from '@playwright/test'

test('editing a photo searches addresses and saves the selected location', async ({ page }) => {
  const entry = { id: 'location-entry', entry_date: '2026-10-26', photos: [{ id: 'location-photo', url: '/journal-demo/west-lake.jpg', components: [{ type: 'place', value: { name: '武汉市' } }] }] }
  await page.route('**/api/journal', route => route.fulfill({ json: { entries: [entry], trips: [], marks: [], notebooks: [] } }))
  await page.route('**/api/landmarks', route => route.fulfill({ json: [] }))
  await page.route('**/api/places?*', route => route.fulfill({ json: { places: [{ id: 'school', name: '中南民族大学', address: '湖北省武汉市洪山区民族大道182号', lat: 30.49, lng: 114.39 }] } }))
  let saved
  await page.route('**/api/journal/entries/location-entry', async route => {
    saved = route.request().postData()
    await route.fulfill({ json: entry })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '地点视图', exact: true }).click()
  await page.getByRole('button', { name: '打开照片：武汉市 1' }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('旅行地点').fill('中南民族')
  const result = page.getByRole('option', { name: /中南民族大学/ })
  await expect(result).toBeVisible()
  await expect(result).toContainText('湖北省武汉市洪山区民族大道182号')
  await result.click()
  await expect(page.getByLabel('旅行地点')).toHaveValue('中南民族大学')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved).toContain('"lat":30.49')
  expect(saved).toContain('"lng":114.39')
  expect(saved).toContain('"poi_id":"school"')
})
