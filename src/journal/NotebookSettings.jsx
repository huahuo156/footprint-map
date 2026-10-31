import { useEffect, useState } from 'react'
import Modal from './Modal'
import JournalImage from './JournalImage'
import NotebookCover from './NotebookCover'
import { NOTEBOOK_COVERS, COVER_COLORS } from '../../shared/notebook-covers'
import { captureApiSession, uploadNotebookCover, discardNotebookCover } from '../lib/api'

const options = [['photo', '内置摄影'], ['upload', '自定义上传'], ['solid', '纯色'], ['text', '纯文字']]
export default function NotebookSettings({ book, position, onSave, onDelete, onClose }) {
  const [name, setName] = useState(book?.name || ''), [cover, setCover] = useState(book?.cover_url || NOTEBOOK_COVERS[0]?.url || null)
  const [uploadedCover] = useState(book?.cover_url?.startsWith('/uploads/') ? book.cover_url : null)
  const [kind, setKind] = useState(book?.cover_mode && book.cover_mode !== 'photo' ? book.cover_mode : book?.cover_url?.startsWith('/uploads/') ? 'upload' : 'photo')
  const [color, setColor] = useState(book?.cover_color || COVER_COLORS[0])
  const [coverLabel, setCoverLabel] = useState(book?.cover_label ?? 'MEMO'), [coverText, setCoverText] = useState(book?.cover_text ?? '')
  const [file, setFile] = useState(null), [localPreview, setLocalPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!file) { setLocalPreview(null); return }
    const url = URL.createObjectURL(file); setLocalPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const mode = kind === 'upload' ? 'photo' : kind
  const visibleCover = mode === 'photo' ? kind === 'upload' ? localPreview || uploadedCover : cover : null
  async function save(event) {
    const guard = captureApiSession()
    event.preventDefault(); setBusy(true); setError('')
    let uploaded
    try {
      let url = visibleCover
      if (kind === 'upload' && file) { uploaded = (await uploadNotebookCover(file)).url; url = uploaded }
      if (mode === 'photo' && !url) throw new Error('请先选择一张封面照片。')
      guard()
      await onSave(book?.id, { name: name.trim(), cover_url: mode === 'photo' ? url : null, cover_mode: mode, cover_color: color, cover_label: coverLabel.trim(), cover_text: coverText.trim(), ...(book ? {} : { canvas_x: position.x, canvas_y: position.y }) })
      onClose()
    } catch (error) {
      if (uploaded && error.name !== 'AbortError') { guard(); await discardNotebookCover(uploaded).catch(() => {}) }
      setError(error.message)
    } finally { setBusy(false) }
  }
  function chooseFile(event) {
    const chosen = event.target.files?.[0]
    if (!chosen) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) || !chosen.size || chosen.size > 10 * 1024 * 1024) { setError('请选择不超过 10MB 的 JPG、PNG 或 WebP 图片。'); event.target.value = ''; return }
    setError(''); setFile(chosen)
  }
  return <Modal title={book ? '名称与封面' : '创建主题手帐'} busy={busy} onClose={onClose} className="nb-cover-settings">
    <form className="nb-settings" onSubmit={save}><fieldset disabled={busy} className="nb-settings-fields">
      <label>手札名称<input autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="例如：日常碎碎念" /></label>
      <label>封面字样<input maxLength={60} value={coverLabel} onChange={e => setCoverLabel(e.target.value)} placeholder="留空可隐藏字样" /></label>
      <div className="nb-settings-label-options" aria-label="常用封面字样">{['MEMO', 'JOURNAL', 'TRAVEL JOURNAL', 'NOTES'].map(label => <button key={label} type="button" aria-pressed={coverLabel === label} onClick={() => setCoverLabel(label)}>{label}</button>)}</div>
      <label>封面寄语<textarea maxLength={500} rows={3} value={coverText} onChange={e => setCoverText(e.target.value)} placeholder="写下想留在封面上的话" /></label>
      <div><p>封面</p><div className="nb-cover-types" role="tablist" aria-label="封面类型">{options.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={kind === id} aria-controls="nb-cover-picker" id={'nb-cover-type-' + id} onClick={() => { setKind(id); setError(''); if (id === 'photo' && !NOTEBOOK_COVERS.some(c => c.url === cover)) setCover(NOTEBOOK_COVERS[0]?.url || null) }}>{label}</button>)}</div>
        <div id="nb-cover-picker" role="tabpanel" aria-labelledby={'nb-cover-type-' + kind}>
          {kind === 'photo' && <div className="nb-photo-library">{NOTEBOOK_COVERS.map(photo => <div key={photo.id}><button type="button" className="nb-photo-choice" aria-label={photo.name} aria-pressed={cover === photo.url} onClick={() => setCover(photo.url)}><JournalImage src={photo.url} alt={photo.name} /><span>{photo.name}</span></button><a href={photo.source} target="_blank" rel="noreferrer">{photo.photographer}</a></div>)}</div>}
          {kind === 'upload' && <label className="nb-cover-upload">上传封面图片<input type="file" aria-label="上传封面图片" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} /><small>JPG、PNG、WebP，最多 10MB。仅用于封面。</small></label>}
          {kind === 'solid' && <div className="nb-cover-colors">{COVER_COLORS.map(value => <button key={value} type="button" aria-label={'封面颜色 ' + value} aria-pressed={color === value} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}<label>自定义颜色<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label></div>}
          {kind === 'text' && <p className="nb-cover-mode-hint">以名称和文字为封面，保留干净的纸面。</p>}
        </div>
      </div>
    </fieldset><aside className="nb-cover-preview-area"><div className="nb-cover-preview" aria-label="封面预览"><NotebookCover book={{ name: name.trim() || '手札名称', cover_url: visibleCover, cover_label: coverLabel.trim(), cover_text: coverText.trim(), cover_mode: mode, cover_color: color }} /></div></aside>
      {error && <p className="j-error" role="alert">{error}</p>}
      <div className="j-editor-actions">{book && <button type="button" className="j-button j-danger" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(book.id); onClose() } catch (e) { setError(e.message) } finally { setBusy(false) } }}>解除手札，保留内容</button>}<button className="j-button j-primary" disabled={busy}>{busy ? '正在保存…' : '保存手札'}</button></div>
    </form>
  </Modal>
}
