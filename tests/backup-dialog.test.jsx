import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const api = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../src/lib/api', () => ({ apiFetch: api.fetch, journalBackupUrl: '/api/journal/backup' }))
import BackupDialog from '../src/journal/BackupDialog'
HTMLDialogElement.prototype.showModal = function () { this.open = true }
HTMLDialogElement.prototype.close = function () { this.open = false }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('starts a browser-managed ZIP download after checking the backup headers', async () => {
  api.fetch.mockResolvedValue(new Response(null, { headers: { 'X-Backup-Missing-Files': '2' } }))
  const destinations = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { destinations.push(this.getAttribute('href')) })
  render(<BackupDialog onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '导出备份文件' }))
  expect(await screen.findByRole('status')).toHaveTextContent('2 个')
  expect(destinations).toEqual(['/api/journal/backup'])
  expect(api.fetch).toHaveBeenCalledWith('/journal/backup', { method: 'HEAD' })
})

it('accepts a ZIP larger than 64MiB and reports the restored content', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.fetch.mockResolvedValue(new Response(JSON.stringify({ restored: { photos: 12 } })))
  const file = new File(['zip-placeholder'], 'large.zip', { type: 'application/zip' })
  Object.defineProperty(file, 'size', { value: 70 * 1024 * 1024 })
  const restore = vi.fn(async () => ({ restored: { photos: 12 } }))
  render(<BackupDialog onClose={() => {}} onRestore={restore} onRestored={async () => {}} />)
  fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [file] } })
  expect(await screen.findByRole('status')).toHaveTextContent('已还原 12 张照片')
  expect(restore).toHaveBeenCalledWith(file)
})
