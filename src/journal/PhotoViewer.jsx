import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, MapPin, Pencil, Trash2 } from 'lucide-react'
import Modal from './Modal'
import JournalImage from './JournalImage'
import MemoryComponents from './MemoryComponents'
import { imageFilter, isWestLake } from './model'

export default function PhotoViewer({ selection, data, onClose, onEdit, onDelete, onScene, demo, mobile }) {
  const entry = data.entries.find(item => item.id === selection.entryId)
  const [photoId, setPhotoId] = useState(selection.photoId), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const all = data.entries.filter(item => item.trip_id === entry?.trip_id).flatMap(item => item.photos.map(photo => ({ ...photo, entry: item })))
  const photo = all.find(item => item.id === photoId)
  const current = photo?.entry || entry, trip = data.trips.find(item => item.id === current?.trip_id)
  const index = all.findIndex(item => item.id === photoId)
  function step(direction) { if (all.length > 1) { setPhotoId(all[(index + direction + all.length) % all.length].id); setConfirm(false); setError('') } }
  useEffect(() => {
    const keydown = event => { if (event.target.closest('input,textarea') || busy) return; if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) } if (event.key === 'ArrowRight') { event.preventDefault(); step(1) } }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  if (!current) return null
  async function remove() {
    setBusy(true); setError('')
    try { await onDelete(current, photo?.id); onClose() } catch (error) { setError(error.message); setBusy(false) }
  }
  return <Modal title={current.components != null ? '这一刻' : trip?.name || '旅行记忆'} onClose={onClose} className="j-viewer" busy={busy}>
    {current.components == null && <div className="j-viewer-date">{current.entry_date.replaceAll('-', ' / ')}</div>}
    {photo && <div className="j-viewer-photo"><JournalImage key={photo.id} src={photo.url} alt={current.place_name || current.caption || '旅行照片'} loading="eager" style={{ filter: imageFilter(photo.image_filter) }} /></div>}
    <div className={'j-viewer-copy ' + (!photo ? 'is-note' : '')}>
      {current.components != null ? <MemoryComponents entry={current} trips={data.trips} /> : <>{current.place_name && <div className="j-place"><MapPin />{current.place_name}</div>}
      {current.title && current.title !== current.place_name && current.title !== current.caption && <h3>{current.title}</h3>}
      <p>{current.caption || '留住这一天。'}</p></>}
    </div>
    <footer className="j-viewer-footer"><div className="j-viewer-pagination">{photo && <><button className="j-icon-button" type="button" aria-label="上一张照片" disabled={all.length < 2 || busy} onClick={() => step(-1)}><ChevronLeft /></button><span aria-live="polite">{index + 1} / {all.length}</span><button className="j-icon-button" type="button" aria-label="下一张照片" disabled={all.length < 2 || busy} onClick={() => step(1)}><ChevronRight /></button></>}</div><div className="j-viewer-actions">
      {!demo && <><button className="j-button j-quiet" disabled={busy} onClick={() => onEdit(current, photo?.id)}><Pencil />编辑</button><button className="j-icon-button j-danger" disabled={busy} aria-label={photo ? '删除这张照片' : '删除这段记忆'} onClick={() => setConfirm(true)}><Trash2 /></button></>}
      {!mobile && isWestLake(current) && <button className="j-button j-primary" disabled={busy} onClick={() => onScene(trip?.id || '__loose__')}>走进西湖 3D</button>}
    </div></footer>
    {confirm && <div className="j-delete-confirm" role="alert"><p>{photo ? '删除这张照片和为它添加的内容？其他照片会保留。' : '删除这段记忆？'}</p><button className="j-button" disabled={busy} onClick={() => setConfirm(false)}>保留</button><button className="j-button j-destructive" disabled={busy} onClick={remove}>{busy ? '正在删除…' : '确认删除'}</button></div>}
    {error && <p className="j-error" role="alert">{error}</p>}
  </Modal>
}
