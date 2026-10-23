import { useState } from 'react'
import Modal from './Modal'
import { PALETTES } from './model'

const labels = { sage: '鼠尾草绿', sand: '暖沙色', sky: '天空蓝', rose: '玫瑰粉', lavender: '薰衣草紫' }
export default function CanvasGroupEditor({ group, positions, onSave, onDelete, onClose }) {
  const [name, setName] = useState(group?.name || '一组回忆'), [color, setColor] = useState(group?.color || 'sage')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onSave(group?.id, { name, color, ...(!group ? { positions } : {}) }); onClose() }
    catch (error) { setError(error.message); setBusy(false) }
  }
  async function dissolve() {
    setBusy(true); setError('')
    try { await onDelete(group.id); onClose() }
    catch (error) { setError(error.message); setBusy(false) }
  }
  return <Modal title={group ? '编辑色块分组' : '添加色块分组'} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="j-group-editor">
      <label>组名<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <fieldset disabled={busy}><legend>色块颜色</legend><div className="j-group-colors">{PALETTES.map(value => <button key={value} type="button" data-color={value} aria-label={labels[value]} aria-pressed={color === value} onClick={() => setColor(value)} />)}</div></fieldset>
      <p>{group ? '拖动色块标题可移动全部内层色块和照片。解除分组只拆掉这一层，保留内层色块和照片。' : `为选中的 ${positions.length} 张照片添加外层色块，已有色块会完整保留，可继续嵌套分组。`}</p>
      {error && <p role="alert">{error}</p>}
      <div className="j-group-actions">{group && <button type="button" className="j-button j-danger" disabled={busy} onClick={dissolve}>解除分组</button>}<button type="button" className="j-button" disabled={busy} onClick={onClose}>取消</button><button className="j-button j-primary" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存分组'}</button></div>
    </form>
  </Modal>
}
