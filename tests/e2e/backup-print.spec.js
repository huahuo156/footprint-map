import { test, expect } from '@playwright/test'
import { zipChunks } from '../../server/zip.js'
import { buildExifJpeg } from '../helpers/exifJpeg.js'
import { readFile } from 'node:fs/promises'

test('an empty journal on a phone exposes restore without requiring a first entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/journal', route => route.fulfill({ json: { trips: [], entries: [], marks: [], notebooks: [], notebook_pages: [], notebook_items: [] } }))
  await page.goto('/')
  await page.getByRole('button', { name: '备份与还原', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '备份与还原' }).getByRole('button', { name: '选择备份文件还原' })).toBeVisible()
})

test('a real JPEG upload pre-fills EXIF date and nearby landmark before saving', async ({ page }) => {
  const jpeg = await readFile('public/journal-demo/west-lake.jpg')
  const metadata = buildExifJpeg()
  const image = Buffer.concat([metadata, jpeg.subarray(2)])
  const empty = { trips: [], entries: [], marks: [], notebooks: [], notebook_pages: [], notebook_items: [] }
  await page.route('**/api/journal', route => route.fulfill({ json: empty }))
  await page.route('**/api/landmarks', route => route.fulfill({ json: [{ id: 7, name: '西湖', lat: 30.25, lng: 120.15 }] }))
  let saved
  await page.route('**/api/journal/entries', async route => {
    // Inspect the actual submitted multipart data, not a mocked EXIF reader.
    const request = new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': route.request().headers()['content-type'] }, body: route.request().postDataBuffer() })
    saved = JSON.parse((await request.formData()).get('data'))
    await route.fulfill({ status: 201, json: { id: 'saved' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '留下一刻', exact: true }).first().click()
  const composer = page.getByRole('dialog', { name: '留下一刻', exact: true })
  await composer.getByLabel('选择旅行照片').setInputFiles({ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(composer.getByLabel('发生在')).toHaveValue('2024-05-01')
  await expect(composer.getByLabel('旅行地点')).toHaveValue('西湖')
  await composer.getByRole('button', { name: '留下', exact: true }).click()
  await expect(composer).toHaveCount(0)
  expect(saved.photos[0].components).toEqual([{ type: 'date', value: '2024-05-01' }, { type: 'place', value: { name: '西湖', landmark_id: 7, lat: 30.263889, lng: 120.15, spot_key: '' } }])
})

test('backup dialog downloads ZIP and restores a selected archive then refreshes the journal', async ({ page }) => {
  const chunks = []
  for await (const chunk of zipChunks([{ name: 'backup.json', data: Buffer.from(JSON.stringify({ format: 'shitu-journal-backup', version: 1, data: {} })) }])) chunks.push(chunk)
  const archive = Buffer.concat(chunks)
  let journalReads = 0
  await page.route('**/api/journal', route => { journalReads++; return route.fulfill({ json: { trips: [], entries: [], marks: [], notebooks: [], notebook_pages: [], notebook_items: [] } }) })
  await page.route('**/api/journal/backup', route => route.fulfill({ body: archive, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="shitu-backup.zip"' } }))
  await page.route('**/api/journal/restore', async route => {
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    expect(route.request().postDataBuffer().includes(archive)).toBe(true)
    await route.fulfill({ json: { restored: { photos: 0, entries: 0, marks: 0, notebooks: 0 } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '备份', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '备份与还原' })
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出备份文件' }).click()
  expect((await downloading).suggestedFilename()).toMatch(/^shitu-backup-.*\.zip$/)
  const beforeRestore = journalReads
  page.on('dialog', prompt => prompt.accept())
  await dialog.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: archive })
  await expect(dialog.getByRole('status')).toContainText('已还原')
  expect(journalReads).toBeGreaterThan(beforeRestore)
})

test('notebook print preview contains all pages and produces an A4 PDF', async ({ page }) => {
  const book = { id: 'print-book', name: '江南留念册', cover_text: '把平凡的日子留下。', cover_mode: 'photo', cover_url: '/journal-demo/wuzhen.jpg' }
  const data = { trips: [], marks: [{ id: 'mark', kind: 'text', text: '沿着湖边慢慢走。', color: 'ink', size: 'medium' }], entries: [{ id: 'entry', entry_date: '2024-05-01', components: [], photos: [{ id: 'photo', url: '/journal-demo/west-lake.jpg', components: [{ type: 'date', value: '2024-05-01' }, { type: 'description', value: '那天下午的风很好。' }] }] }], canvas_groups: [], notebooks: [book], notebook_pages: [0, 1, 2, 3].map(i => ({ id: 'page' + i, notebook_id: book.id, sort_order: i })), notebook_items: [{ kind: 'photo', id: 'photo', page_id: 'page0', x: 380, y: 500 }, { kind: 'mark', id: 'mark', page_id: 'page3', x: 600, y: 700 }] }
  await page.route('**/api/journal', route => route.fulfill({ json: data }))
  await page.goto('/')
  await page.getByRole('button', { name: '打开手帐：江南留念册' }).click()
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '留念册打印预览' })
  await expect(preview.getByRole('button', { name: '打印 / 保存为 PDF' })).toBeEnabled()
  await expect(preview.locator('[data-print-page]')).toHaveCount(6)
  await expect(preview.getByText('沿着湖边慢慢走。')).toHaveCount(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.nb-reader')).toBeHidden()
  await expect(preview.locator('.nb-print-controls')).toBeHidden()
  const pdf = await page.pdf({ path: 'test-results/notebook-print.pdf', preferCSSPageSize: true, printBackground: true })
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || [])).toHaveLength(6)
  await preview.locator('[data-print-page="page0"]').screenshot({ path: 'test-results/notebook-print-page.png' })
  await preview.locator('[data-print-page="cover"]').screenshot({ path: 'test-results/notebook-print-cover.png' })
  await page.emulateMedia({ media: 'screen' })
  await preview.getByRole('button', { name: '关闭预览' }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.locator('.nb-reader')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.nb-reader')).toBeVisible()
})
