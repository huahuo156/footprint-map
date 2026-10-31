import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Minus, Plus } from 'lucide-react'
import JournalImage from './JournalImage'
import { imageFilter } from './model'
import { atlasPhotos, chinaPaths, layoutAtlas } from './atlasLayout'
import { ATLAS_MAP_BOUNDS, ATLAS_MAP_SCALE, ATLAS_PERSPECTIVE, atlasSceneBounds, atlasTilt, projectAtlasPoint } from './atlasScene'
import AtlasScatter, { useAtlasDrag } from './AtlasScatter'
import { atlasInsights } from './atlasInsights'
import AtlasMapLayers from './AtlasMapLayers'
import AtlasSelection from './AtlasSelection'
import './place-atlas.css'

export default function PlaceAtlas({ userId, mobile = false, data, landmarks = [], onOpen }) {
  const photos = useMemo(() => atlasPhotos(data, landmarks), [data, landmarks])
  const insights = useMemo(() => atlasInsights(photos.located), [photos])
  const [selection, setSelection] = useState(null), [focusPlacements, setFocusPlacements] = useState({})
  const [sheetCollapsed, setSheetCollapsed] = useState(false)
  const storageKey = 'shitu-atlas-layout-v1' + (userId ? ':' + userId : '')
  const overviewCamera = useRef(null)
  const selected = selection ? insights[selection.kind === 'province' ? 'provinces' : selection.kind === 'city' ? 'cities' : 'places'].find(group => group.id === selection.id) : null
  const [zoom, setZoom] = useState(1), [size, setSize] = useState({ width: 1164, height: 900 }), [active, setActive] = useState(null)
  const [pan, setPan] = useState({ x: 0, y: 0 }), [panning, setPanning] = useState(false)
  const viewport = useRef(null), panGesture = useRef(null)
  const fittedScene = useRef(null)
  const [placements, setPlacements] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      return Object.fromEntries(['map', 'loose', 'unlocated'].map(scope => [scope, Object.fromEntries(Object.entries(saved?.[scope] || {}).filter(([, point]) => Number.isFinite(point?.x) && Number.isFinite(point?.y)))]))
    } catch { return { map: {}, loose: {}, unlocated: {} } }
  })
  function remember(scope, id, point) {
    setPlacements(previous => {
      const next = { ...previous, [scope]: { ...previous[scope], [id]: point } }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Layout stays usable when browser storage is unavailable. */ }
      return next
    })
  }
  const selectedIds = useMemo(() => new Set(selected?.items.map(item => item.photo.id) || []), [selected])
  const overviewLayout = useMemo(() => layoutAtlas(photos.located, placements.map).map((card, index) => ({ ...card, ordinal: index + 1 })), [photos, placements.map])
  const layout = useMemo(() => overviewLayout.map(card => selectedIds.has(card.photo.id) ? { ...card, ...focusPlacements[card.photo.id] } : card), [overviewLayout, selectedIds, focusPlacements])
  const sceneBounds = useMemo(() => atlasSceneBounds(overviewLayout), [overviewLayout])
  const photoSignature = photos.located.map(item => item.photo.id).join('|')
  // Moving a card changes content extents, not the camera. Fit again only when
  // photos enter/leave this scene or the user explicitly requests it.
  if (fittedScene.current?.signature !== photoSignature) fittedScene.current = { signature: photoSignature, bounds: sceneBounds }
  const fittedBounds = fittedScene.current.bounds
  const baseScale = Math.max(.04, Math.min(1, (size.width - 64) / fittedBounds.width, (size.height - 100) / fittedBounds.height))
  const scale = baseScale * zoom, compact = zoom < .75 && !selected
  const tilt = atlasTilt(zoom), projectPoint = point => projectAtlasPoint(point, tilt)
  const drag = useAtlasDrag(layout, scale, null, (id, point) => selected ? setFocusPlacements(previous => ({ ...previous, [id]: point })) : remember('map', id, point), onOpen, ATLAS_MAP_BOUNDS)
  const cards = drag.cards
  function returnOverview() {
    if (overviewCamera.current) { setZoom(overviewCamera.current.zoom); setPan(overviewCamera.current.pan) }
    setSelection(null); setFocusPlacements({}); setActive(null)
    overviewCamera.current = null
  }
  function selectGroup(group) {
    if (selected?.id === group.id && selected?.kind === group.kind) { returnOverview(); return }
    if (!selected) overviewCamera.current = { zoom, pan }
    const nextZoom = Math.max(1, zoom)
    setSheetCollapsed(false); setSelection({ id: group.id, kind: group.kind }); setFocusPlacements({}); setActive(null)
    setZoom(nextZoom)
    const point = projectAtlasPoint(group.point, atlasTilt(nextZoom))
    setPan({ x: (550 - point.x) * baseScale * nextZoom, y: (390 - point.y) * baseScale * nextZoom })
  }
  function fit() { fittedScene.current = { signature: photoSignature, bounds: sceneBounds }; setSelection(null); setFocusPlacements({}); overviewCamera.current = null; setZoom(1); setPan({ x: 0, y: 0 }) }
  useEffect(() => {
    if (!selected) return
    function escape(event) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open], [role="dialog"]')) returnOverview()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [selected])
  useEffect(() => {
    if (!globalThis.ResizeObserver) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = viewport.current
    function onWheel(event) {
      if (!event.deltaY) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight || 800 : 1
      setZoom(value => Math.max(.1, Math.min(4, value - event.deltaY * unit / 1200)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])
  function beginPan(event) {
    if (event.button !== 0 || event.target.closest('button,input,a,[role="button"]')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    panGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan }
    setPanning(true)
  }
  function movePan(event) {
    const gesture = panGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    setPan({ x: gesture.pan.x + event.clientX - gesture.x, y: gesture.pan.y + event.clientY - gesture.y })
  }
  function endPan(event) {
    if (panGesture.current?.pointerId !== event.pointerId) return
    panGesture.current = null
    setPanning(false)
  }
  function image(item) {
    return <JournalImage src={item.photo.url} alt={item.name || '旅行照片'} style={{ filter: imageFilter(item.photo.image_filter), objectPosition: `${item.photo.crop_x ?? 50}% 50%` }} />
  }
  function thread(item) {
    const point = projectPoint(item.point)
    const x = Math.max(item.x - item.width / 2, Math.min(item.x + item.width / 2, point.x))
    const y = Math.max(item.y - item.height / 2, Math.min(item.y + item.height / 2, point.y))
    return `M${point.x},${point.y} Q${(point.x + x) / 2},${point.y} ${x},${y}`
  }
  return <main className={"j-place-atlas" + (mobile && selected ? " has-mobile-selection" + (sheetCollapsed ? " is-sheet-collapsed" : "") : "")} aria-label="地点视图">
    <div className="j-atlas-heading"><div><MapPin /><h1>我的中国足迹</h1><span>{insights.provinces.length} 个省级地区 · {photos.located.length} 张照片</span></div><div className="j-atlas-zoom"><button className="j-icon-button" aria-label="缩小地点视图" disabled={zoom <= .1} onClick={() => setZoom(value => Math.max(.1, value - .25))}><Minus /></button><input type="range" min="10" max="400" step="1" value={Math.round(zoom * 100)} aria-label="快速缩放地点视图" aria-valuetext={`${Math.round(zoom * 100)}%`} onChange={event => setZoom(Number(event.target.value) / 100)} /><output>{Math.round(zoom * 100)}%</output><span className="j-atlas-angle" aria-label={`版图倾角 ${Math.round(tilt)} 度`}>{tilt < 1 ? '正视' : `倾斜 ${Math.round(tilt)}°`}</span><button className="j-button" onClick={fit}>适合窗口</button><button className="j-icon-button" aria-label="放大地点视图" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .25))}><Plus /></button></div></div>
    <div className={'j-atlas-viewport' + (panning ? ' is-panning' : '')} ref={viewport} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      <div className="j-atlas-world" style={{ transform: `translate3d(${size.width / 2 + pan.x}px,${size.height / 2 + pan.y - (mobile && selected ? (sheetCollapsed ? 45 : Math.min(size.height * .2, 140)) : 0)}px,0) scale(${scale}) translate(-550px,-390px)` }}><div className={'j-atlas-board' + (active ? ' has-active-photo' : '')}>
        <div className="j-atlas-map-surface" data-atlas-tilt={tilt.toFixed(2)} style={{ transform: `perspective(${ATLAS_PERSPECTIVE}px) rotateX(${tilt}deg) scale(${ATLAS_MAP_SCALE})` }}>
        <svg className="j-atlas-map" viewBox="0 0 1100 800" role="group" aria-label="中国地图行政区划">
          <g className="j-atlas-land-depth" transform={`translate(0,${tilt / 6})`}>{chinaPaths.map((path, i) => <path key={i} d={path} />)}</g>
          <g className="j-atlas-land">{chinaPaths.map((path, i) => <path key={i} d={path} />)}</g>
          <AtlasMapLayers layer="provinces" insights={insights} selected={selected} onSelect={selectGroup} />
        </svg></div>
        <svg className="j-atlas-map j-atlas-overlay" viewBox="0 0 1100 800" role="group" aria-label="照片地点与连接线">
          <AtlasMapLayers layer="pins" projectPoint={projectPoint} insights={insights} groups={compact ? insights.cities : insights.places} selected={selected} active={active} compact={compact} scale={scale} onSelect={selectGroup}>
            {!compact && cards.map(item => <g key={item.photo.id} className={selected && !selectedIds.has(item.photo.id) ? 'is-muted' : ''}>
              <path className="j-atlas-thread-halo" d={thread(item)} />
              <path data-atlas-thread={item.photo.id} style={{ '--atlas-thread-color': item.pinColor || item.province?.pinColor }} className={'j-atlas-thread ' + (active === item.photo.id ? 'is-active' : '') + (selected && !selectedIds.has(item.photo.id) ? ' is-muted' : '')} d={thread(item)} />
            </g>)}
          </AtlasMapLayers>
        </svg>
        <div className="j-atlas-map-label" style={{ top: projectPoint({ x: 550, y: 555 }).y + 24 }}><MapPin /><span>我的中国足迹</span><small>一张照片，一处牵挂</small></div>
        {!compact && cards.map(item => <button key={item.photo.id} data-atlas-photo={item.photo.id} className={'j-atlas-photo ' + (active === item.photo.id ? 'is-active' : '') + (drag.dragging === item.photo.id ? ' is-dragging' : '') + (selected && !selectedIds.has(item.photo.id) ? ' is-muted' : '')} style={{ left: item.x - item.width / 2, top: item.y - item.height / 2, width: item.width, height: item.height, transform: `rotate(${item.rotation || 0}deg)` }} aria-label={`打开照片：${item.name || '照片地点'} ${item.ordinal}`} aria-hidden={selected && !selectedIds.has(item.photo.id) ? true : undefined} tabIndex={selected && !selectedIds.has(item.photo.id) ? -1 : 0} title={item.locationHint ? `${item.name} · ${item.locationHint}` : undefined} {...drag.bind(item)} onMouseEnter={() => setActive(item.photo.id)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(item.photo.id)} onBlur={() => setActive(null)}>{image(item)}<span><MapPin />{item.name || '照片地点'}</span><small>{String(item.ordinal).padStart(2, '0')}</small></button>)}
        {!cards.length && <p className="j-atlas-no-pins">给照片添上地点，让回忆在这里落脚。</p>}
      </div><div className={'j-atlas-extras' + (selected ? ' is-muted' : '')} style={{ top: sceneBounds.bottom + 60 }} inert={selected ? true : undefined} aria-hidden={selected ? true : undefined}>
        <AtlasScatter embedded items={photos.loose} title="还没写地点的回忆" subtitle="拖动空白处浏览画布，点开照片补充地点。" scale={scale} saved={placements.loose} onPlace={(id, point) => remember('loose', id, point)} onOpen={onOpen} />
        <AtlasScatter embedded items={photos.unlocated} title="等待落脚的地点" subtitle="拖动照片自由整理，点开后可以补充地点。" scale={scale} saved={placements.unlocated} onPlace={(id, point) => remember('unlocated', id, point)} onOpen={onOpen} />
      </div></div>
    </div>
    {selected && <AtlasSelection mobile={mobile} collapsed={sheetCollapsed} onToggle={() => setSheetCollapsed(value => !value)} group={selected} items={selected.items} onClose={returnOverview} onOpen={onOpen} />}
    <div className="j-atlas-pagination"><span>{compact ? '城市总览 · 点击城市展开照片' : mobile ? '全部照片同屏排布 · 拖动地图浏览' : '滚轮放大并立起版图 · 拖动平移 · 点击 PIN 聚焦'}{photos.loose.length + photos.unlocated.length > 0 ? ' · 下方还有待整理的回忆' : ''}</span>{!compact && photos.located.length > 0 && <div className="j-atlas-photo-count">{selected ? `${selected.count} 张地点照片` : `全部 ${photos.located.length} 张照片`}</div>}</div>
  </main>
}
