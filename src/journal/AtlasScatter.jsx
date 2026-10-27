import { useMemo, useRef, useState } from 'react'
import JournalImage from './JournalImage'
import { cardBounds, imageFilter } from './model'
import { layoutScatter, settleAtlasPosition } from './atlasLayout'

export function useAtlasDrag(cards, scale, bounds, onPlace, onOpen, avoidMap = false) {
  const drag = useRef(null), suppressedClick = useRef(null)
  const [moving, setMoving] = useState(null)
  const display = cards.map(card => moving?.id === card.photo.id ? { ...card, ...moving.point } : card)
  function finish(event, cancel = false) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    if (state.moved) {
      suppressedClick.current = state.card.photo.id
      if (!cancel) onPlace(state.card.photo.id, settleAtlasPosition(state.card, cards.filter(card => card.photo.id !== state.card.photo.id), state.point, bounds, avoidMap))
    }
    setMoving(null)
  }
  function bind(card) {
    return {
      onPointerDown: event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { card, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, point: { x: card.x, y: card.y }, moved: false }
      },
      onPointerMove: event => {
        const state = drag.current
        if (!state || state.pointerId !== event.pointerId) return
        const dx = event.clientX - state.startX, dy = event.clientY - state.startY
        if (!state.moved && Math.hypot(dx, dy) < 4) return
        state.moved = true
        const box = cardBounds(state.card, 20)
        state.point = bounds ? { x: Math.max(box.w / 2 + 8, Math.min(bounds.width - box.w / 2 - 8, state.card.x + dx / scale)), y: Math.max(box.h / 2 + 8, Math.min(bounds.height - box.h / 2 - 8, state.card.y + dy / scale)) } : { x: state.card.x + dx / scale, y: state.card.y + dy / scale }
        setMoving({ id: state.card.photo.id, point: state.point })
      },
      onPointerUp: event => finish(event),
      onPointerCancel: event => finish(event, true),
      onClick: event => {
        if (event.detail !== 0 && suppressedClick.current === card.photo.id) { suppressedClick.current = null; return }
        suppressedClick.current = null
        onOpen(card.entry, card.photo.id)
      },
    }
  }
  return { cards: display, bind, dragging: moving?.id }
}

export default function AtlasScatter({ items, title, subtitle, scale, saved, onPlace, onOpen, embedded = false }) {
  const [sizes, setSizes] = useState({})
  const layout = useMemo(() => layoutScatter(items, sizes, saved, embedded), [items, sizes, saved, embedded])
  const displayScale = embedded ? 1 : scale
  const height = Math.max(380, ...layout.map(card => card.y + cardBounds(card).h / 2 + 45))
  const bounds = { width: 1100, height: Math.max(height, 600 + Math.ceil(items.length / 3) * 340) }
  const drag = useAtlasDrag(layout, scale, embedded ? null : bounds, onPlace, onOpen)
  if (!items.length) return null
  return <section className="j-atlas-shelf"><header><h2>{title}<span>{items.length} 张</span></h2><p>{subtitle}</p></header>
    <div className="j-atlas-scatter-viewport"><div className="j-atlas-scatter-space" style={{ width: 1100 * displayScale, height: height * displayScale }}><div className="j-atlas-scatter" style={{ height, transform: `scale(${displayScale})` }}>
      {drag.cards.map(card => <button key={card.photo.id} data-atlas-photo={card.photo.id} className={'j-atlas-loose-photo ' + (drag.dragging === card.photo.id ? 'is-dragging' : '')} style={{ left: card.x, top: card.y, width: card.width, height: card.height, transform: `translate(-50%,-50%) rotate(${card.rotation}deg)` }} aria-label={`打开照片：${card.name || '旅行照片'}`} {...drag.bind(card)}>
        <JournalImage src={card.photo.url} alt={card.name || '旅行照片'} style={{ filter: imageFilter(card.photo.image_filter), height: card.height - 20 - (card.name ? 30 : 0) }} onLoad={event => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget
          if (width && height) setSizes(previous => previous[card.photo.id]?.width === width && previous[card.photo.id]?.height === height ? previous : { ...previous, [card.photo.id]: { width, height } })
        }} />
        {card.name && <span>{card.name}</span>}
      </button>)}
    </div></div></div>
  </section>
}
