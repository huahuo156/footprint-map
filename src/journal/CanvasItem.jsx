import { Check, StickyNote } from 'lucide-react'
import JournalImage from './JournalImage'
import MemoryComponents from './MemoryComponents'
import MarkContent from './MarkContent'
import { hasComponentContent } from './components'
import { imageFilter } from './model'

export default function CanvasItem({ item, trips = [], selected = false, selecting = false, onPointerDown, onOpen, onToggle, onImageLoad, nodeRef, style, componentLimit = 2, fullSize = false }) {
  return <button ref={nodeRef} data-photo-id={item.id} data-kind={item.kind} aria-pressed={selecting ? selected : undefined} className={(item.kind === 'mark' ? 'j-canvas-mark' : 'j-photo ' + (item.kind === 'entry' ? 'j-note-card' : '') + (item.kind === 'photo' && item.entry.components != null && !item.entry.components.some(hasComponentContent) ? ' is-bare' : '')) + (selected ? ' is-selected' : '')} data-color={item.color} style={{ transform: `translate3d(${item.x}px,${item.y}px,0) translate(-50%,-50%) rotate(${item.rotation || 0}deg)${item.contentScale ? ` scale(${item.contentScale})` : ''}`, ...(['mark', 'photo'].includes(item.kind) || item.contentScale ? { width: item.width / (item.contentScale || 1), height: item.height / (item.contentScale || 1) } : {}), ...style }} onPointerDown={event => onPointerDown?.(event, item)} onClick={event => { if (event.detail === 0) { if (selecting) onToggle?.(item.id); else onOpen?.(item.entry, item.kind === 'photo' ? item.id : null) } }} aria-label={item.kind === 'mark' ? `编辑${item.entry.mark.kind === 'text' ? '文字标注' : '贴纸'}` : `查看${item.entry.place_name || item.entry.title || '旅行记忆'}`}>
    {selecting && <span className="j-photo-selection" aria-hidden="true">{selected && <Check />}</span>}
    {item.kind === 'mark' ? <MarkContent mark={item.entry.mark} /> : <>{item.kind === 'photo' ? <JournalImage fullSize={fullSize} src={item.url} onLoad={event => onImageLoad?.(event, item)} alt={item.entry.place_name || '旅行照片'} style={{ height: item.imageHeight, objectFit: 'contain', objectPosition: `${item.crop_x}% 50%`, filter: imageFilter(item.image_filter) }} /> : <div className="j-note-content"><StickyNote />{item.entry.components != null ? <MemoryComponents entry={item.entry} trips={trips} compact limit={componentLimit === Infinity ? Infinity : 4} /> : <p>{item.entry.caption || item.entry.title}</p>}</div>}
    {item.entry.components != null ? item.kind === 'photo' && <MemoryComponents entry={item.entry} trips={trips} compact limit={componentLimit} /> : <><span className="j-photo-label"><span>{item.entry.place_name || item.entry.title || '随手记'}</span><small>{item.entry.entry_date.slice(5).replace('-', '.')}</small></span><span className="j-photo-caption">{item.kind === 'photo' ? item.entry.caption : ''}</span></>}</>}
  </button>
}
