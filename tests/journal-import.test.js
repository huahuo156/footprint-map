import { describe, it, expect, vi } from 'vitest'
import { importPhotoFiles } from '../src/journal/importPhotos'
import { readPhotoExif } from '../src/lib/exif'
vi.mock('../src/lib/exif', async importOriginal => ({ ...(await importOriginal()), readPhotoExif: vi.fn(async () => null) }))
vi.mock('../src/lib/api', () => ({ fetchLandmarks: async () => [{ id: 7, name: '西湖', lat: 30.25, lng: 120.15 }], saveJournalEntry: vi.fn() }))

const files = count => Array.from({ length: count }, (_, index) => new File(['photo'], `photo-${index}.png`, { type: 'image/png' }))
const positions = count => Array.from({ length: count }, (_, index) => ({ x: index * 300, y: -40 }))
const names = body => body.getAll('images').map(file => file.name)
const invalid = indices => Object.assign(new Error('invalid images'), { status: 400, code: 'INVALID_IMAGES', invalidFiles: indices.map(index => ({ index, reason: '无法识别图片格式' })) })

describe('bulk photo import recovery', () => {
  it('imports 500 photos with their individual EXIF without reading every file at once', async () => {
    let active = 0, peak = 0
    readPhotoExif.mockImplementation(async file => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active--
      return { date: file.name === 'photo-0.png' ? '2024-05-01' : '2024-05-02', lat: 30.25, lng: 120.15 }
    })
    const save = vi.fn(async () => ({}))
    try {
      const result = await importPhotoFiles(files(500), positions(500), vi.fn(), save)
      expect(result.importedCount).toBe(500)
      expect(peak).toBeLessThanOrEqual(20)
      expect(save.mock.calls).toHaveLength(25)
      const photos = save.mock.calls.flatMap(([, body]) => JSON.parse(body.get('data')).photos)
      expect(photos[0].components).toEqual([{ type: 'date', value: '2024-05-01' }, { type: 'place', value: { name: '西湖', landmark_id: 7, lat: 30.25, lng: 120.15, spot_key: '' } }])
      expect(photos[499].components[0].value).toBe('2024-05-02')
    } finally { readPhotoExif.mockReset().mockResolvedValue(null) }
  })
  it('skips rejected files across chunks and preserves the original layout for each valid file', async () => {
    const input = files(23), progress = vi.fn(), save = vi.fn()
      .mockRejectedValueOnce(invalid([1, 18]))
      .mockResolvedValue({})
    const result = await importPhotoFiles(input, positions(23), progress, save)
    expect(result.importedCount).toBe(21)
    expect(result.rejectedFiles.map(file => file.name)).toEqual(['photo-1.png', 'photo-18.png'])
    const successful = save.mock.calls.slice(1).flatMap(([, body]) => names(body))
    expect(successful).toHaveLength(21)
    expect(new Set(successful).size).toBe(21)
    expect(successful).not.toContain('photo-1.png')
    expect(successful).not.toContain('photo-18.png')
    for (const [, body] of save.mock.calls.slice(1)) {
      const layout = JSON.parse(body.get('data')).photos
      names(body).forEach((name, index) => {
        const original = input.findIndex(file => file.name === name)
        expect(layout[index]).toMatchObject({ upload_index: index, canvas_x: original * 300, canvas_y: -40 })
      })
    }
    expect(progress).toHaveBeenLastCalledWith({ completed: 23, total: 23 })
  })

  it('retains only unsaved valid files after an invalid chunk and a later service interruption', async () => {
    const input = files(24), save = vi.fn().mockRejectedValueOnce(invalid([1])).mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('服务中断'), { status: 503 })).mockResolvedValue({})
    let failure
    try { await importPhotoFiles(input, positions(24), vi.fn(), save) } catch (error) { failure = error }
    expect(failure).toMatchObject({ importedCount: 20, retryable: true, rejectedFiles: [{ name: 'photo-1.png' }] })
    expect(failure.remainingFiles.map(file => file.name)).toEqual(['photo-21.png', 'photo-22.png', 'photo-23.png'])
    const retried = await importPhotoFiles(failure.remainingFiles, positions(3), vi.fn(), save)
    expect(retried.importedCount).toBe(3)
    expect(names(save.mock.calls[3][1])).toEqual(['photo-21.png', 'photo-22.png', 'photo-23.png'])
  })

  it('finishes with an explicit rejection list when every file is invalid', async () => {
    const save = vi.fn().mockRejectedValueOnce(invalid([0, 1]))
    const result = await importPhotoFiles(files(2), positions(2), vi.fn(), save)
    expect(result.importedCount).toBe(0)
    expect(result.rejectedFiles).toHaveLength(2)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('skips unsupported, empty and oversized files individually, without blocking valid photos', async () => {
    const input = [new File(['heic'], 'original.heic', { type: 'image/heic' }), new File([], 'empty.png', { type: 'image/png' }), ...files(1)]
    const large = new File(['large'], 'large.jpg', { type: 'image/jpeg' })
    Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 })
    input.push(large)
    const save = vi.fn().mockResolvedValue({})
    const result = await importPhotoFiles(input, positions(4), vi.fn(), save)
    expect(result.importedCount).toBe(1)
    expect(result.rejectedFiles.map(file => file.name)).toEqual(['original.heic', 'empty.png', 'large.jpg'])
    expect(names(save.mock.calls[0][1])).toEqual(['photo-0.png'])
  })

  it('does not offer blind retries for a permanent request error', async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('内容无效'), { status: 400 }))
    await expect(importPhotoFiles(files(1), positions(1), vi.fn(), save)).rejects.toMatchObject({ importedCount: 0, retryable: false })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
