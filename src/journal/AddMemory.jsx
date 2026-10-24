import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Sticker, Type, Images } from 'lucide-react'
import Modal from './Modal'
import EntryEditor from './EntryEditor'
import MarkEditor from './MarkEditor'

const kinds = [['photo', '照片', ImagePlus], ['text', '文字', Type], ['sticker', '贴纸', Sticker]]
export default function AddMemory({ preset, position, trips, onSave, onSaveMark, onImport, onCreateTrip, onClose }) {
  const [kind, setKind] = useState('photo'), [editorBusy, setBusy] = useState(false), panes = useRef(null), importInput = useRef(null)
  const [importing, setImporting] = useState(false), [progress, setProgress] = useState(null), [importError, setImportError] = useState(''), [remaining, setRemaining] = useState([])
  const [report, setReport] = useState(null)
  const busy = editorBusy || importing
  async function importFiles(files, retry = false) {
    if (!files.length) return
    const previous = retry ? report : null
    const combine = result => ({ importedCount: (previous?.importedCount || 0) + (result.importedCount || 0), rejectedFiles: [...(previous?.rejectedFiles || []), ...(result.rejectedFiles || [])] })
    setImporting(true); setImportError(''); setRemaining([]); setReport(null); setProgress(null)
    try {
      const result = combine(await onImport(files, position, setProgress))
      if (!result.rejectedFiles.length) onClose()
      else setReport(result)
    } catch (error) {
      const result = combine(error)
      setReport(result)
      setRemaining(error.retryable ? error.remainingFiles || [] : [])
      setImportError(`${result.importedCount ? '已导入 ' + result.importedCount + ' 张。' : ''}${error.message}`)
    } finally { setImporting(false) }
  }
  useEffect(() => { if (kind === 'text') panes.current?.querySelector('[data-add-pane="text"] textarea')?.focus() }, [kind])
  return <Modal title="留下一刻" onClose={onClose} busy={busy} className={'j-add-memory ' + (kind === 'photo' ? 'j-entry-editor j-composer' : 'j-mark-editor')}>
    <div className="j-add-tabs" role="tablist" aria-label="添加内容类型">{kinds.map(([key, label, Icon]) => <button key={key} id={'j-add-tab-' + key} type="button" role="tab" aria-selected={kind === key} aria-controls={'j-add-pane-' + key} disabled={busy} onClick={() => setKind(key)}><Icon />{label}</button>)}</div>
    {importing && <div className="j-import-progress" role="status"><Images /><p>正在检查并把照片放到画布上…</p><progress max={progress?.total || 1} value={progress?.completed || 0} /><span>已处理 {progress?.completed || 0} / {progress?.total || 0} 个文件</span></div>}
    <div ref={panes} hidden={importing}>
      <div hidden={kind !== 'photo'} id="j-add-pane-photo" role="tabpanel" aria-labelledby="j-add-tab-photo">
        <div className="j-quick-import"><span>先把照片放进来，信息以后再补。</span><button type="button" className="j-button" disabled={busy} onClick={() => importInput.current.click()}><Images />批量导入，稍后整理</button><input ref={importInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="j-visually-hidden" aria-label="批量导入照片" onChange={event => { importFiles([...event.target.files]); event.target.value = '' }} /></div>
        {importError && <p className="j-error" role="alert">{importError}{remaining.length > 0 && <button type="button" className="j-button" onClick={() => importFiles(remaining, true)}>重试剩余 {remaining.length} 张</button>}</p>}
        {!!report?.rejectedFiles.length && <div className="j-import-report">
          <p role="status">已导入 {report.importedCount} 张照片，{report.rejectedFiles.length} 个文件未导入。</p>
          <details open><summary>查看未导入的文件和原因</summary><ul>{report.rejectedFiles.map((file, index) => <li key={index}><strong>{file.name}</strong><span>{file.reason}</span></li>)}</ul></details>
          <p>其他有效照片会继续导入。请转换或修复这些文件后，再单独选择它们。</p>
          {!remaining.length && <button type="button" className="j-button j-primary" onClick={onClose}>{report.importedCount ? '查看已导入照片' : '完成'}</button>}
        </div>}
        <EntryEditor embedded preset={preset} trips={trips} onSave={onSave} onCreateTrip={onCreateTrip} onClose={onClose} onBusyChange={setBusy} />
      </div>
      {['text', 'sticker'].map(key => <div key={key} hidden={kind !== key} id={'j-add-pane-' + key} role="tabpanel" aria-labelledby={'j-add-tab-' + key} data-add-pane={key}><MarkEditor embedded initialKind={key} position={position} onSave={onSaveMark} onClose={onClose} onBusyChange={setBusy} /></div>)}
    </div>
  </Modal>
}
