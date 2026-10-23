import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react'
import MarkContent from './MarkContent'
import JournalImage from './JournalImage'
import MemoryComponents from './MemoryComponents'
import { dayLabel, groupByDay, imageFilter, localDate, placeColor } from './model'

export default function MobileFeed({ data, onOpen, onNew }) {
  const days = useMemo(() => groupByDay(data.entries), [data.entries])
  const [selected, setSelected] = useState(days[0]?.date || localDate()), refs = useRef(new Map())
  useEffect(() => { if (days[0]) setSelected(days[0].date) }, [days[0]?.date])
  const selectedDate = new Date(selected + 'T12:00:00'), start = new Date(selectedDate)
  start.setDate(start.getDate() - start.getDay())
  function moveWeek(direction) { const date = new Date(selectedDate); date.setDate(date.getDate() + direction * 7); setSelected(localDate(date)) }
  return <main className="j-mobile-content">
    <header className="j-mobile-title"><div><span>拾途 · 随身手帐</span><h1>旅途的日子</h1></div><button className="j-icon-button" aria-label="留下一刻" onClick={onNew}><Plus /></button></header>
    <div className="j-week-heading"><button className="j-icon-button" aria-label="上一周" onClick={() => moveWeek(-1)}><ChevronLeft /></button><span>{selectedDate.getFullYear()} 年 {selectedDate.getMonth() + 1} 月</span><button className="j-icon-button" aria-label="下一周" onClick={() => moveWeek(1)}><ChevronRight /></button></div>
    <div className="j-week" aria-label="按日期浏览回忆">{Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const key = localDate(date), entry = days.find(day => day.date === key)?.entries[0]; return <button key={key} aria-pressed={selected === key} aria-label={`${date.getMonth() + 1}月${date.getDate()}日${entry ? '，有记录' : ''}`} onClick={() => { setSelected(key); refs.current.get(key)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) }}><span>{'日一二三四五六'[index]}</span><strong>{date.getDate()}</strong><i data-has-entry={!!entry} data-color={entry ? placeColor(entry.place_name) : 'sage'} /></button> })}</div>
    <div className="j-mobile-feed">{days.map(day => <section key={day.date} ref={element => { if (element) refs.current.set(day.date, element); else refs.current.delete(day.date) }} className="j-memory-day" data-color={placeColor(day.entries[0].place_name, data.trips.find(trip => trip.id === day.entries[0].trip_id)?.color)}>
      <header><span className="j-day-dot" />{dayLabel(day.date)}<small>{day.entries.reduce((sum, entry) => sum + entry.photos.length, 0)} 张照片</small></header>
      {day.entries.map(entry => <article className="j-memory-entry" key={entry.id}>{entry.photos.length > 0 && <div className={'j-memory-images ' + (entry.photos.length > 1 ? 'has-many' : '')}>{entry.photos.slice(0, 4).map((photo, index) => <button key={photo.id} onClick={() => onOpen(entry, photo.id)} aria-label={`查看${entry.place_name || '旅行'}照片${index + 1}`}><JournalImage src={photo.url} alt={entry.place_name || entry.caption || '旅行照片'} style={{ objectPosition: `${photo.crop_x}% 50%`, filter: imageFilter(photo.image_filter) }} />{entry.photos.length > 4 && index === 3 && <span className="j-more-photos">＋{entry.photos.length - 4}</span>}</button>)}</div>}
        <button className={'j-memory-text ' + (entry.mark ? 'j-mobile-mark' : '')} data-mark-id={entry.mark?.id} aria-label={entry.mark ? `编辑${entry.mark.kind === 'text' ? '文字标注' : '贴纸'}` : undefined} onClick={() => onOpen(entry, entry.photos[0]?.id)}>{entry.mark ? <MarkContent mark={entry.mark} /> : entry.components != null ? <MemoryComponents entry={entry} trips={data.trips} hideDate /> : <>{entry.place_name && <span className="j-place"><MapPin />{entry.place_name}</span>}{entry.title && entry.title !== entry.place_name && entry.title !== entry.caption && <h2>{entry.title}</h2>}<p>{entry.caption || '留住这一天。'}</p></>}</button>
      </article>)}
    </section>)}</div>
    <button className="j-button j-primary j-mobile-add" onClick={onNew}><Plus />留下一刻</button>
    <p className="j-feed-end">不用刻意记录，想起来就留一笔。</p>
  </main>
}
