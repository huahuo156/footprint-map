import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import CanvasItem from './CanvasItem'
import NotebookCover from './NotebookCover'
import { pageItems, PAGE_HEIGHT, PAGE_WIDTH } from './notebooks'
import './notebook-print.css'

// Keep the original 1200 × 1600 layout on a 190 × 253.33 mm sheet inside A4.
const PRINT_SCALE = 190 / 25.4 * 96 / PAGE_WIDTH

export default function NotebookPrint({ book, data, onClose }) {
  const root = useRef(null)
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(0), [imageSizes, setImageSizes] = useState({})
  const pages = useMemo(() => (data.notebook_pages || []).filter(page => page.notebook_id === book.id).sort((a, b) => a.sort_order - b.sort_order), [data.notebook_pages, book.id])
  useEffect(() => {
    const previousTitle = document.title
    document.title = book.name + ' — 留念册'
    const keydown = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', keydown, true)
    return () => { document.title = previousTitle; window.removeEventListener('keydown', keydown, true) }
  }, [book.name, onClose])
  useEffect(() => {
    let cancelled = false
    const images = [...root.current.querySelectorAll('img')]
    const cleanups = []
    const jobs = images.map(img => new Promise(resolve => {
      let settled = false
      const finish = ok => { if (settled) return; settled = true; resolve(ok) }
      const loaded = () => finish(true), error = () => finish(false)
      img.loading = 'eager'
      img.addEventListener('load', loaded); img.addEventListener('error', error)
      const timeout = setTimeout(error, 15000)
      cleanups.push(() => { clearTimeout(timeout); img.removeEventListener('load', loaded); img.removeEventListener('error', error) })
      if (img.complete) finish(img.naturalWidth > 0)
    }))
    Promise.all(jobs).then(async results => {
      await document.fonts?.ready
      if (!cancelled) { setFailed(results.filter(ok => !ok).length); setReady(true) }
    })
    return () => { cancelled = true; cleanups.forEach(clean => clean()) }
  }, [])
  function loaded(event, item) {
    const img = event.currentTarget
    if (img.naturalWidth) setImageSizes(previous => ({ ...previous, [item.url]: { width: img.naturalWidth, height: img.naturalHeight } }))
  }
  const sheet = (id, children) => <section key={id} className="nb-print-sheet" data-print-page={id}>
    <div className="nb-board" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${PRINT_SCALE})` }}>{children}</div>
  </section>
  return createPortal(<div className="nb-print-root journal-app" role="dialog" aria-modal="true" aria-label="留念册打印预览" ref={root}>
    <header className="nb-print-controls">
      <div><strong>{book.name} · 留念册</strong><p role="status">{!ready ? '正在准备照片与字体…' : failed ? `${failed} 张照片未能加载，请检查后重新打开预览。` : `封面、扉页与 ${pages.length} 页内页已准备好。`} 在打印窗口选择“另存为 PDF”，纸张 A4，关闭页眉和页脚。</p></div>
      <button type="button" className="j-button j-primary" disabled={!ready} onClick={() => window.print()}><Printer />打印 / 保存为 PDF</button>
      <button type="button" className="j-button" onClick={onClose}><X />关闭预览</button>
    </header>
    <div className="nb-print-pages">
      {sheet('cover', <div className="nb-print-cover"><NotebookCover fullSize book={book} pageCount={pages.length} /></div>)}
      {sheet('title', <div className="nb-flyleaf nb-print-title"><h2 className={book.name.length > 40 ? 'is-long' : ''}>{book.name}</h2>{book.cover_text && <p className={book.cover_text.length > 180 ? 'is-long' : ''}>{book.cover_text}</p>}</div>)}
      {pages.map((page, index) => sheet(page.id, <>
        {pageItems(data, page.id, imageSizes).map(item => <CanvasItem fullSize key={item.kind + item.id} item={item} trips={data.trips} componentLimit={Infinity} onImageLoad={loaded} />)}
        <span className="nb-print-folio">{index + 1}</span>
      </>))}
    </div>
  </div>, document.body)
}
