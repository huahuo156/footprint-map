import { useEffect, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import Modal from './Modal'
import MarkContent from './MarkContent'
import { MARK_COLORS, MARK_SIZES, STICKERS, STICKER_LABELS, markDimensions } from '../../shared/journal-marks'

export default function MarkEditor({ mark, initialKind = 'text', position, onSave, onDelete, onClose, embedded = false, onBusyChange }) {
  const [kind, setKind] = useState(mark?.kind || initialKind), [text, setText] = useState(mark?.text || ''), [sticker, setSticker] = useState(mark?.sticker || 'leaf')
  const [color, setColor] = useState(mark?.color || 'ink'), [size, setSize] = useState(mark?.size || 'medium'), [rotation, setRotation] = useState(mark?.rotation || 0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false)
  const values = { kind, text, sticker, color, size, rotation }
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onSave(mark?.id, { ...values, canvas_x: position?.x ?? 0, canvas_y: position?.y ?? 0 }); onClose() } catch (error) { setError(error.message); setBusy(false) }
  }
  async function remove() {
    setBusy(true); setError('')
    try { await onDelete(mark.id); onClose() } catch (error) { setError(error.message); setBusy(false) }
  }
  const content = <form onSubmit={submit}><fieldset disabled={busy}>
      {!embedded && <div className="j-mark-tabs" aria-label="标注类型">{[['text', '文字'], ['sticker', '贴纸']].map(([key, label]) => <button type="button" key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>)}</div>}
      {kind === 'text' ? <label className="j-mark-text-label">想写什么？<textarea autoFocus={!embedded} maxLength={500} rows={3} placeholder="一个念头，一句感想，或给照片写个小注脚……" value={text} onChange={event => setText(event.target.value)} /></label> : <div className="j-sticker-picker" aria-label="选择贴纸">{STICKERS.map(key => <button type="button" key={key} aria-label={STICKER_LABELS[key] + '贴纸'} aria-pressed={sticker === key} onClick={() => setSticker(key)}><MarkContent mark={{ kind: 'sticker', sticker: key, color }} /><small>{STICKER_LABELS[key]}</small></button>)}</div>}
      <div className="j-mark-options"><div className="j-mark-color-options" data-kind={kind} aria-label="标注颜色">{MARK_COLORS.map((key, index) => <button key={key} type="button" data-mark-color={key} aria-label={['墨色', '苔绿', '暖棕', '湖蓝', '玫瑰', '浅紫'][index]} aria-pressed={color === key} onClick={() => setColor(key)} />)}</div><div className="j-mark-sizes" aria-label="标注大小">{MARK_SIZES.map((key, index) => <button key={key} type="button" aria-pressed={size === key} onClick={() => setSize(key)}>{['小', '中', '大'][index]}</button>)}</div></div>
      <label className="j-mark-angle">随意转一点<span>{rotation}°</span><input aria-label="标注角度" type="range" min="-20" max="20" value={rotation} onChange={event => setRotation(Number(event.target.value))} /></label>
      <div className="j-mark-preview" aria-label="标注预览"><div style={{ width: markDimensions(values).width, transform: `rotate(${rotation}deg)` }}><MarkContent mark={{ ...values, text: text || '走走停停，也很好。' }} /></div></div>
      {error && <p className="j-error" role="alert">{error}</p>}
      {confirm ? <div className="j-delete-confirm" role="alert"><p>拿掉这张标注？</p><button className="j-button" type="button" onClick={() => setConfirm(false)}>保留</button><button className="j-button j-destructive" type="button" onClick={remove}>确认删除</button></div> : <footer className="j-mark-footer">{mark && <button className="j-icon-button j-danger" type="button" aria-label="删除标注" onClick={() => setConfirm(true)}><Trash2 /></button>}<button className="j-button" type="button" onClick={onClose}>取消</button><button className="j-button j-primary" type="submit" disabled={kind === 'text' && !text.trim()}><Check />{busy ? '正在保存…' : mark ? '保存标注' : '放到手帐里'}</button></footer>}
    </fieldset></form>
  return embedded ? content : <Modal title={mark ? '整理这张标注' : kind === 'text' ? '随手写一句' : '贴上一点心情'} onClose={onClose} busy={busy} className="j-mark-editor">{content}</Modal>
}
