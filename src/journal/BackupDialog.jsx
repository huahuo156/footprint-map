import { useRef, useState } from 'react'
import { ArchiveRestore, Download, Save } from 'lucide-react'
import Modal from './Modal'
import { localDate } from './model'

// 手帐备份：导出 ZIP（照片 + 数据），或把之前的备份合并还原回来。
export default function BackupDialog({ onClose, onRestored }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('')
  const fileInput = useRef(null)
  async function exportBackup() {
    setBusy(true); setError(''); setResult('')
    try {
      const response = await fetch('/api/journal/backup')
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '暂时连不上手帐，请确认后端已启动。')
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
      link.href = url; link.download = `shitu-backup-${localDate()}.zip`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      const missing = Number(response.headers.get('X-Backup-Missing-Files') || 0)
      setResult(missing ? `备份已下载，但有 ${missing} 个原始图片文件已缺失，清单已记入 backup.json。请补回这些文件后重新备份，当前备份无法完整还原。` : '备份已开始下载。里面有全部照片和手帐数据，请和重要文件一起妥善保存。')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  async function restore(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 1024 * 1024 * 1024) { setError('备份文件不能超过 1GB。'); return }
    if (!/\.zip$/i.test(file.name)) { setError('请选择导出备份时下载的 .zip 文件。'); return }
    if (!window.confirm('还原会把备份里的照片、旅程和手札合并到当前手帐，现有内容全部保留。要继续吗？')) return
    setBusy(true); setError(''); setResult('')
    try {
      const body = new FormData(); body.append('backup', file)
      const response = await fetch('/api/journal/restore', { method: 'POST', body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '还原失败，请重试。')
      const counts = data.restored || {}
      setResult(`已还原 ${counts.photos ?? 0} 张照片、${counts.entries ?? 0} 条记录、${counts.marks ?? 0} 个标注、${counts.notebooks ?? 0} 本手札。现有内容没有变化。`)
      await onRestored?.()
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <Modal title="备份与还原" onClose={onClose} busy={busy} className="j-backup">
    <section className="j-backup-section">
      <h3><Save />导出备份</h3>
      <p>打包全部照片、旅程、记录、标注和手札，下载成一个 ZIP 文件。备份不含示例手帐。</p>
      <button type="button" className="j-button j-primary" disabled={busy} onClick={exportBackup}><Download />导出备份文件</button>
    </section>
    <section className="j-backup-section">
      <h3><ArchiveRestore />从备份还原</h3>
      <p>选择之前导出的 ZIP（最多 1GB），备份内容会作为新内容合并进来；现在手帐里的东西一律保留。重复还原会生成多份副本。</p>
      <button type="button" className="j-button" disabled={busy} onClick={() => fileInput.current.click()}><ArchiveRestore />选择备份文件还原</button>
      <input ref={fileInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="j-visually-hidden" aria-label="选择备份文件" onChange={restore} />
    </section>
    {result && <p className="j-composer-hint" role="status">{result}</p>}
    {error && <p className="j-error" role="alert">{error}</p>}
  </Modal>
}
