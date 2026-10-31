import { afterEach, expect, it, vi } from 'vitest'
import { createCanvasFixture, imageDimensions, imagePixels } from './fixtures/canvas-images.js'
import { parsePerformanceOptions, performanceCases, percentile, summarizeSamples, summarizeCases, installCanvasReadinessProbe } from '../scripts/lib/canvas-performance.mjs'
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
it('records first operability independently of the document load event', async () => {
  document.body.innerHTML = '<div class="j-layout-status"><span role="status">正在准备布局</span></div><div class="j-canvas-controls"><button aria-pressed="false">多选内容</button></div><div class="j-canvas"></div>'
  const stop = installCanvasReadinessProbe()
  expect(window.canvasPerfReadyMs).toBeNull()
  vi.spyOn(performance, 'now').mockReturnValue(17.5)
  document.querySelector('[role="status"]').textContent = '已保存'
  await vi.waitFor(() => expect(window.canvasPerfReadyMs).toBe(17.5))
  vi.mocked(performance.now).mockReturnValue(100)
  document.body.append(document.createElement('img'))
  await Promise.resolve(); expect(window.canvasPerfReadyMs).toBe(17.5)
  stop()
})
it.each([100, 500, 2000])('creates %s distinct images with valid stable geometry and nested/folded groups', count => {
  const a = createCanvasFixture(count), b = createCanvasFixture(count)
  const photos = a.entries.flatMap(entry => entry.photos)
  expect(a).toEqual(b); expect(photos).toHaveLength(count)
  expect(new Set(photos.map(photo => photo.url)).size).toBe(count)
  expect(new Set(photos.map(photo => photo.id)).size).toBe(count)
  expect(photos.every(photo => photo.canvas_absolute === 1 && Number.isFinite(photo.canvas_x) && photo.layout_version === '0')).toBe(true)
  expect(a.canvas_groups.some(group => group.parent_id)).toBe(true)
  expect(a.canvas_groups.some(group => group.collapsed)).toBe(true)
  expect(a.entries.some(entry => !entry.photos.length)).toBe(true)
})
it('uses different deterministic pixel content and portrait/landscape geometry', () => {
  expect(imageDimensions(0)).not.toEqual(imageDimensions(1))
  expect(imagePixels(0)).toEqual(imagePixels(0))
  expect(imagePixels(0).equals(imagePixels(1))).toBe(false)
})
it('rejects unsafe or excessively large fixtures', () => {
  for (const count of [0, -1, 3, 2001, 1.5, Infinity]) expect(() => createCanvasFixture(count)).toThrow()
})
it('does not assign the same photo directly to two groups in the smallest supported smoke fixture', () => {
  const ids = createCanvasFixture(8).canvas_groups.flatMap(group => group.photo_ids)
  expect(new Set(ids).size).toBe(ids.length)
})
it('uses nearest-rank percentiles without converting missing data to zero', () => {
  expect(percentile([10, 50, 20, 40, 30], .95)).toBe(50)
  expect(percentile([], .95)).toBeNull()
  expect(summarizeSamples([10, null, 30, undefined, 20])).toEqual({ samples: 3, median: 20, worst: 30 })
})
it('keeps unavailable browser heap measurements missing in case summaries', () => {
  const summary = summarizeCases([{ count: 100, profile: 'desktop', theme: 'light', phases: [{ name: 'overview', frames: [], dom: { images: 1 }, metrics: {} }], network: { requests: 0, uniqueUrls: 0 }, memory: [] }])[0]
  expect(summary.maxJsHeapBytes).toEqual({ samples: 0, median: null, worst: null })
})
it('does not mix long-stress traffic and memory into short-run comparisons', () => {
  const summary = summarizeCases([{ count: 100, profile: 'desktop', theme: 'light', phases: [{ name: 'overview', frames: [], dom: { images: 1 }, metrics: { JSHeapUsedSize: 50 } }, { name: 'stress', frames: [], dom: {}, metrics: { JSHeapUsedSize: 500 } }], shortNetwork: { requests: 10, uniqueUrls: 8 }, network: { requests: 1000, uniqueUrls: 90 }, memory: [{ phase: 'cold', workingSetBytes: 100 }, { phase: 'stress', workingSetBytes: 1000 }] }])[0]
  expect(summary.mediaRequests.worst).toBe(10)
  expect(summary.repeatedMediaRequests.worst).toBe(2)
  expect(summary.maxBrowserWorkingSetBytes.worst).toBe(100)
  expect(summary.maxJsHeapBytes.worst).toBe(50)
})
it('builds the full 60-case matrix with five independent runs', () => {
  const options = parsePerformanceOptions(['--baseline'])
  expect(performanceCases(options)).toHaveLength(60)
  expect(options.stressMs).toBe(600000)
})
it('accepts bounded smoke overrides and rejects misleading/invalid options', () => {
  const options = parsePerformanceOptions(['--baseline', '--counts=100', '--runs=1', '--profiles=desktop', '--themes=light', '--stress-ms=0'])
  expect(performanceCases(options)).toEqual([{ count: 100, profile: 'desktop', theme: 'light', run: 1 }])
  for (const args of [['--runs=0'], ['--runs=100'], ['--counts=999999'], ['--profiles=phone'], ['--themes=blue'], ['--compare'], ['--unknown']]) expect(() => parsePerformanceOptions(args)).toThrow()
})
