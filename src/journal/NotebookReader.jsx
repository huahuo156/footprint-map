import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, X, ZoomIn } from 'lucide-react'
import CanvasItem from './CanvasItem'
import { findPagePosition, pageItems, PAGE_WIDTH, PAGE_HEIGHT } from './notebooks'
import { createPaperTurn } from './paperTurn'
import './notebook.css'

export default function NotebookReader({ book, data, onOpen, onClose, onAdd, onMove, onReturn, onAddPage, onDeletePage, onReorder, onEditBook, onReadingChange, onError, readOnly = false }) {
  const pages = useMemo(() => (data.notebook_pages || []).filter(page => page.notebook_id === book.id).sort((a, b) => a.sort_order - b.sort_order), [data.notebook_pages, book.id])
  const leaves = useMemo(() => [{ id:book.id+'-inside-cover',front:'blank' }, { id:book.id+'-flyleaf',front:'title' }, ...pages], [book.id,pages])
  const [spread, setSpread] = useState(() => { const index=pages.findIndex(p=>p.id===book.last_read_page_id); return index<0?0:2+Math.floor(index/2)*2 }), [active, setActive] = useState(book.last_read_page_id), [zoom, setZoom] = useState(1), [manage, setManage] = useState(false)
  const [imageSizes, setImageSizes] = useState({}), [size, setSize] = useState({ width: 650, height: 550 }), [turn, setTurn] = useState(null), [busy, setBusy] = useState(false)
  const area = useRef(null), bookNode = useRef(null), paperNodes = useRef(new Map()), drag = useRef(null), turning = useRef(null), raf = useRef(null), pendingCommit = useRef(null)
  const validSpread = Math.min(spread, Math.max(0, Math.floor((leaves.length - 1) / 2) * 2)), onFlyleaf = validSpread === 0
  const currentPage = active && leaves.slice(validSpread, validSpread + 2).some(p => !p.front && p.id === active) ? active : onFlyleaf ? pages[0]?.id : leaves[validSpread + 1]?.id || leaves[validSpread]?.id
  const readingPage = onFlyleaf ? null : currentPage
  const reportedPage = useRef(book.last_read_page_id ?? null), readingCallbacks = useRef(null)
  readingCallbacks.current = { onReadingChange, onError }
  const fit = Math.max(.05, Math.min((size.width - 64) / (PAGE_WIDTH * 2), (size.height - 64) / PAGE_HEIGHT)), scale = fit * zoom
  const fullItems = useMemo(() => new Map(pages.map(page => [page.id, pageItems(data, page.id, imageSizes)])), [data, pages, imageSizes])
  useEffect(() => {
    if (readOnly || busy || !readingCallbacks.current.onReadingChange || reportedPage.current === readingPage) return
    reportedPage.current = readingPage
    Promise.resolve().then(()=>readingCallbacks.current.onReadingChange({last_read_page_id:readingPage})).catch(error=>readingCallbacks.current.onError?.(error.message))
  },[readingPage,readOnly,busy])
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (area.current) setSize({ width: area.current.clientWidth, height: area.current.clientHeight }) })
    observer.observe(area.current)
    return () => { observer.disconnect(); cancelAnimationFrame(raf.current); turning.current?.surface?.remove() }
  }, [])
  useEffect(() => {
    const keydown = event => {
      if (document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable]')) return
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') { event.preventDefault(); startTurn(1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); startTurn(-1) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  function loaded(event, item) {
    const img = event.currentTarget
    if (img.naturalWidth) setImageSizes(old => old[item.url]?.width === img.naturalWidth && old[item.url]?.height === img.naturalHeight ? old : { ...old, [item.url]: { width: img.naturalWidth, height: img.naturalHeight } })
  }
  function finishTurn(commit) {
    const state = turning.current
    if (!state) return
    // Keep the leaf until React has installed the destination spread.
    pendingCommit.current = state.surface
    if (commit) setSpread(state.destination)
    turning.current = null; setTurn(null); setBusy(false)
  }
  useLayoutEffect(() => { if (!turn && pendingCommit.current) { pendingCommit.current.remove(); pendingCommit.current = null } }, [turn, validSpread])
  function settle(commit) {
    const state = turning.current
    if (!state) return
    const from = state.progress, target = commit ? 1 : 0, start = performance.now(), duration = Math.max(240, 1250 * Math.abs(target - from))
    const frame = now => {
      if (turning.current !== state) return
      const t = Math.min(1, (now - start) / duration), ease = t * t * (3 - 2 * t)
      state.progress = from + (target - from) * ease; state.surface.update(state.progress)
      if (t < 1) raf.current = requestAnimationFrame(frame); else finishTurn(commit)
    }
    raf.current = requestAnimationFrame(frame)
  }
  function startTurn(direction, pointer = null, destination = validSpread + direction * 2) {
    if (busy || turning.current || destination < 0 || destination >= leaves.length) return false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSpread(destination); return false }
    setBusy(true); setTurn({ direction, destination })
    turning.current = { direction, destination, pointer, progress: 0, surface: null }
    return true
  }
  useLayoutEffect(() => {
    if (!turn || !turning.current || turning.current.surface) return
    const { direction, destination } = turn
    const front = direction > 0 ? validSpread + 1 : destination + 1, back = direction > 0 ? destination : validSpread
    const surface = createPaperTurn(bookNode.current, paperNodes.current.get(leaves[front].id), paperNodes.current.get(leaves[back].id), direction)
    turning.current.surface = surface
    if (!turning.current.pointer) settle(true)
  }, [turn])
  function cornerDown(event, direction) {
    if (zoom !== 1) return
    if (startTurn(direction, { x: event.clientX, y: event.clientY, moved: false })) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }
  }
  function cornerMove(event) {
    const state = turning.current
    if (!state?.pointer || !state.surface) return
    const delta = (state.pointer.x - event.clientX) * state.direction
    state.pointer.moved ||= Math.abs(delta) > 6
    state.progress = Math.max(0, Math.min(1, delta / (bookNode.current.clientWidth * .85)))
    state.surface.update(state.progress)
  }
  function cornerUp(cancelled = false) {
    const state = turning.current
    if (!state?.pointer) return
    const commit = !cancelled && (!state.pointer.moved || state.progress > .28)
    state.pointer = null; settle(commit)
  }
  function beginItem(event, item, pageId) {
    if (busy || event.button !== 0) return
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { item, pageId, target: event.currentTarget, clientX: event.clientX, clientY: event.clientY, moved: false }
    setActive(pageId)
  }
  function moveItem(event) {
    const d = drag.current
    if (!d || readOnly) return
    const dx = (event.clientX - d.clientX) / scale, dy = (event.clientY - d.clientY) / scale
    d.moved ||= Math.abs(dx) + Math.abs(dy) > 8
    if (d.moved) d.target.style.transform = `translate3d(${d.item.x + dx}px,${d.item.y + dy}px,0) translate(-50%,-50%) rotate(${d.item.rotation || 0}deg) scale(${d.item.contentScale || 1})`
  }
  async function endItem(event, cancelled = false) {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (!d.moved && !cancelled) { onOpen(d.item.entry, d.item.kind === 'photo' ? d.item.id : null); return }
    d.target.style.transform = `translate3d(${d.item.x}px,${d.item.y}px,0) translate(-50%,-50%) rotate(${d.item.rotation || 0}deg) scale(${d.item.contentScale || 1})`
    if (cancelled || readOnly) return
    setBusy(true)
    try {
      const under = document.elementFromPoint(event.clientX, event.clientY), paper = under?.closest('[data-notebook-page]')
      if (!paper) { if (under?.closest('.j-canvas')) await onReturn?.([d.item]); return }
      const pageId = paper.dataset.notebookPage, bounds = paper.getBoundingClientRect()
      const preferred = { x: (event.clientX - bounds.left) / bounds.width * PAGE_WIDTH, y: (event.clientY - bounds.top) / bounds.height * PAGE_HEIGHT }
      const position = findPagePosition(d.item, (fullItems.get(pageId) || []).filter(i => i.id !== d.item.id || i.kind !== d.item.kind), preferred)
      await onMove?.(pageId, [{ id: d.item.id, kind: d.item.kind, ...position, rotation: d.item.rotation || 0 }])
    } catch (error) { onError(error.message) } finally { setBusy(false) }
  }
  async function action(fn) { setBusy(true); try { await fn() } catch (error) { onError?.(error.message) } finally { setBusy(false) } }
  function addContent(event) {
    event.currentTarget.closest('details').open = false
    if (onFlyleaf) { setActive(pages[0]?.id); setSpread(2) }
    onAdd?.(currentPage)
  }
  function addPaper() {
    action(async()=>{
      const after = onFlyleaf ? pages[0] : leaves[validSpread+1] || leaves[validSpread]
      const result = await onAddPage?.(after?.id)
      if (result?.id) { setActive(result.id); setSpread(2+Math.floor((pages.findIndex(page=>page.id===after?.id)+1)/2)*2) }
    })
  }
  const bookmarkIndex = pages.findIndex(page=>page.id===book.bookmark_page_id)
  const bookmarkSpread = bookmarkIndex < 0 ? null : 2+Math.floor(bookmarkIndex/2)*2
  const bookmarkVisible = bookmarkSpread === validSpread
  const ribbonPageIndex = bookmarkVisible ? bookmarkIndex : pages.findIndex(page=>page.id===currentPage)
  const ribbonLabel = bookmarkIndex < 0 ? `夹住第${ribbonPageIndex+1}页` : bookmarkVisible ? `取下第${bookmarkIndex+1}页的书签` : `翻到书签，第${bookmarkIndex+1}页`
  function ribbonClick() {
    if (bookmarkIndex >= 0 && !bookmarkVisible) { setActive(book.bookmark_page_id); startTurn(bookmarkSpread>validSpread?1:-1,null,bookmarkSpread); return }
    action(()=>onReadingChange?.({bookmark_page_id:bookmarkIndex<0?currentPage:null}))
  }
  const paper = (page, template = false) => page && <div key={page.id} ref={node => { if (node) paperNodes.current.set(page.id, node) }} className={'nb-paper' + (currentPage === page.id ? ' is-current' : '')} data-notebook-page={template || turn || page.front ? undefined : page.id} style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }} onClick={() => !busy && !page.front && setActive(page.id)}>
    <div className={'nb-board'+(page.front==='title'?' nb-flyleaf':'')} style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}>
      {page.front === 'title' && <><h2 className={book.name.length>40?'is-long':''}>{book.name}</h2>{book.cover_text?.trim() && <p className={book.cover_text.length>180?'is-long':''}>{book.cover_text}</p>}</>}
      {(fullItems.get(page.id) || []).map(item => <CanvasItem key={item.kind + item.id} item={item} trips={data.trips} componentLimit={Infinity} onImageLoad={loaded} onOpen={onOpen} onPointerDown={event => beginItem(event, item, page.id)} />)}
    </div>
    {!page.front && <span className="nb-folio">{pages.indexOf(page) + 1}</span>}
  </div>
  const visibleLeft = turn?.direction < 0 ? turn.destination : validSpread, visibleRight = turn?.direction > 0 ? turn.destination + 1 : validSpread + 1
  return <section className='nb-reader' aria-label={book.name + '，翻页手帐'}>
    <header className="nb-heading"><span>{book.name}</span><div className="nb-heading-actions">
      <button className="j-button" title={zoom === 1 ? '放大纸页' : '恢复完整手札'} aria-label={zoom === 1 ? '放大纸页' : '恢复完整手札'} disabled={busy} onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{zoom === 1 ? <ZoomIn /> : <Maximize2 />}<span>{zoom === 1 ? '放大' : '适合窗口'}</span></button>
      {!readOnly && <details className="nb-menu"><summary aria-label="手札工具" title="添加内容、整理内页、修改名称与封面"><Plus /><span>添加与整理</span></summary><div><button disabled={busy} onClick={addContent}>添加照片、文字或贴纸</button><button disabled={busy} onClick={addPaper}>添加纸页</button><button disabled={busy} onClick={() => setManage(!manage)}>整理内页</button><button disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; onEditBook?.() }}>名称与封面</button></div></details>}
      <button className="j-button" title="合上手札（Esc）" aria-label="合上手札" disabled={busy} onClick={onClose}><X /><span>合上</span></button></div></header>
    {manage && <div className="nb-organizer" aria-label="整理内页">{pages.map((page, index) => <div key={page.id}><button onClick={() => { setSpread(2 + Math.floor(index / 2) * 2); setActive(page.id) }}>{index + 1}</button><button aria-label={`将第${index + 1}页前移`} disabled={busy || index === 0} onClick={() => action(() => { const ids = pages.map(p => p.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; return onReorder?.(ids) })}><Minus /></button><button aria-label={`删除第${index + 1}页并保留内容`} disabled={busy || pages.length <= 2} onClick={() => action(() => onDeletePage?.(page.id))}><X /></button></div>)}</div>}
    <div className="nb-page-area" ref={area} onPointerMove={moveItem} onPointerUp={event => endItem(event)} onPointerCancel={event => endItem(event, true)}>
      <div className="nb-book" ref={bookNode} style={{ width: PAGE_WIDTH * scale * 2, height: PAGE_HEIGHT * scale, '--nb-scale': scale }}>
        <div className="nb-spread">{paper(leaves[visibleLeft])}{paper(leaves[visibleRight])}</div><div className="nb-spine" />
        <div className="nb-snapshots" aria-hidden="true" inert>{leaves.filter((_, i) => i !== visibleLeft && i !== visibleRight).map(p => paper(p,true))}</div>
        {!readOnly && (bookmarkIndex>=0 || !onFlyleaf) && <button type="button" className={'nb-ribbon'+(bookmarkIndex>=0?' is-placed':'')} style={{left:bookmarkVisible || bookmarkIndex<0 ? `${(ribbonPageIndex%2)*50+41}%` : '91%'}} title={ribbonLabel} aria-label={ribbonLabel} disabled={busy} onClick={ribbonClick} />}
        {zoom === 1 && <><button className="nb-corner previous" aria-label="翻到上一张纸" disabled={busy || validSpread === 0} onPointerDown={event => cornerDown(event, -1)} onPointerMove={cornerMove} onPointerUp={() => cornerUp()} onPointerCancel={() => cornerUp(true)} onClick={event => { if (event.detail === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) startTurn(-1) }} /><button className="nb-corner next" aria-label="翻到下一张纸" disabled={busy || validSpread + 2 >= leaves.length} onPointerDown={event => cornerDown(event, 1)} onPointerMove={cornerMove} onPointerUp={() => cornerUp()} onPointerCancel={() => cornerUp(true)} onClick={event => { if (event.detail === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) startTurn(1) }} /></>}
      </div>
    </div>
    <footer className="nb-page-count" aria-label="手帐页码">{onFlyleaf ? '扉页' : `${validSpread - 1}–${Math.min(validSpread, pages.length)}`} / {pages.length}</footer>
  </section>
}
