import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import JournalImage from './JournalImage'
import MarkContent from './MarkContent'

export default function BatchItemDelete({ items, onDelete, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const photos = items.filter(item => item.kind === 'photo').length
  const stickers = items.filter(item => item.kind === 'mark' && item.entry.mark.kind === 'sticker').length
  const texts = items.length - photos - stickers
  const summary = [photos && `${photos} 张照片`, texts && `${texts} 段文字`, stickers && `${stickers} 张贴纸`].filter(Boolean).join('、')
  async function remove() {
    setBusy(true); setError('')
    try { await onDelete(items.map(({ id, kind }) => ({ id, kind }))); onClose() } catch (error) { setError(error.message); setBusy(false) }
  }
  return <Modal title={`删除 ${items.length} 项内容？`} busy={busy} onClose={onClose} className="j-batch-delete">
    <div className="j-batch-preview">{items.slice(0, 5).map(item => item.kind === 'photo' ? <JournalImage key={item.id} src={item.url} alt="将删除的照片" /> : <span key={item.id} className="j-delete-item-preview">{item.kind === 'mark' ? <MarkContent mark={item.entry.mark} /> : item.entry.caption || item.entry.title || '文字'}</span>)}{items.length > 5 && <span>＋{items.length - 5}</span>}</div>
    <p>选中了 {summary}。确认后删除，无法撤销。</p><p className="j-quiet">未选中的内容会保留。</p>
    {error && <p role="alert" className="j-error">{error}</p>}
    <footer className="j-mark-footer"><button type="button" className="j-button" disabled={busy} onClick={onClose}>保留内容</button><button type="button" className="j-button j-destructive" disabled={busy} onClick={remove}><Trash2 />{busy ? '正在删除…' : `确认删除 ${items.length} 项`}</button></footer>
  </Modal>
}
