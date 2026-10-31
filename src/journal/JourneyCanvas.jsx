import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Expand, Map as MapIcon, Minus, Plus, StickyNote, SquareDashedMousePointer, Trash2, X } from 'lucide-react'
import CanvasItem from './CanvasItem'
import NotebookCover from './NotebookCover'
import { planGroupExpansion, reserveUndecodedPhotos } from './groupExpansion'
import JournalImage from './JournalImage'
import CanvasOverviewMembers from './images/CanvasOverviewMembers.jsx'
import ImageResourcePrefetch from './images/ImageResourcePrefetch.jsx'
import CanvasGroupEditor from './CanvasGroupEditor'
import { buildCanvas, cardBounds, layoutCanvasGroups, imageFilter, intersects, isWestLake, itemsInRectangle, CANVAS_GROUP_METRICS } from './model'
import { screenToWorld, worldToScreen, viewportPoint, zoomAt } from './canvas/camera.js'
import { canvasHeaders, collisionItems, placeCanvasItem, planCanvasGroupMove } from './canvasCollision'
import { expandGroupSelection, toggleGroupSelection } from '../../shared/journal-groups.js'
import { useCanvasImageDimensions } from './images/useCanvasImageDimensions.js'
import { planImageResidency } from './images/canvasImageResidency.js'
import { layoutPosition, planSelectionMove, selectionCamera } from './canvas/selectionLayout.js'

const transformCard = item => `translate3d(${item.x}px,${item.y}px,0) translate(-50%,-50%) rotate(${item.rotation || 0}deg)`
export default function JourneyCanvas({ userId, data, onOpen, onScene, onMove, onMoveGroup, onSaveGroup, onDeleteGroup, onError, onViewPosition, onBatchEdit, onBatchDelete, onNotebook, onMoveNotebook, onDropItem, notebookOpen = false, demo, overviewRequest = 0, layout, imageResidency = false, imageCache = false, imageProfile = 'desktop' }) {
  const [groupEditor, setGroupEditor] = useState(null)
  const [overviewMembers, setOverviewMembers] = useState(null)
  const imageSources = useMemo(() => data.entries.flatMap(entry => (entry.photos || []).map(photo => photo.url)), [data.entries])
  const { imageSizes, recordDimensions } = useCanvasImageDimensions({ ownerId: userId, sources: imageSources })
  const model = useMemo(() => buildCanvas(data, imageSizes, false), [data, imageSizes])
  const photoNodes = useRef(new Map())
  const canvasGroups = layoutCanvasGroups(data.canvas_groups || [], model.items)
  const reservedItems = collisionItems(model.items)
  const collisionScene = { items: reservedItems, groups: layoutCanvasGroups(data.canvas_groups || [], reservedItems), notebooks: data.notebooks || [], headers: canvasHeaders(model) }
  const displayGroups = canvasGroups.filter(group => !group.hidden)
  const hiddenPhotoIds = new Set(canvasGroups.filter(group => group.collapsed).flatMap(group => group.photo_ids))
  const displayItems = model.items.filter(item => !hiddenPhotoIds.has(item.id))
  const groupNodes = useRef(new Map())
  const viewport = useRef(null), world = useRef(null), camera = useRef({ x: 0, y: 0, scale: .55, detail: false }), drag = useRef(null), initialized = useRef(false)
  const [view, setView] = useState(camera.current), [size, setSize] = useState({ width: 1000, height: 700 }), [localSaving, setSaving] = useState(false)
  const saving = localSaving || !!layout && (layout.status === 'saving' || layout.status === 'loading' || layout.barrierStatus !== 'idle')
  const saveTimer = useRef(null), frame = useRef(null), lastSync = useRef(0), settleTimer = useRef(null)
  const handledOverview = useRef(0)
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState(new Set()), [marquee, setMarquee] = useState(null)
  const [focusedPhoto, setFocusedPhoto] = useState(null)
  const previousResidency = useRef([])
  const space = useRef(false)
  const cancelInput = useRef(null)
  useLayoutEffect(() => { cancelInput.current = cancelDrag })
  useEffect(() => {
    const cancel = () => cancelInput.current?.()
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancelInput.current?.(false) }
  }, [])
  useEffect(() => { if (notebookOpen) exitSelection() }, [notebookOpen])
  const selectedItems = model.items.filter(item => selected.has(item.id)), selectedPhotos = selectedItems.filter(item => item.kind === 'photo')
  function toggleItem(id) { setSelected(previous => toggleGroupSelection(previous, id, canvasGroups)) }
  function selectAll() { setSelected(expandGroupSelection(model.items.map(item => item.id), canvasGroups)) }
  function nudgeSelection(delta) {
    if (drag.current || notebookOpen || demo || saving || !layout?.getSnapshot || !onMoveGroup) return
    try {
      const snapshot = layout.getSnapshot()
      if (snapshot.status !== 'saved' || snapshot.hasUnconfirmed || snapshot.conflict || snapshot.barrierStatus !== 'idle') return
      const current = new Map(snapshot.items.map(item => [`${item.kind}:${item.id}`, item]))
      for (const item of selectedItems) {
        const position = layoutPosition(item), confirmed = current.get(`${position.kind}:${position.id}`)
        if (!confirmed || ['x', 'y', 'rotation'].some(field => confirmed[field] !== position[field])) return
      }
      const result = onMoveGroup(planSelectionMove(collisionScene, selected, delta))
      result?.catch(error => onError?.(error.message))
    } catch (error) { onError?.(error.message) }
  }
  function frameSelection() {
    if (drag.current || notebookOpen || demo || !selectedItems.length || !viewport.current) return
    try {
      camera.current = selectionCamera({ items: model.items, groups: canvasGroups }, selected, { width: viewport.current.clientWidth, height: viewport.current.clientHeight })
      apply(true); remember(); viewport.current.focus({ preventScroll: true })
    } catch (error) { onError?.(error.message) }
  }
  async function toggleCollapsed(group) {
    if (saving || demo) return
    setSaving(true)
    try {
      const positions = group.collapsed ? planGroupExpansion(group.id, data.canvas_groups || [], reserveUndecodedPhotos(model.items, imageSizes), data.notebooks || [], collisionScene.headers) : []
      await onSaveGroup(group.id, { collapsed: !group.collapsed, ...(positions.length ? { positions } : {}) })
    }
    catch (error) { onError?.(error.message) }
    finally { setSaving(false) }
  }
  function enterSelection() { setSelecting(true); camera.current.detail = true; apply(true); remember(); viewport.current?.focus({ preventScroll: true }) }
  function exitSelection() {
    cancelInput.current?.()
    space.current = false; viewport.current?.classList.remove('is-panning')
    setMarquee(null); setSelected(new Set()); setSelecting(false)
  }
  useEffect(() => {
    const acceptsKeyboard = target => {
      if (!(target instanceof Element) || !viewport.current?.parentElement.contains(target)) return false
      if (target.closest('input,textarea,select,[role="textbox"]') || target.isContentEditable) return false
      const editor = target.closest('[contenteditable]')
      return !editor || editor.getAttribute('contenteditable') === 'false'
    }
    const keydown = event => {
      if (notebookOpen || event.defaultPrevented || event.isComposing || !acceptsKeyboard(event.target) || document.querySelector('dialog[open]')) return
      if (!demo && selecting && selectedItems.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
        if (direction) {
          event.preventDefault()
          if (!event.repeat) nudgeSelection({ x: direction[0] * (event.shiftKey ? 10 : 1), y: direction[1] * (event.shiftKey ? 10 : 1) })
          return
        }
        if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (!event.repeat) frameSelection(); return }
      }
      if (layout && !demo && !saving && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        cancelInput.current?.()
        try { if (event.shiftKey) layout.redoLayout(); else layout.undoLayout() } catch (error) { onError?.(error.message) }
        return
      }
      if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); space.current = true; viewport.current?.classList.add('is-panning') }
      if (selecting && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll() }
      if (event.key === 'Escape') exitSelection()
    }
    const clear = () => { space.current = false; viewport.current?.classList.remove('is-panning') }
    const focusin = event => { if (!acceptsKeyboard(event.target)) { clear(); cancelInput.current?.() } }
    const keyup = event => { if (event.code === 'Space') clear() }
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear); window.addEventListener('focusin', focusin)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); window.removeEventListener('focusin', focusin) }
  }, [selecting, selected, model, notebookOpen, layout, saving, onError, demo, onMoveGroup, data])
  const key = (demo ? 'shitu-camera-demo-v1' : 'shitu-camera-v1') + (userId ? ':' + userId : '')
  function apply(sync = false) {
    const element = viewport.current
    if (!element || !world.current) return
    const c = camera.current
    onViewPosition?.({ x: -c.x / c.scale, y: -c.y / c.scale })
    world.current.style.transform = `translate3d(${element.clientWidth / 2 + c.x}px,${element.clientHeight / 2 + c.y}px,0) scale(${c.scale})`
    if (sync || performance.now() - lastSync.current > 100) { lastSync.current = performance.now(); setView({ ...c }) }
  }
  function remember() { try { localStorage.setItem(key, JSON.stringify(camera.current)) } catch { /* Browsers may disable local storage. */ } }
  function overview() {
    if (drag.current || notebookOpen) return
    if ((!model.groups.length && !model.items.length && !data.notebooks?.length) || !viewport.current) return
    const looseGroups = new Set(model.groups.filter(group => group.ungrouped).map(group => group.id))
    const boxes = [...model.groups.filter(group => !group.ungrouped && group.entries.some(entry => !entry.photos.length || entry.photos.some(photo => !photo.canvas_absolute && !hiddenPhotoIds.has(photo.id)))).map(group => ({ x: group.x, y: group.y + 15, w: 420, h: 430 })), ...displayItems.filter(item => item.kind === 'mark' || item.canvas_absolute || looseGroups.has(item.trip_id)).map(item => cardBounds(item)), ...displayGroups.map(group => ({ x: group.bounds.left + group.bounds.width / 2, y: group.bounds.top + group.bounds.height / 2, w: group.bounds.width, h: group.bounds.height }))]
    for (const book of data.notebooks || []) boxes.push({ x: book.canvas_x, y: book.canvas_y, w: 280, h: 360 })
    if (!boxes.length) return
    const x1 = Math.min(...boxes.map(box => box.x - box.w / 2)), x2 = Math.max(...boxes.map(box => box.x + box.w / 2)), y1 = Math.min(...boxes.map(box => box.y - box.h / 2)), y2 = Math.max(...boxes.map(box => box.y + box.h / 2))
    const scale = Math.min(model.groups.every(group => group.ungrouped) ? .95 : .62, Math.max(.08, Math.min((viewport.current.clientWidth - 100) / (x2 - x1), (viewport.current.clientHeight - 120) / (y2 - y1))))
    camera.current = { scale, x: -(x1 + x2) / 2 * scale, y: -(y1 + y2) / 2 * scale, detail: false }; apply(true); remember()
  }
  useLayoutEffect(() => {
    if ((!model.groups.length && !model.items.length && !data.notebooks?.length) || initialized.current) return
    initialized.current = true
    let saved
    try { saved = JSON.parse(localStorage.getItem(key)) } catch { /* Start from the overview when storage is unavailable. */ }
    if (saved && [saved.x, saved.y, saved.scale].every(Number.isFinite) && saved.scale >= .08 && saved.scale <= 2.4) { camera.current = { ...saved, detail: !!saved.detail }; apply(true) } else overview()
  })
  useLayoutEffect(() => {
    if (handledOverview.current === overviewRequest) return
    handledOverview.current = overviewRequest
    overview()
  })
  useEffect(() => {
    const observer = new ResizeObserver(() => { const element = viewport.current; setSize({ width: element.clientWidth, height: element.clientHeight }); apply(true) })
    observer.observe(viewport.current)
    return () => { observer.disconnect(); clearTimeout(saveTimer.current); clearTimeout(settleTimer.current); cancelAnimationFrame(frame.current) }
  }, [])
  function zoom(scale, point = { x: 0, y: 0 }) {
    if (drag.current || notebookOpen) return
    camera.current = zoomAt(camera.current, Math.max(.08, Math.min(2.4, scale)), point)
    if (camera.current.scale >= .8) camera.current.detail = true
    if (camera.current.scale <= .52) camera.current.detail = false
    apply(true); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(remember, 250)
  }
  useEffect(() => {
    const element = viewport.current
    const wheel = event => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? parseFloat(getComputedStyle(element).lineHeight) || 16 : event.deltaMode === 2 ? element.clientHeight : 1
      zoom(camera.current.scale * Math.exp(-event.deltaY * unit * .0012), viewportPoint({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect()))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  })
  function focus(group) {
    if (drag.current || notebookOpen) return
    const cards = model.items.filter(item => item.trip_id === group.id), boxes = [group.header, ...cards.map(item => cardBounds(item))]
    const minX = Math.min(...boxes.map(box => box.x - box.w / 2)), maxX = Math.max(...boxes.map(box => box.x + box.w / 2)), minY = Math.min(...boxes.map(box => box.y - box.h / 2)), maxY = Math.max(...boxes.map(box => box.y + box.h / 2))
    const scale = Math.max(.75, Math.min(1.12, (size.width - 90) / (maxX - minX), (size.height - 100) / (maxY - minY)))
    camera.current = { scale, detail: true, x: -(minX + maxX) / 2 * scale, y: -(minY + maxY) / 2 * scale }; apply(true); remember()
  }
  function beginGroup(event, group) {
    if (drag.current || notebookOpen) return
    if (space.current || event.button === 1) { begin(event); return }
    if (event.button !== 0 || saving || demo) return
    event.preventDefault(); event.stopPropagation()
    if (selecting || event.shiftKey || event.ctrlKey || event.metaKey) { enterSelection(); toggleItem(group.photo_ids[0]); return }
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, group, target, members: model.items.filter(item => group.photo_ids.includes(item.id)), startX: event.clientX, startY: event.clientY, startViewport: viewportPoint({ x: event.clientX, y: event.clientY }, viewport.current.getBoundingClientRect()), dx: 0, dy: 0, moved: false }
    viewport.current.classList.add('is-dragging')
  }
  function shiftGroup(current, dx, dy) {
    for (const item of current.members) {
      const node = photoNodes.current.get(item.id)
      if (node) node.style.transform = transformCard({ ...item, x: item.x + dx, y: item.y + dy })
    }
    const memberIds = new Set(current.members.map(item => item.id))
    const movedItems = model.items.map(item => memberIds.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item)
    for (const group of layoutCanvasGroups(data.canvas_groups || [], movedItems)) {
      const node = groupNodes.current.get(group.id)
      if (node) for (const [key, value] of Object.entries(group.bounds)) node.style[key] = value + 'px'
    }
  }
  function begin(event, item) {
    if (drag.current || notebookOpen) return
    if (event.button !== 0 && event.button !== 1 || saving) return
    if (!item && event.target.closest('button')) return
    const panning = space.current || event.button === 1
    if (!demo && !panning && item && item.kind !== 'notebook' && (selecting || event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); enterSelection(); toggleItem(item.id); return }
    event.stopPropagation(); clearTimeout(settleTimer.current)
    const target = event.currentTarget
    target.style.transition = 'none'
    target.setPointerCapture(event.pointerId)
    if (selecting && !item && !panning) {
      const bounds = viewport.current.getBoundingClientRect()
      const start = screenToWorld({ x: event.clientX, y: event.clientY }, bounds, camera.current)
      drag.current = { pointerId: event.pointerId, marquee: true, target, start, bounds, startX: event.clientX, startY: event.clientY, base: event.shiftKey ? new Set(selected) : new Set() }
      if (!event.shiftKey) setSelected(new Set())
      return
    }
    if (panning) item = null
    drag.current = { pointerId: event.pointerId, item, target, startX: event.clientX, startY: event.clientY, startViewport: viewportPoint({ x: event.clientX, y: event.clientY }, viewport.current.getBoundingClientRect()), originalX: item?.x ?? camera.current.x, originalY: item?.y ?? camera.current.y, moved: false, x: item?.x, y: item?.y }
    viewport.current.classList.add('is-dragging')
  }
  function move(event) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    let dx = event.clientX - current.startX, dy = event.clientY - current.startY
    if (!current.marquee && !current.moved) {
      if (Math.abs(dx) + Math.abs(dy) <= 5) return
      current.moved = true
    }
    if (!current.marquee) {
      const point = viewportPoint({ x: event.clientX, y: event.clientY }, viewport.current.getBoundingClientRect())
      dx = point.x - current.startViewport.x; dy = point.y - current.startViewport.y
    }
    if (current.group) {
      current.dx = dx / camera.current.scale; current.dy = dy / camera.current.scale
      shiftGroup(current, current.dx, current.dy)
      return
    }
    if (current.marquee) {
      const b = viewport.current.getBoundingClientRect()
      const point = screenToWorld({ x: event.clientX, y: event.clientY }, b, camera.current)
      const start = worldToScreen(current.start, b, camera.current)
      setMarquee({ left: Math.min(start.x, event.clientX) - b.left, top: Math.min(start.y, event.clientY) - b.top, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) })
      const rectangle = { x: (current.start.x + point.x) / 2, y: (current.start.y + point.y) / 2, w: Math.abs(current.start.x - point.x), h: Math.abs(current.start.y - point.y) }
      const hitGroups = displayGroups.filter(group => intersects(rectangle, { x: group.bounds.left + group.bounds.width / 2, y: group.bounds.top + group.bounds.height / 2, w: group.bounds.width, h: group.bounds.height }))
      setSelected(expandGroupSelection([...current.base, ...itemsInRectangle(displayItems, current.start, point), ...hitGroups.flatMap(group => group.photo_ids)], canvasGroups))
      return
    }
    if (current.item) {
      current.x = current.originalX + dx / camera.current.scale; current.y = current.originalY + dy / camera.current.scale
      current.target.style.transform = transformCard({ ...current.item, x: current.x, y: current.y })
    } else { camera.current.x = current.originalX + dx; camera.current.y = current.originalY + dy; apply() }
  }
  function cancelDrag(sync = true) {
    const current = drag.current
    if (!current) return
    drag.current = null
    viewport.current?.classList.remove('is-dragging')
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    if (current.group) shiftGroup(current, 0, 0)
    else if (current.item) current.target.style.transform = transformCard(current.item)
    else if (!current.marquee) {
      camera.current.x = current.originalX; camera.current.y = current.originalY
      if (sync) { apply(true); remember() }
    }
    if (current.marquee && sync) { setMarquee(null); setSelected(current.base) }
  }
  async function end(event, cancelled = false) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    if (cancelled) { cancelDrag(); return }
    drag.current = null; viewport.current.classList.remove('is-dragging')
    if (current.target.hasPointerCapture(event.pointerId)) current.target.releasePointerCapture(event.pointerId)
    if (current.group) {
      if (cancelled || !current.moved) { shiftGroup(current, 0, 0); return }
      setSaving(true)
      // The optimistic layout update will move the background through its bounds.
      try {
        if (onDropItem && await onDropItem(current.members, { x: event.clientX, y: event.clientY })) { shiftGroup(current, 0, 0); return }
        const positions = planCanvasGroupMove(current.group.id, collisionScene, { x: current.dx, y: current.dy })
        if (positions.length) shiftGroup(current, positions[0].x - current.members[0].x, positions[0].y - current.members[0].y)
        await onMoveGroup(positions)
      }
      catch (error) { shiftGroup(current, 0, 0); onError(error.message) }
      finally { setSaving(false) }
      return
    }
    if (current.marquee) { setMarquee(null); if (cancelled) setSelected(current.base); return }
    if (!current.item) { apply(true); remember(); return }
    if (!current.moved && !cancelled) { if (current.item.kind === 'notebook') onNotebook?.(current.item.id); else onOpen(current.item.entry, current.item.kind === 'photo' ? current.item.id : null); return }
    if (current.item.kind === 'notebook') {
      if (cancelled || demo) { current.target.style.transform = transformCard(current.item); return }
      setSaving(true)
      const position = placeCanvasItem({ ...current.item, x: current.x, y: current.y }, collisionScene)
      current.target.style.transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 160ms ease-out'
      current.target.style.transform = transformCard({ ...current.item, ...position })
      try { await onMoveNotebook?.(current.item.id, { canvas_x: position.x, canvas_y: position.y }) } catch (error) { current.target.style.transform = transformCard(current.item); onError?.(error.message) } finally { setSaving(false) }
      return
    }
    if (!cancelled && !demo && onDropItem) {
      try {
        if (await onDropItem(current.item, { x: event.clientX, y: event.clientY })) { current.target.style.transform = transformCard(current.item); return }
      } catch (error) { current.target.style.transform = transformCard(current.item); onError?.(error.message); return }
    }
    const reserved = reservedItems.find(item => item.id === current.item.id) || current.item
    const position = cancelled ? { x: current.originalX, y: current.originalY } : placeCanvasItem({ ...reserved, x: current.x, y: current.y }, collisionScene)
    current.target.style.transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 160ms ease-out'
    current.target.style.transform = transformCard({ ...current.item, ...position })
    settleTimer.current = setTimeout(() => { if (current.target.isConnected) current.target.style.transition = 'none' }, 170)
    if (cancelled || demo) return
    setSaving(true)
    try { await onMove({ id: current.item.kind === 'entry' ? current.item.entry.record_id || current.item.id : current.item.id, kind: current.item.kind, x: position.x - (current.item.kind === 'photo' ? 0 : current.item.anchor.x), y: position.y - (current.item.kind === 'photo' ? 0 : current.item.anchor.y), rotation: current.item.rotation || 0 }) } catch (error) { current.target.style.transform = transformCard(current.item); onError(error.message) } finally { setSaving(false) }
  }
  const visible = item => Math.abs(item.x * view.scale + view.x) < size.width / 2 + 600 && Math.abs(item.y * view.scale + view.y) < size.height / 2 + 600
  const looseIds = new Set(model.groups.filter(group => group.ungrouped).map(group => group.id))
  const cardEligible = item => focusedPhoto === item.id || drag.current?.item?.id === item.id || drag.current?.members?.some(member => member.id === item.id) || selecting || item.canvas_absolute || item.kind === 'mark' || view.detail || looseIds.has(item.trip_id)
  const islands = !selecting && !view.detail ? model.groups.filter(group => !group.ungrouped && visible(group) && group.entries.some(entry => !entry.photos.length || entry.photos.some(photo => !photo.canvas_absolute))) : []
  const groupCoverId = (group, item) => `cover:group:${group.id}:${item.id}`
  const islandCoverId = (group, item) => `cover:island:${group.id}:${item.id}`
  const notebookCoverId = book => `cover:notebook:${book.id}`
  const proxies = [
    ...(data.notebooks || []).map(book => ({ id: notebookCoverId(book), kind: 'photo', hasImage: !!book.cover_url && (!book.cover_mode || book.cover_mode === 'photo'), priority: 1, x: book.canvas_x, y: book.canvas_y, width: 280, height: 360 })),
    ...displayGroups.filter(group => group.collapsed).flatMap(group => model.items.filter(item => group.photo_ids.includes(item.id) && item.kind === 'photo').slice(0, 3).map(item => ({ id: groupCoverId(group, item), kind: 'photo', priority: 1, x: group.bounds.left + group.bounds.width / 2, y: group.bounds.top + group.bounds.height / 2, width: 100, height: 96 }))),
    ...islands.flatMap(group => group.covers.map(item => ({ id: islandCoverId(group, item), kind: 'photo', priority: 1, x: group.x, y: group.y, width: 270, height: 250 }))),
  ]
  const draggingIds = drag.current?.group ? [...drag.current.members.map(item => item.id), ...drag.current.members.map(item => groupCoverId(drag.current.group, item))] : (drag.current?.item ? [drag.current.item.kind === 'notebook' ? notebookCoverId(drag.current.item) : drag.current.item.id] : [])
  const residency = imageResidency ? planImageResidency({
    items: [...displayItems.filter(cardEligible).map(item => ({ ...item, kind: 'photo', hasImage: item.kind === 'photo' })), ...proxies], camera: view, viewport: size, profile: imageProfile,
    // Visible covers take priority over ordinary cards at the same visibility level.
    previousIds: [...proxies.map(item => item.id), ...previousResidency.current], focusId: focusedPhoto, dragIds: draggingIds,
  }) : null
  const detailIds = new Set(residency?.detailIds), imageIds = new Set(residency?.displayIds)
  useLayoutEffect(() => { previousResidency.current = residency?.detailIds || [] })
  function enterLocalOverview(cell) {
    if (drag.current || notebookOpen) return
    const scale = Math.max(.08, Math.min(2.4, cell.zoomTarget.scale))
    if (scale >= 2.4 && camera.current.scale >= 2.4) { setOverviewMembers(cell); return }
    camera.current = { x: -(cell.bounds.left + cell.bounds.right) / 2 * scale, y: -(cell.bounds.top + cell.bounds.bottom) / 2 * scale, scale, detail: true }
    apply(true); remember(); viewport.current?.focus({ preventScroll: true })
  }
  function resolveOverviewMember(id) {
    const item = model.items.find(item => item.id === id)
    if (item) return { id, label: item.entry.place_name || item.entry.title || (item.kind === 'mark' ? item.entry.mark.text || '文字与贴纸' : '旅行记忆'), choose: () => selecting ? toggleItem(item.id) : onOpen?.(item.entry, item.kind === 'photo' ? item.id : null) }
    const book = (data.notebooks || []).find(book => notebookCoverId(book) === id)
    if (book) return { id, label: book.name, choose: () => onNotebook?.(book.id) }
    const group = displayGroups.find(group => group.photo_ids.some(photoId => groupCoverId(group, { id: photoId }) === id))
    if (group) return { id, label: group.name + ' · 展开分组', choose: () => toggleCollapsed(group) }
    const island = model.groups.find(group => group.covers.some(photo => islandCoverId(group, photo) === id))
    if (island) return { id, label: island.name, choose: () => focus(island) }
    return null
  }
  const fallbackMembers = (overviewMembers?.ids || []).map(resolveOverviewMember).filter(Boolean)
  function coverImage(id, item, style) {
    return !imageResidency || imageIds.has(id)
      ? <JournalImage key={id} src={item.url} alt="" style={style} resourcePolicy={imageCache ? 'canvas' : undefined} />
      : <span key={id} className="j-image-placeholder" aria-hidden="true" style={style} />
  }
  return <div className="j-canvas-shell" data-residency-mode={imageResidency ? imageProfile : undefined}>
    <ImageResourcePrefetch enabled={imageCache && imageResidency} profile={imageProfile} sources={(residency?.prefetchIds || []).map(id => model.items.find(item => item.kind === 'photo' && item.id === id)?.url).filter(Boolean)} />
    <div className="j-canvas-controls"><div>{!demo && <button className="j-button" aria-pressed={selecting} onClick={() => selecting ? exitSelection() : enterSelection()}><SquareDashedMousePointer />{selecting ? '退出多选' : '多选内容'}</button>}<span>{saving ? '正在保存位置…' : view.detail ? '单击查看 · 拖动整理' : '随意走走，看看留下的片刻'}</span></div><div><button className="j-icon-button" aria-label="缩小画布" onClick={() => zoom(camera.current.scale / 1.2)}><Minus /></button><span className="j-zoom-value">{Math.round(view.scale * 100)}%</span><button className="j-icon-button" aria-label="放大画布" onClick={() => zoom(camera.current.scale * 1.2)}><Plus /></button><button className="j-icon-button" aria-label="查看全部旅程" onClick={overview}><Expand /></button></div></div>
    <div className={'j-canvas ' + (selecting ? 'is-selecting' : '')} ref={viewport} tabIndex={0} role="region" aria-label="旅行照片画布，拖动空白漫游，滚轮缩放" onFocusCapture={event => { if (imageResidency) setFocusedPhoto(event.target.closest('[data-residency-id]')?.dataset.residencyId || event.target.closest('[data-photo-id]')?.dataset.photoId || null) }} onBlurCapture={event => { if (imageResidency && !event.currentTarget.contains(event.relatedTarget)) setFocusedPhoto(null) }} onPointerDown={event => begin(event)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
      <div className="j-world" ref={world}>
        {residency?.overview.map(cell => <button key={cell.id} className="j-residency-overview" data-overview-count={cell.count} style={{ transform: `translate(${(cell.bounds.left + cell.bounds.right) / 2}px,${(cell.bounds.top + cell.bounds.bottom) / 2}px) translate(-50%,-50%)`, zIndex: 1000, width: 220 / view.scale, fontSize: 12 / view.scale, padding: 10 / view.scale }} aria-label={`进入局部，${cell.count}项内容`} onClick={() => enterLocalOverview(cell)}>{cell.count} 项内容 · 进入局部</button>)}
        {(data.notebooks || []).filter(book => !imageResidency || detailIds.has(notebookCoverId(book))).map(book => <button key={book.id} className="j-notebook-cover" data-notebook-id={book.id} data-residency-id={notebookCoverId(book)} style={{ transform: transformCard({ x: book.canvas_x, y: book.canvas_y, rotation: book.rotation }) }} aria-label={`打开手帐：${book.name}`} onPointerDown={event => begin(event, { ...book, kind: 'notebook', x: book.canvas_x, y: book.canvas_y, anchor: { x: 0, y: 0 } })} onClick={event => { if (event.detail === 0) onNotebook?.(book.id) }}><NotebookCover imageResident={!imageResidency || imageIds.has(notebookCoverId(book))} imageResourcePolicy={imageCache ? 'canvas' : undefined} book={book} pageCount={(data.notebook_pages || []).filter(page => page.notebook_id === book.id).length} /></button>)}
        {displayGroups.map(group => <div key={group.id} ref={node => { if (node) groupNodes.current.set(group.id, node); else groupNodes.current.delete(group.id) }} className={'j-canvas-group' + (group.collapsed ? ' is-collapsed' : '') + (selecting && group.photo_ids.every(id => selected.has(id)) ? ' is-selected' : '')} data-group-id={group.id} data-parent-group-id={group.parent_id || undefined} data-color={group.color} style={{ ...group.bounds, '--j-group-padding': CANVAS_GROUP_METRICS.padding + 'px', '--j-group-header': CANVAS_GROUP_METRICS.header + 'px' }}>
          <button className="j-group-handle" aria-label={`移动分组：${group.name}`} aria-pressed={selecting ? group.photo_ids.every(id => selected.has(id)) : undefined} onPointerDown={event => beginGroup(event, group)} onClick={event => { if (event.detail === 0 && selecting) toggleItem(group.photo_ids[0]) }}>{group.name}<small>{model.items.filter(item => group.photo_ids.includes(item.id)).length} 张照片{group.child_group_ids.length ? ` · ${group.child_group_ids.length} 个子色块` : ''} · {selecting ? '点击选择整组' : '拖动整组'}</small></button>
          {!demo && <button className="j-group-settings" aria-label={`编辑分组：${group.name}`} disabled={saving} onClick={() => setGroupEditor({ group })}>编辑</button>}
          {!demo && <button className="j-group-collapse" aria-label={`${group.collapsed ? '展开' : '折叠'}分组：${group.name}`} aria-expanded={!group.collapsed} disabled={saving} onClick={() => toggleCollapsed(group)}>{group.collapsed ? '展开' : '折叠'}</button>}
          {!!group.collapsed && <button className="j-group-cover" data-residency-id={groupCoverId(group, { id: group.photo_ids[0] })} aria-label={`移动分组封面：${group.name}`} onPointerDown={event => beginGroup(event, group)} onClick={event => { if (event.detail === 0 && selecting) toggleItem(group.photo_ids[0]) }}><span className="j-group-cover-images">{model.items.filter(item => group.photo_ids.includes(item.id) && item.kind === 'photo').slice(0, 3).map(item => coverImage(groupCoverId(group, item), item, { filter: imageFilter(item.image_filter) }))}</span><span className="j-group-cover-caption">{group.photo_ids.length} 张照片{group.child_group_ids.length ? ` · ${group.child_group_ids.length} 个子色块` : ''}</span></button>}
        </div>)}
        {islands.map(group => <button key={group.id} className="j-island" data-residency-id={islandCoverId(group, { id: group.covers[0]?.id })} data-trip={group.id} style={{ transform: `translate(${group.x}px,${group.y}px) translate(-50%,-50%)` }} onClick={() => focus(group)} aria-label={`展开${group.name}，${group.cardCount}张照片与记录`}>
          <span className="j-island-images">{group.covers.length ? group.covers.slice().reverse().map(photo => coverImage(islandCoverId(group, photo), photo)) : <span className="j-island-note" data-color={group.color}><StickyNote /><span>{group.entries[0]?.caption || '旅程的第一页，等你来写。'}</span></span>}</span>
          <strong>{group.name}</strong><small>{group.cardCount} {group.covers.length ? '张照片与记录' : '条记忆'}</small>
        </button>)}
        <>
          {model.groups.filter(group => view.detail && !group.ungrouped && group.entries.some(isWestLake) && visible({ x: group.header.x, y: group.header.y })).map(group => <div className="j-cluster-heading" key={group.id} style={{ width: group.width, transform: `translate(${group.header.x - group.width / 2}px,${group.header.y - 30}px)` }}><button className="j-scene-entry" onClick={() => onScene(group.id)}><MapIcon />西湖 · 3D 场景</button></div>)}
          {displayItems.filter(item => cardEligible(item) && (imageResidency ? detailIds.has(item.id) : visible(item))).map(item => <CanvasItem key={item.id} imageResident={!imageResidency || imageIds.has(item.id)} imageResourcePolicy={imageCache ? 'canvas' : undefined} item={item} trips={data.trips} nodeRef={node => { if (node) photoNodes.current.set(item.id, node); else photoNodes.current.delete(item.id) }} selecting={selecting} selected={selected.has(item.id)} onPointerDown={begin} onOpen={onOpen} onToggle={toggleItem} onImageLoad={(event, loadedItem) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) recordDimensions(loadedItem.url, { width: image.naturalWidth, height: image.naturalHeight }) }} />)}
        </>
      </div>
      {marquee && <div className="j-selection-rectangle" style={marquee} />}
    </div>
    {selecting && <div className="j-selection-bar"><strong>已选 {selectedItems.length} 项</strong><button className="j-button" disabled={!selectedItems.length || notebookOpen} onClick={frameSelection}>定位选中</button><button className="j-button" onClick={selectAll}>全选内容</button><button className="j-button" onClick={() => setSelected(new Set())}>清空选择</button><button className="j-button" disabled={saving || !selectedPhotos.length} onClick={() => setGroupEditor({ positions: selectedPhotos.map(item => ({ id: item.id, x: item.x, y: item.y, rotation: item.rotation || 0 })) })}>添加色块分组</button><button className="j-button j-primary" disabled={!selectedPhotos.length} onClick={() => onBatchEdit(selectedPhotos.map(item => item.id), selectedPhotos.map(item => ({ id: item.id, x: item.x, y: item.y, rotation: item.rotation || 0 })))}>{selectedPhotos.length && selectedPhotos.length !== selectedItems.length ? `编辑 ${selectedPhotos.length} 张照片信息` : '编辑照片信息'}</button><button className="j-button j-danger" disabled={!selectedItems.length} onClick={() => onBatchDelete(selectedItems)}><Trash2 />删除选中内容</button><button className="j-icon-button" aria-label="结束多选" onClick={exitSelection}><X /></button></div>}
    {overviewMembers && <CanvasOverviewMembers members={fallbackMembers} selecting={selecting} onChoose={id => { if (drag.current || notebookOpen) return; fallbackMembers.find(member => member.id === id)?.choose(); if (!selecting) setOverviewMembers(null) }} onClose={() => setOverviewMembers(null)} />}
    {groupEditor && <CanvasGroupEditor {...groupEditor} onSave={async (id, values) => { await onSaveGroup(id, values); if (!id) { setSelecting(false); setSelected(new Set()) } }} onDelete={onDeleteGroup} onClose={() => setGroupEditor(null)} />}
    <div className="j-canvas-hint" aria-live="polite"><span className="j-dot" />{selecting ? '点按方向键微调，Shift加速；保存完成后可继续 · F定位选中 · 空格漫游（最多500项）' : view.detail ? '缩小回到旅程照片组' : '拖动画布漫游 · Shift 点选内容可多选'}</div>
  </div>
}
