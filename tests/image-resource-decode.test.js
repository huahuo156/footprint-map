import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decodeMedia } from '../src/journal/images/decodeMedia.js'

let image, resolveDecode, rejectDecode
beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:temporary'), revokeObjectURL: vi.fn() })
  image = { src: '', naturalWidth: 512, naturalHeight: 256, decode: () => new Promise((resolve, reject) => { resolveDecode = resolve; rejectDecode = reject }) }
})
afterEach(() => vi.unstubAllGlobals())

it('decodes using a temporary URL and returns dimensions after releasing it', async () => {
  const blob = new Blob(['image'])
  const pending = decodeMedia(blob, { createImage: () => image })
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
  expect(image.src).toBe('blob:temporary')
  resolveDecode()
  expect(await pending).toEqual({ width: 512, height: 256 })
  expect(image.src).toBe('')
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:temporary')
})

it('cancels a hanging decode immediately and ignores its late success', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const pending = decodeMedia(new Blob(), { signal: controller.signal, createImage: () => image })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(image.src).toBe('')
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:temporary')
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  resolveDecode()
  await Promise.resolve()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})

it('checks cancellation after decode resolves before publishing dimensions', async () => {
  const controller = new AbortController()
  const pending = decodeMedia(new Blob(), { signal: controller.signal, createImage: () => image })
  resolveDecode()
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

it('allocates nothing for an already cancelled request', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(decodeMedia(new Blob(), { signal: controller.signal, createImage: () => image })).rejects.toMatchObject({ name: 'AbortError' })
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it.each([[0, 1], [1, 0], [-1, 1], [513, 1], [1, 513], [Infinity, 1], [1, NaN]])('rejects invalid thumbnail dimensions %s x %s', async (width, height) => {
  image.naturalWidth = width; image.naturalHeight = height
  const pending = decodeMedia(new Blob(), { createImage: () => image })
  resolveDecode()
  await expect(pending).rejects.toThrow()
  expect(image.src).toBe('')
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:temporary')
})

it('releases the URL after decode fails', async () => {
  const error = new Error('corrupt image')
  const pending = decodeMedia(new Blob(), { createImage: () => image })
  rejectDecode(error)
  await expect(pending).rejects.toBe(error)
  expect(image.src).toBe('')
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:temporary')
})

it('borrows a display URL for probing without allocating or revoking another URL', async () => {
  const pending = decodeMedia(new Blob(['image']), { createImage: () => image, objectUrl: 'blob:display-owned' })
  expect(image.src).toBe('blob:display-owned')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  resolveDecode()
  expect(await pending).toEqual({ width: 512, height: 256 })
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(image.src).toBe('')
})

it('clears a cancelled borrowed probe without revoking the display owner URL', async () => {
  const controller = new AbortController()
  const pending = decodeMedia(new Blob(['image']), { createImage: () => image, objectUrl: 'blob:display-owned', signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(image.src).toBe('')
})
