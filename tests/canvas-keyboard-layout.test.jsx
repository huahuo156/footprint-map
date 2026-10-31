import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import JourneyCanvas from '../src/journal/JourneyCanvas.jsx'
import { buildCanvas } from '../src/journal/model.js'
import { layoutPosition } from '../src/journal/canvas/selectionLayout.js'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem('shitu-camera-v1', JSON.stringify({ x: 0, y: 0, scale: .55, detail: true }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
function setup(overrides = {}) {
  const data = overrides.data || { trips: [], marks: [], notebooks: [], canvas_groups: [], entries: [{ id: 'record', entry_date: '2026-10-31', components: [], photos: [{ id: 'a', url: '/a.jpg', components: [], canvas_absolute: 1, canvas_x: 0, canvas_y: 0, rotation: 0 }] }] }
  let snapshot = { status: 'saved', barrierStatus: 'idle', conflict: false, hasUnconfirmed: false, items: buildCanvas(data, {}, false).items.map(item => layoutPosition(item)) }
  const move = vi.fn(items => { snapshot = { ...snapshot, status: 'unsaved', hasUnconfirmed: true, items } }), error = vi.fn()
  const layout = { ...snapshot, getSnapshot: () => snapshot, undoLayout: vi.fn(), redoLayout: vi.fn() }
  const props = { data, layout, onMoveGroup: move, onError: error, ...overrides }
  const rendered = render(<JourneyCanvas {...props} />)
  const canvas = screen.getByRole('region')
  Object.defineProperties(canvas, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true })
  return { ...rendered, props, data, canvas, move, error, layout, setSnapshot: next => { snapshot = { ...snapshot, ...next } } }
}
const press = (node, options) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })
  fireEvent(node, event); return event
}
it.each([['ArrowRight', 1, 0], ['ArrowLeft', -1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]].flatMap(([key, x, y]) => [false, true].map(shiftKey => [key, x, y, shiftKey])))('nudges %s (shift %s) exactly once', (key, x, y, shiftKey) => {
  const { canvas, move } = setup()
  expect(press(canvas, { key, shiftKey }).defaultPrevented).toBe(true)
  const factor = shiftKey ? 10 : 1
  expect(move).toHaveBeenCalledExactlyOnceWith([{ id: 'a', kind: 'photo', x: x * factor, y: y * factor, rotation: 0 }])
})
it('blocks a second same-render keypress using the immediate snapshot', () => {
  const { canvas, move } = setup()
  press(canvas, { key: 'ArrowRight' }); press(canvas, { key: 'ArrowRight' })
  expect(move).toHaveBeenCalledTimes(1)
})
it.each(['saving', 'failed', 'unsaved', 'inactive'])('does not nudge while immediate status is %s', status => {
  const { canvas, move, setSnapshot } = setup(); setSnapshot({ status })
  expect(press(canvas, { key: 'ArrowRight' }).defaultPrevented).toBe(true)
  expect(move).not.toHaveBeenCalled()
})
it.each([{ conflict: true }, { barrierStatus: 'running' }, { hasUnconfirmed: true }])('rejects blocked state %j', state => {
  const { canvas, move, setSnapshot } = setup(); setSnapshot(state)
  press(canvas, { key: 'ArrowRight' }); expect(move).not.toHaveBeenCalled()
})
it.each([{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])('does not edit with key flags %j', flags => {
  const { canvas, move } = setup()
  press(canvas, { key: 'ArrowRight', ...flags }); expect(move).not.toHaveBeenCalled()
})
it('rejects a stale model instead of overwriting newer positions', () => {
  const { canvas, move, setSnapshot } = setup()
  setSnapshot({ items: [{ id: 'a', kind: 'photo', x: 20, y: 0, rotation: 0 }] })
  press(canvas, { key: 'ArrowRight' }); expect(move).not.toHaveBeenCalled()
})
it('ignores keys when selection is empty and keeps editor and dialog isolation', () => {
  const { canvas, move } = setup()
  const editor = document.createElement('textarea'); canvas.append(editor)
  expect(press(editor, { key: 'ArrowRight' }).defaultPrevented).toBe(false)
  const dialog = render(<dialog open />)
  expect(press(canvas, { key: 'ArrowRight' }).defaultPrevented).toBe(false)
  dialog.unmount(); editor.remove()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  expect(press(canvas, { key: 'ArrowRight' }).defaultPrevented).toBe(false)
  expect(press(canvas, { key: 'f' }).defaultPrevented).toBe(false)
  expect(move).not.toHaveBeenCalled()
})
it.each(['key', 'button'])('frames selection through %s without layout writes and returns canvas focus', method => {
  const { canvas, move, setSnapshot } = setup()
  setSnapshot({ status: 'failed', hasUnconfirmed: true })
  if (method === 'key') press(canvas, { key: 'f' })
  else fireEvent.click(screen.getByRole('button', { name: '定位选中', exact: true }))
  expect(screen.getByText('100%')).toBeInTheDocument()
  expect(canvas).toHaveFocus(); expect(move).not.toHaveBeenCalled()
  expect(screen.getByText('已选 1 项')).toBeInTheDocument()
})
it('rejects collision atomically rather than jumping to a free position', () => {
  const { canvas, move, error, data, rerender, props } = setup()
  // Select only the first photo, then add an unselected reserved-size neighbor.
  const next = structuredClone(data)
  next.entries[0].photos.push({ ...next.entries[0].photos[0], id: 'b', canvas_x: 298 })
  rerender(<JourneyCanvas {...props} data={next} />)
  press(canvas, { key: 'ArrowRight' })
  expect(move).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith('当前位置受其他内容阻挡')
})
it('converts relative-photo visual origins into absolute layout positions', () => {
  const data = { trips: [{ id: 'trip', name: 'trip', canvas_x: 500, canvas_y: 0 }], marks: [], notebooks: [], canvas_groups: [], entries: [{ id: 'record', trip_id: 'trip', entry_date: '2026-10-31', components: [], photos: [{ id: 'a', url: '/a.jpg', components: [], canvas_absolute: 0, canvas_x: 10, canvas_y: 0, rotation: 0 }] }] }
  const { canvas, move } = setup({ data })
  press(canvas, { key: 'ArrowRight' })
  expect(move.mock.calls[0][0][0]).toMatchObject({ id: 'a', kind: 'photo', x: 511 })
})
it('does not move or frame during a pointer gesture', () => {
  const { canvas, move } = setup()
  let captured = false
  canvas.setPointerCapture = () => { captured = true }
  canvas.hasPointerCapture = () => captured
  canvas.releasePointerCapture = () => { captured = false }
  const down = new MouseEvent('pointerdown', { bubbles: true, button: 1, clientX: 100, clientY: 100 })
  Object.defineProperty(down, 'pointerId', { value: 1 }); fireEvent(canvas, down)
  const before = document.querySelector('.j-world').style.transform
  press(canvas, { key: 'ArrowRight' }); press(canvas, { key: 'f' })
  expect(move).not.toHaveBeenCalled(); expect(document.querySelector('.j-world').style.transform).toBe(before)
})
it.each([{ notebookOpen: true }, { demo: true }])('does not move or frame when canvas is unavailable: %j', flags => {
  const { canvas, move, props, rerender } = setup()
  rerender(<JourneyCanvas {...props} {...flags} />)
  press(canvas, { key: 'ArrowRight' }); press(canvas, { key: 'f' })
  expect(move).not.toHaveBeenCalled()
})
it('does not consume an already handled arrow key', () => {
  const { canvas, move } = setup()
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })
  event.preventDefault(); fireEvent(canvas, event); expect(move).not.toHaveBeenCalled()
})
it.each(['entry', 'mark'])('preserves API coordinate conventions for %s', kind => {
  const entry = kind === 'entry'
    ? { id: 'rendered', record_id: 'canonical', trip_id: 'trip', entry_date: '2026-10-31', photos: [], canvas_x: 10, canvas_y: 20, rotation: 0 }
    : { id: 'wrapper', mark: { id: 'a', kind: 'text', text: 'fixture', size: 'medium', canvas_x: 40, canvas_y: 50, rotation: 0 } }
  const data = { trips: [{ id: 'trip', name: 'trip', canvas_x: 500, canvas_y: 0 }], notebooks: [], canvas_groups: [], entries: [entry] }
  const { canvas, move } = setup({ data })
  press(canvas, { key: 'ArrowRight' })
  expect(move.mock.calls[0][0][0]).toMatchObject({ kind, id: kind === 'entry' ? 'canonical' : 'a', x: kind === 'entry' ? 11 : 41, y: kind === 'entry' ? 20 : 50 })
})
