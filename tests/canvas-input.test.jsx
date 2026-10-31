import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import JourneyCanvas from '../src/journal/JourneyCanvas.jsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  localStorage.setItem('shitu-camera-v1', JSON.stringify({ x: 0, y: 0, scale: 1, detail: true }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

// jsdom has no native pointer capture. Keep event identity and capture ownership
// while exercising the real canvas handlers and DOM previews.
function capture(node) {
  const ids = new Set()
  node.setPointerCapture = id => ids.add(id)
  node.hasPointerCapture = id => ids.has(id)
  node.releasePointerCapture = id => ids.delete(id)
  return node
}
function pointer(node, type, id = 1, x = 100, y = 100, options = {}) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...options })
  Object.defineProperty(event, 'pointerId', { value: id })
  fireEvent(node, event)
}
function setup(kind = 'photo', scale = 1, detail = true) {
  localStorage.setItem('shitu-camera-v1', JSON.stringify({ x: 0, y: 0, scale, detail }))
  const data = { trips: [], entries: [{ id: 'e', entry_date: '2026-10-29', components: [], photos: [{ id: 'a', url: '/a.png', components: [], canvas_absolute: 1, canvas_x: 0, canvas_y: 0, rotation: 0 }] }], notebooks: [], canvas_groups: [] }
  if (kind === 'book') data.notebooks.push({ id: 'book', name: '示例', canvas_x: 700, canvas_y: 0 })
  if (kind === 'group') data.canvas_groups.push({ id: 'group', name: '示例组', photo_ids: ['a'] })
  const save = vi.fn(async () => {}), open = vi.fn()
  const rendered = render(<JourneyCanvas data={data} onMove={save} onMoveGroup={save} onMoveNotebook={save} onOpen={open} onNotebook={open} />)
  const canvas = capture(screen.getByRole('region'))
  const photo = capture(document.querySelector('[data-photo-id="a"]'))
  const target = kind === 'book' ? capture(screen.getByRole('button', { name: '打开手帐：示例' })) : kind === 'group' ? capture(screen.getByRole('button', { name: '移动分组：示例组' })) : photo
  return { ...rendered, data, canvas, photo, target, save, open }
}

it('ignores movement and release from a different pointer', () => {
  const { target, save, open } = setup()
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 2, 400, 400)
  expect(target.style.transform).toContain('translate3d(0px,0px,0)')
  pointer(target, 'pointerup', 2)
  expect(open).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  pointer(target, 'pointermove', 1, 200, 100)
  expect(target.style.transform).toContain('translate3d(100px,0px,0)')
  pointer(target, 'pointercancel')
})

it('does not replace a drag when another pointer lands on the canvas', () => {
  const { target, canvas } = setup()
  pointer(target, 'pointerdown')
  pointer(canvas, 'pointerdown', 2)
  pointer(target, 'pointermove', 1, 200, 100)
  expect(target.style.transform).toContain('translate3d(100px,0px,0)')
  pointer(target, 'pointercancel')
})

it.each(['photo', 'book', 'group'])('restores %s on blur without saving and permits a new drag', kind => {
  const { target, photo, canvas, save } = setup(kind)
  const preview = kind === 'group' ? photo : target
  const original = preview.style.transform
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 200, 100)
  expect(preview.style.transform).not.toBe(original)
  fireEvent.blur(window)
  expect(preview.style.transform).toBe(original)
  expect(canvas).not.toHaveClass('is-dragging')
  expect(target.hasPointerCapture(1)).toBe(false)
  pointer(target, 'pointerup')
  expect(save).not.toHaveBeenCalled()
  pointer(target, 'pointerdown', 3)
  pointer(target, 'pointermove', 3, 180, 100)
  expect(preview.style.transform).not.toBe(original)
  pointer(target, 'pointercancel', 3)
})

it.each(['pointercancel', 'lostpointercapture'])('restores a photo on %s only for its owning pointer', type => {
  const { target, save } = setup()
  const original = target.style.transform
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 200, 100)
  pointer(target, type, 2)
  expect(target.style.transform).not.toBe(original)
  pointer(target, type)
  expect(target.style.transform).toBe(original)
  pointer(target, 'pointerup')
  expect(save).not.toHaveBeenCalled()
})

it('releases capture on unmount without saving', () => {
  const { target, unmount, save } = setup()
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 200, 100)
  unmount()
  expect(target.hasPointerCapture(1)).toBe(false)
  expect(save).not.toHaveBeenCalled()
})

it.each([.08, .55, 1, 2.4])('commits one drag at scale %s after ignoring another pointer', async scale => {
  const { target, save } = setup('photo', scale)
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 124, 100)
  pointer(target, 'pointerup', 2)
  expect(save).not.toHaveBeenCalled()
  pointer(target, 'pointerup', 1, 124, 100)
  pointer(target, 'lostpointercapture')
  expect(save).toHaveBeenCalledExactlyOnceWith({ id: 'a', kind: 'photo', x: 24 / scale, y: 0, rotation: 0 })
})

it('cancels an additive marquee on blur and restores the previous selection', () => {
  const { canvas, photo, save } = setup()
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  fireEvent.click(photo)
  expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  pointer(canvas, 'pointerdown', 1, 100, 100, { shiftKey: true })
  pointer(canvas, 'pointermove', 1, 500, 500)
  expect(document.querySelector('.j-selection-rectangle')).not.toBeNull()
  fireEvent.blur(window)
  expect(document.querySelector('.j-selection-rectangle')).toBeNull()
  expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  expect(canvas.hasPointerCapture(1)).toBe(false)
  expect(save).not.toHaveBeenCalled()
})

it('rolls back a cancelled camera pan and ignores subsequent movement', () => {
  const { canvas, save } = setup()
  const world = document.querySelector('.j-world'), original = world.style.transform
  pointer(canvas, 'pointerdown')
  pointer(canvas, 'pointermove', 1, 200, 100)
  expect(world.style.transform).not.toBe(original)
  fireEvent.blur(window)
  expect(world.style.transform).toBe(original)
  pointer(canvas, 'pointermove', 1, 400, 400)
  expect(world.style.transform).toBe(original)
  expect(JSON.parse(localStorage.getItem('shitu-camera-v1'))).toMatchObject({ x: 0, y: 0 })
  expect(save).not.toHaveBeenCalled()
})

it.each(['outside', 'editable', 'textbox', 'composing', 'prevented'])('leaves selection alone when a shortcut belongs to %s', context => {
  const { canvas, data, rerender, save } = setup()
  const layout = { status: 'saved', barrierStatus: 'idle', undoLayout: vi.fn(), redoLayout: vi.fn() }
  rerender(<JourneyCanvas data={data} layout={layout} onMove={save} />)
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  let target = canvas
  if (context === 'outside') target = render(<button>其他区域</button>).getByText('其他区域')
  if (context === 'editable') {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.innerHTML = '<span>编辑文字</span>'
    canvas.append(editor)
    target = editor.firstChild
  }
  if (context === 'textbox') {
    target = document.createElement('div')
    target.setAttribute('role', 'textbox')
    canvas.append(target)
  }
  const select = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', ctrlKey: true, isComposing: context === 'composing' })
  if (context === 'prevented') select.preventDefault()
  fireEvent(target, select)
  expect(screen.getByText('已选 0 项')).toBeInTheDocument()
  if (context !== 'prevented') expect(select.defaultPrevented).toBe(false)
  const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', isComposing: context === 'composing' })
  if (context === 'prevented') escape.preventDefault()
  fireEvent(target, escape)
  expect(screen.getByRole('button', { name: '退出多选', exact: true })).toBeInTheDocument()
  for (const shiftKey of [false, true]) {
    const undo = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true, shiftKey, isComposing: context === 'composing' })
    if (context === 'prevented') undo.preventDefault()
    fireEvent(target, undo)
    if (context !== 'prevented') expect(undo.defaultPrevented).toBe(false)
  }
  expect(layout.undoLayout).not.toHaveBeenCalled(); expect(layout.redoLayout).not.toHaveBeenCalled()
})

it('handles canvas shortcuts after focus returns from another region', () => {
  const { canvas } = setup()
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  fireEvent.keyDown(canvas, { key: 'a', metaKey: true })
  expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  fireEvent.keyDown(canvas, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '多选内容', exact: true })).toBeInTheDocument()
})

it('clears held space when focus moves to an editor', () => {
  const { canvas, target } = setup()
  fireEvent.keyDown(canvas, { key: ' ', code: 'Space' })
  expect(canvas).toHaveClass('is-panning')
  const editor = render(<textarea aria-label="说明" />).getByRole('textbox')
  fireEvent.focusIn(editor)
  expect(canvas).not.toHaveClass('is-panning')
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 200, 100)
  expect(target.style.transform).toContain('translate3d(100px,0px,0)')
  pointer(target, 'pointercancel')
})

it('does not intercept shortcuts while a modal dialog is open', () => {
  const { canvas } = setup()
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  render(<dialog open aria-label="示例弹窗"><input /></dialog>)
  const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
  fireEvent(canvas, event)
  expect(event.defaultPrevented).toBe(false)
  expect(screen.getByText('已选 0 项')).toBeInTheDocument()
})

it.each([.08, .55, 1, 2.4])('selects through an offset viewport at scale %s in either direction', scale => {
  const { canvas } = setup('photo', scale)
  canvas.getBoundingClientRect = () => ({ left: 120, top: 80, width: 1000, height: 700 })
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const left = 620 - 20 * scale, right = 620 + 20 * scale
  for (const [start, finish] of [[left, right], [right, left]]) {
    pointer(canvas, 'pointerdown', 1, start, 430 - 20 * scale)
    pointer(canvas, 'pointermove', 1, finish, 430 + 20 * scale)
    pointer(canvas, 'pointerup', 1, finish, 430 + 20 * scale)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  }
})

it('keeps a marquee anchored in world space when a parent scrolls during selection', () => {
  const { canvas } = setup()
  let top = 80
  canvas.getBoundingClientRect = () => ({ left: 120, top, width: 1000, height: 700 })
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  pointer(canvas, 'pointerdown', 1, 600, 410)
  top = -20
  pointer(canvas, 'pointermove', 1, 640, 350)
  expect(document.querySelector('.j-selection-rectangle')).toHaveStyle({ left: '480px', top: '330px', width: '40px', height: '40px' })
  expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  pointer(canvas, 'pointerup', 1, 640, 350)
})

it.each(['photo', 'book', 'group'].flatMap(kind => [.08, .55, 1, 2.4].map(scale => [kind, scale])))('keeps an active %s drag under the pointer when its viewport scrolls at scale %s', (kind, scale) => {
  const { canvas, target, photo, save } = setup(kind, scale)
  let left = 120, top = 80
  canvas.getBoundingClientRect = () => ({ left, top, width: 1000, height: 700 })
  const preview = kind === 'group' ? photo : target
  const original = preview.style.transform
  pointer(target, 'pointerdown', 1, 620, 430)
  pointer(target, 'pointermove', 1, 650, 450)
  // Parent scroll shifts the viewport 20px left and 100px up, with the
  // pointer held still. The world displacement is therefore (50, 120)/scale.
  left = 100; top = -20
  pointer(target, 'pointermove', 1, 650, 450)
  const values = preview.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\)/)
  expect(Number(values[1])).toBeCloseTo((kind === 'book' ? 700 : 0) + 50 / scale)
  expect(Number(values[2])).toBeCloseTo(120 / scale)
  pointer(target, 'pointercancel', 1, 650, 450)
  expect(preview.style.transform).toBe(original)
  pointer(target, 'pointerup', 1, 650, 450)
  expect(save).not.toHaveBeenCalled()
})

it('keeps panned content under the pointer when the viewport scrolls during panning', () => {
  const { canvas } = setup()
  let top = 80
  canvas.getBoundingClientRect = () => ({ left: 120, top, width: 1000, height: 700 })
  Object.defineProperties(canvas, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
  pointer(canvas, 'pointerdown', 1, 620, 430)
  pointer(canvas, 'pointermove', 1, 650, 450)
  top = -20
  pointer(canvas, 'pointermove', 1, 650, 450)
  expect(document.querySelector('.j-world').style.transform).toBe('translate3d(530px,470px,0) scale(1)')
  pointer(canvas, 'pointercancel', 1, 650, 450)
  expect(document.querySelector('.j-world').style.transform).toBe('translate3d(500px,350px,0) scale(1)')
})

it.each(['photo', 'book', 'group'])('saves the corrected %s position once after a parent scroll', async kind => {
  const { canvas, target, save } = setup(kind)
  let top = 80
  canvas.getBoundingClientRect = () => ({ left: 120, top, width: 1000, height: 700 })
  pointer(target, 'pointerdown', 1, 620, 430)
  pointer(target, 'pointermove', 1, 650, 450)
  top = -20
  pointer(target, 'pointermove', 1, 650, 450)
  pointer(target, 'pointerup', 1, 650, 450)
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  if (kind === 'book') expect(save).toHaveBeenCalledWith('book', { canvas_x: 730, canvas_y: 120 })
  else {
    const value = save.mock.calls[0][0]
    expect(kind === 'group' ? value[0] : value).toMatchObject({ id: 'a', kind: 'photo', x: 30, y: 120 })
  }
})

it('does not turn a click into a drag solely because the parent scrolled', () => {
  const { canvas, target, save, open } = setup()
  let top = 80
  canvas.getBoundingClientRect = () => ({ left: 120, top, width: 1000, height: 700 })
  const original = target.style.transform
  pointer(target, 'pointerdown', 1, 620, 430)
  top = -20
  pointer(target, 'pointermove', 1, 623, 432)
  pointer(target, 'pointerup', 1, 623, 432)
  expect(target.style.transform).toBe(original)
  expect(save).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)
})

it('uses the new viewport center when the canvas resizes during a drag', () => {
  const { canvas, target } = setup()
  let width = 1000, height = 700
  canvas.getBoundingClientRect = () => ({ left: 120, top: 80, width, height })
  pointer(target, 'pointerdown', 1, 620, 430)
  pointer(target, 'pointermove', 1, 650, 450)
  width = 800; height = 600
  pointer(target, 'pointermove', 1, 650, 450)
  expect(target.style.transform).toContain('translate3d(130px,70px,0)')
  pointer(target, 'pointercancel', 1, 650, 450)
})

it.each([0, 1, 2])('uses the offset viewport for wheel mode %s while keeping the pointed world location fixed', deltaMode => {
  const { canvas } = setup('photo', .55)
  canvas.style.lineHeight = '20px'
  canvas.getBoundingClientRect = () => ({ left: 120, top: 80, width: 1000, height: 700 })
  Object.defineProperties(canvas, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
  const unit = deltaMode === 1 ? 20 : deltaMode === 2 ? 700 : 1
  fireEvent.wheel(canvas, { clientX: 820, clientY: 530, deltaY: -Math.log(2) / .0012 / unit, deltaMode })
  const transform = document.querySelector('.j-world').style.transform
  const values = transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\) scale\(([-\d.]+)\)/)
  expect(values).not.toBeNull()
  expect(Number(values[1])).toBeCloseTo(300)
  expect(Number(values[2])).toBeCloseTo(250)
  expect(Number(values[3])).toBeCloseTo(1.1)
})

it.each([[0, -20], [1, -1], [2, -.02]])('normalizes wheel delta mode %s before zooming', (deltaMode, deltaY) => {
  const { canvas } = setup()
  canvas.style.lineHeight = '20px'
  canvas.getBoundingClientRect = () => ({ left: 120, top: 80, width: 1000, height: 1000 })
  Object.defineProperties(canvas, { clientWidth: { value: 1000 }, clientHeight: { value: 1000 } })
  fireEvent.wheel(canvas, { clientX: 620, clientY: 580, deltaY, deltaMode })
  const value = document.querySelector('.j-world').style.transform.match(/scale\(([-\d.]+)\)/)
  // 20 pixels, one 20px line and .02 of a 1000px page are equivalent.
  expect(Number(value[1])).toBeCloseTo(Math.exp(20 * .0012), 8)
})

it('uses a stable pixel fallback when computed line height is normal', () => {
  const { canvas } = setup()
  canvas.style.lineHeight = 'normal'
  fireEvent.wheel(canvas, { deltaMode: 1, deltaY: -1 })
  const value = document.querySelector('.j-world').style.transform.match(/scale\(([-\d.]+)\)/)
  expect(Number(value[1])).toBeCloseTo(Math.exp(16 * .0012), 8)
})

it.each(['photo', 'book', 'group'])('keeps %s still for motion below the click threshold', kind => {
  const { target, photo, save, open } = setup(kind, .08)
  const preview = kind === 'group' ? photo : target, original = preview.style.transform
  pointer(target, 'pointerdown')
  // Exactly 5 client pixels is still a click, even at the smallest zoom.
  pointer(target, 'pointermove', 1, 103, 102)
  expect(preview.style.transform).toBe(original)
  pointer(target, 'pointerup', 1, 103, 102)
  expect(preview.style.transform).toBe(original)
  expect(save).not.toHaveBeenCalled()
  if (kind !== 'group') expect(open).toHaveBeenCalledTimes(1)
})

it('does not pan for a click with minor pointer jitter', () => {
  const { canvas } = setup()
  const world = document.querySelector('.j-world'), original = world.style.transform
  pointer(canvas, 'pointerdown')
  pointer(canvas, 'pointermove', 1, 103, 102)
  expect(world.style.transform).toBe(original)
  pointer(canvas, 'pointerup', 1, 103, 102)
  expect(JSON.parse(localStorage.getItem('shitu-camera-v1'))).toMatchObject({ x: 0, y: 0 })
})

it.each(['photo', 'book', 'group', 'pan', 'marquee'])('ignores zoom while a %s gesture owns the pointer', kind => {
  const { target, canvas } = setup(kind)
  if (kind === 'marquee') fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const gesture = ['pan', 'marquee'].includes(kind) ? canvas : target
  pointer(gesture, 'pointerdown')
  pointer(gesture, 'pointermove', 1, 120, 100)
  const world = document.querySelector('.j-world'), original = world.style.transform
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 200, clientY: 100 })
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(world.style.transform).toBe(original)
  pointer(gesture, 'pointercancel')
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(screen.getByText('120%')).toBeInTheDocument()
})

it.each(['photo', 'book', 'group', 'pan', 'marquee'])('ignores overview navigation while a %s gesture owns the pointer', kind => {
  const { target, canvas, save } = setup(kind)
  if (kind === 'marquee') fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const gesture = ['pan', 'marquee'].includes(kind) ? canvas : target
  pointer(gesture, 'pointerdown'); pointer(gesture, 'pointermove', 1, 120, 100)
  const world = document.querySelector('.j-world'), original = world.style.transform
  fireEvent.click(screen.getByRole('button', { name: '查看全部旅程' }))
  expect(world.style.transform).toBe(original)
  pointer(gesture, 'pointercancel')
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看全部旅程' }))
  expect(screen.getByText('8%')).toBeInTheDocument()
})

it('ignores trip navigation during a pan and restores it after cancellation', () => {
  const { canvas, data, rerender, save } = setup('photo', .55, false)
  data.trips = [{ id: 'trip', name: '示例旅程', canvas_x: 500, canvas_y: 0 }]
  data.entries[0].trip_id = 'trip'; data.entries[0].photos[0].canvas_absolute = 0
  rerender(<JourneyCanvas data={structuredClone(data)} onMove={save} />)
  const trip = screen.getByRole('button', { name: /展开示例旅程/ })
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', 1, 120, 100)
  const world = document.querySelector('.j-world'), original = world.style.transform
  fireEvent.click(trip)
  expect(world.style.transform).toBe(original)
  pointer(canvas, 'pointercancel')
  const restored = world.style.transform
  fireEvent.click(trip)
  expect(world.style.transform).not.toBe(restored)
  expect(save).not.toHaveBeenCalled()
})

it('continues a real drag when the pointer returns inside the threshold', () => {
  const { target, save, open } = setup()
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 120, 100)
  pointer(target, 'pointermove', 1, 102, 100)
  expect(target.style.transform).toContain('translate3d(2px,0px,0)')
  pointer(target, 'pointerup', 1, 102, 100)
  expect(open).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledExactlyOnceWith({ id: 'a', kind: 'photo', x: 2, y: 0, rotation: 0 })
})

it.each(['photo', 'book', 'group', 'pan', 'marquee'])('cancels a %s gesture with Escape without saving or opening content', kind => {
  const { target, photo, canvas, save, open } = setup(kind)
  if (kind === 'marquee') fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const gesture = ['pan', 'marquee'].includes(kind) ? canvas : target
  const preview = kind === 'group' ? photo : kind === 'pan' ? document.querySelector('.j-world') : target
  const original = preview.style.transform
  pointer(gesture, 'pointerdown')
  pointer(gesture, 'pointermove', 1, 200, 100)
  fireEvent.keyDown(canvas, { key: 'Escape' })
  expect(preview.style.transform).toBe(original)
  expect(document.querySelector('.j-selection-rectangle')).toBeNull()
  expect(gesture.hasPointerCapture(1)).toBe(false)
  expect(canvas).not.toHaveClass('is-dragging')
  pointer(gesture, 'pointermove', 1, 400, 100)
  pointer(gesture, 'pointerup', 1, 400, 100)
  expect(save).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  expect(screen.getByText('120%')).toBeInTheDocument()
})

it.each(['退出多选', '结束多选'])('cancels the active marquee when pressing %s', name => {
  const { canvas, save } = setup()
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  pointer(canvas, 'pointerdown')
  pointer(canvas, 'pointermove', 1, 200, 100)
  fireEvent.click(screen.getByRole('button', { name, exact: true }))
  expect(document.querySelector('.j-selection-rectangle')).toBeNull()
  expect(canvas.hasPointerCapture(1)).toBe(false)
  pointer(canvas, 'pointerup')
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  expect(screen.getByText('已选 0 项')).toBeInTheDocument()
})

it('clears space panning on Escape even before the space key is released', () => {
  const { canvas } = setup()
  fireEvent.keyDown(canvas, { code: 'Space', key: ' ' })
  fireEvent.keyDown(canvas, { key: 'Escape' })
  expect(canvas).not.toHaveClass('is-panning')
})

it.each(['photo', 'book', 'group'])('cancels a %s drag when a notebook opens', kind => {
  const { target, photo, canvas, data, rerender, save, open } = setup(kind)
  const preview = kind === 'group' ? photo : target, original = preview.style.transform
  pointer(target, 'pointerdown')
  pointer(target, 'pointermove', 1, 200, 100)
  rerender(<JourneyCanvas data={data} notebookOpen onMove={save} onMoveGroup={save} onMoveNotebook={save} onOpen={open} onNotebook={open} />)
  expect(preview.style.transform).toBe(original)
  expect(target.hasPointerCapture(1)).toBe(false)
  pointer(target, 'pointerup')
  expect(save).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  pointer(target, 'pointerdown', 2)
  pointer(target, 'pointermove', 2, 300, 100)
  expect(target.hasPointerCapture(2)).toBe(false)
  expect(preview.style.transform).toBe(original)
  fireEvent.wheel(canvas, { deltaY: -100 })
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
  fireEvent.click(screen.getByRole('button', { name: '查看全部旅程' }))
  expect(screen.getByText('100%')).toBeInTheDocument()
  fireEvent.keyDown(canvas, { code: 'Space', key: ' ' })
  expect(canvas).not.toHaveClass('is-panning')
})
it.each([false, true])('limits undo shortcuts to the personal canvas (demo=%s)', demo => {
  const { data, canvas, rerender, save } = setup()
  const layout = { status: 'saved', barrierStatus: 'idle', undoLayout: vi.fn(), redoLayout: vi.fn() }
  rerender(<JourneyCanvas data={data} demo={demo} layout={layout} onMove={save} />)
  fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
  expect(layout.undoLayout).toHaveBeenCalledTimes(demo ? 0 : 1)
})
it('cancels the current gesture before undoing a previous command', () => {
  const { data, canvas, target, rerender, save } = setup()
  const layout = { status: 'saved', barrierStatus: 'idle', undoLayout: vi.fn(), redoLayout: vi.fn() }
  rerender(<JourneyCanvas data={data} layout={layout} onMove={save} />)
  const original = target.style.transform
  pointer(target, 'pointerdown'); pointer(target, 'pointermove', 1, 200, 100)
  fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
  expect(target.style.transform).toBe(original)
  pointer(target, 'pointerup'); expect(save).not.toHaveBeenCalled()
})

it.each(['photo', 'book', 'group', 'pan', 'marquee'].flatMap(kind => [false, true].map(inside => [kind, inside])))('cancels an active %s gesture when focus enters an editor (inside canvas: %s)', (kind, inside) => {
  const { target, canvas, photo, save, open } = setup(kind)
  if (kind === 'marquee') fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const node = kind === 'pan' || kind === 'marquee' ? canvas : target
  const preview = kind === 'group' ? photo : kind === 'pan' ? document.querySelector('.j-world') : node
  const original = preview.style.transform
  pointer(node, 'pointerdown'); pointer(node, 'pointermove', 1, 200, 100)
  const editor = document.createElement('textarea')
  ;(inside ? canvas.parentElement : document.body).append(editor)
  fireEvent.focusIn(editor)
  expect(preview.style.transform).toBe(original)
  expect(node.hasPointerCapture(1)).toBe(false)
  expect(canvas).not.toHaveClass('is-dragging')
  expect(document.querySelector('.j-selection-rectangle')).toBeNull()
  pointer(node, 'pointermove', 1, 300, 100); pointer(node, 'pointerup')
  expect(save).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  editor.remove()
})

it('preserves an active gesture when focus moves within the non-editable canvas', () => {
  const { canvas, target, save } = setup()
  pointer(target, 'pointerdown'); pointer(target, 'pointermove', 1, 200, 100)
  fireEvent.focusIn(canvas)
  expect(target.hasPointerCapture(1)).toBe(true)
  pointer(target, 'pointermove', 1, 250, 100); pointer(target, 'pointerup')
  expect(save).toHaveBeenCalledExactlyOnceWith({ id: 'a', kind: 'photo', x: 150, y: 0, rotation: 0 })
})

it('cancels a gesture when focus moves to a non-editor outside the canvas', () => {
  const { target, save } = setup()
  const original = target.style.transform
  pointer(target, 'pointerdown'); pointer(target, 'pointermove', 1, 200, 100)
  const outside = render(<button>外部操作</button>).getByRole('button', { name: '外部操作' })
  fireEvent.focusIn(outside)
  expect(target.style.transform).toBe(original)
  expect(target.hasPointerCapture(1)).toBe(false)
  pointer(target, 'pointerup'); expect(save).not.toHaveBeenCalled()
})
