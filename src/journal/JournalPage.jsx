import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, ImagePlus, Orbit, Plus, RefreshCw } from 'lucide-react'
import { useJournal } from './useJournal'
import { demoJournal } from './demo'
import JourneyCanvas from './JourneyCanvas'
import MobileFeed from './MobileFeed'
import EntryEditor from './EntryEditor'
import PhotoViewer from './PhotoViewer'
import MarkEditor from './MarkEditor'
import AddMemory from './AddMemory'
import BatchPhotoEditor from './BatchPhotoEditor'
import BatchItemDelete from './BatchItemDelete'
import { materializeJournal } from './components'
import { canvasData, findPagePosition, pageItems, PAGE_WIDTH, PAGE_HEIGHT } from './notebooks'
import { prepareNotebookEntry } from './notebookImport'
import { importPhotoFiles, readPhotoDimensions } from './importPhotos'
import { saveJournalEntry } from '../lib/api'
import { markDimensions } from '../../shared/journal-marks'
import NotebookReader from './NotebookReader'
import NotebookSettings from './NotebookSettings'
import useButtonHints from './useButtonHints'
import { notebookDropPage, planNotebookDrop } from './notebookDrop'
import './journal.css'

const WestLakeScene = lazy(() => import('./WestLakeScene'))
function useMobile() {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches)
  useEffect(() => { const query = matchMedia('(max-width: 767px)'), change = () => setMobile(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change) }, [])
  return mobile
}
export default function JournalPage() {
  useButtonHints()
  const journal = useJournal(), mobile = useMobile()
  const [demo, setDemo] = useState(false), [editor, setEditor] = useState(undefined), [selection, setSelection] = useState(null), [sceneTrip, setSceneTrip] = useState(null), [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(null), canvasPosition = useRef({ x: 0, y: 0 })
  const [editorPhoto, setEditorPhoto] = useState(null)
  const [overviewRequest, setOverviewRequest] = useState(0)
  const [markEditor, setMarkEditor] = useState(null)
  const [batch, setBatch] = useState(null)
  const [deletingItems, setDeletingItems] = useState(null)
  const [notebookId, setNotebookId] = useState(null), [bookSettings, setBookSettings] = useState(null)
  const personalData = useMemo(() => materializeJournal(journal.data), [journal.data])
  const data = demo ? demoJournal : personalData
  const rawData = demo ? demoJournal : journal.data
  const looseData = useMemo(() => canvasData(rawData), [rawData])
  const notebook = (rawData.notebooks || []).find(book => book.id === notebookId)
  const sceneEntries = useMemo(() => data.entries.filter(entry => sceneTrip === '__loose__' ? !entry.trip_id : entry.trip_id === sceneTrip), [data.entries, sceneTrip])
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timeout) }, [notice])
  useEffect(() => { if (mobile) setSceneTrip(null) }, [mobile])
  function create(preset) { setSelection(null); setAdding({ preset: !demo && (preset?.trip_id || preset?.place_name) ? preset : null, position: { ...canvasPosition.current } }) }
  function addToPage(pageId) { setAdding({ pageId, position: { x: 600, y: 800 }, preset: null }) }
  function open(entry, photoId) { if (entry.mark) { setMarkEditor({ mark: entry.mark }); return } setSelection({ entryId: entry.id, photoId: photoId || null }) }
  async function saveMark(id, values) {
    if (!id && adding?.pageId) {
      const item = { ...markDimensions(values), rotation: values.rotation || 0 }
      const position = findPagePosition(item, pageItems(journal.data, adding.pageId), adding.position)
      values = { ...values, notebook_page_id: adding.pageId, canvas_x: position.x, canvas_y: position.y }
    }
    await journal.saveMark(id, values); setDemo(false); setSceneTrip(null); if (!id) setOverviewRequest(value => value + 1); setNotice('已经放到手帐里。')
  }
  function edit(entry, photoId) { const record = journal.data.entries.find(item => item.id === (entry.record_id || entry.id)); setSelection(null); setEditorPhoto(photoId); setEditor(record) }
  async function remove(entry, photoId) { if (photoId) await journal.deletePhoto(photoId); else await journal.deleteEntry(entry.record_id || entry.id) }
  function scene(id) { setSelection(null); setSceneTrip(id) }
  async function save(id, body) {
    if (!id && adding?.pageId) body = prepareNotebookEntry(body, adding.pageId, journal.data, await readPhotoDimensions(body.getAll('images')))
    await journal.saveEntry(id, body); setDemo(false); setSceneTrip(null); if (!id) setOverviewRequest(value => value + 1); setNotice('这一刻已经留下。')
  }
  async function retry() { try { await journal.reload() } catch (error) { setNotice(error.message) } }
  async function importPhotos(files, position, onProgress) {
    if (adding?.pageId) {
      const pageId = adding.pageId, dimensions = await readPhotoDimensions(files)
      // Preflight the complete batch, so a full page saves no partial upload.
      const probe = new FormData()
      probe.set('data', JSON.stringify({ components: [], photos: files.map((_, upload_index) => ({ upload_index, components: [] })) }))
      const planned = JSON.parse(prepareNotebookEntry(probe, pageId, journal.data, dimensions).get('data')).photos
      const positions = planned.map(photo => ({ x: photo.canvas_x, y: photo.canvas_y }))
      try {
        return await importPhotoFiles(files, positions, onProgress, (_id, body) => {
          const values = JSON.parse(body.get('data')); values.notebook_page_id = pageId; body.set('data', JSON.stringify(values)); return saveJournalEntry(null, body)
        })
      } finally { await journal.reload().catch(() => setNotice('照片已处理，请重试刷新。')) }
    }
    try { const result = await journal.importPhotos(files, position, onProgress); if (result.importedCount) setNotice(`已导入 ${result.importedCount} 张照片，可以在画布上排版和多选编辑。`); return result }
    finally { setDemo(false); setSceneTrip(null); setOverviewRequest(value => value + 1) }
  }
  async function batchSave(ids, parts, positions) { await journal.batchEditPhotos(ids, parts, positions); setNotice(`已同步到 ${ids.length} 张照片。`) }
  async function batchDelete(items) { await journal.deleteItems(items); setNotice(`已删除 ${items.length} 项内容。`) }
  async function dropIntoPage(item, point) {
    if (!notebook) return false
    const paper = notebookDropPage(point)
    if (!paper) return false
    const pageId = paper.dataset.notebookPage, bounds = paper.getBoundingClientRect()
    const items = Array.isArray(item) ? item : [item]
    const incoming = items.map(candidate => pageItems({ ...journal.data, notebook_items: [...(journal.data.notebook_items || []).filter(p => p.kind !== candidate.kind || p.id !== candidate.id), { kind: candidate.kind, id: candidate.id, page_id: pageId, x: 600, y: 800, rotation: candidate.rotation || 0 }] }, pageId).find(p => p.id === candidate.id && p.kind === candidate.kind) || candidate)
    const placed = planNotebookDrop(incoming, pageItems(journal.data, pageId), { x: (point.x - bounds.left) / bounds.width * PAGE_WIDTH, y: (point.y - bounds.top) / bounds.height * PAGE_HEIGHT }).map(p => ({ kind: p.kind, id: p.id, x: p.x, y: p.y, rotation: p.rotation || 0 }))
    await journal.moveToPage(pageId, placed)
    setNotice(`已放入第 ${(journal.data.notebook_pages || []).filter(p => p.notebook_id === notebook.id).sort((a,b) => a.sort_order-b.sort_order).findIndex(p => p.id === pageId) + 1} 页。`)
    return true
  }
  async function saveBook(id, values) { const saved = await journal.changeNotebook(id, values); setDemo(false); if (!id) { setNotebookId(saved.id); setOverviewRequest(value => value + 1) } }
  const empty = !data.entries.length && !rawData.notebooks?.length
  return <div className={'journal-app ' + (mobile ? 'is-mobile' : 'is-desktop')}>
    {!mobile && <header className="j-app-header"><Link className="j-brand" to="/"><Orbit /><span>拾途</span></Link><span className="j-header-caption">把旅程铺开，随意走走。</span><div className="j-header-actions"><button className="j-button" onClick={() => setBookSettings({})}><BookOpen />创建手札</button><button className="j-button j-primary" onClick={create}><Plus />留下一刻</button></div></header>}
    {demo && <div className="j-demo-banner"><span><BookOpen />正在探索示例手帐</span><button onClick={() => { setDemo(false); setSelection(null); setSceneTrip(null) }}><ArrowLeft />返回我的手帐</button></div>}
    {!demo && journal.error && <div className="j-connection-error" role="alert"><span>{journal.error}</span><button className="j-button" onClick={retry}><RefreshCw />重试</button></div>}
    {journal.loading && !demo ? <main className="journal-loading" role="status"><Orbit /><p>正在展开你的手帐…</p></main> : empty ? <main className="j-empty"><span className="j-empty-eyebrow">拾途 · 私人旅行手帐</span><div className="j-empty-photos" aria-hidden="true"><span /><span><ImagePlus /></span><span /></div><h1>从一张照片，或一句话开始。</h1><p>留住走过的地方，和当时的小事。<br />以后想起来，再慢慢整理。</p><div><button className="j-button j-primary" onClick={create}><Plus />留下一刻</button><button className="j-button" onClick={() => setBookSettings({})}>创建手札</button><button className="j-button" onClick={() => setDemo(true)}>看看示例手帐</button></div></main> : mobile ? <><div className="nb-mobile-books"><button onClick={() => setBookSettings({})}>＋ 创建手札</button>{(rawData.notebooks || []).map(book => <button key={book.id} onClick={() => setNotebookId(book.id)}>{book.name}</button>)}</div><MobileFeed data={looseData} onOpen={open} onNew={create} /></> : sceneTrip ? <Suspense fallback={<div className="journal-loading" role="status">正在准备景点场景…</div>}><WestLakeScene entries={sceneEntries} onClose={() => setSceneTrip(null)} onOpen={open} onNew={create} /></Suspense> : <JourneyCanvas key={demo ? 'demo' : 'personal'} data={looseData} onOpen={open} onScene={scene} onNotebook={setNotebookId} onMoveNotebook={journal.changeNotebook} onDropItem={dropIntoPage} notebookOpen={!!notebook} onMove={journal.saveLayout} onMoveGroup={journal.saveLayouts} onSaveGroup={journal.saveGroup} onDeleteGroup={journal.removeGroup} onError={setNotice} onBatchEdit={(ids, positions) => setBatch({ ids, positions })} onBatchDelete={setDeletingItems} onViewPosition={position => { canvasPosition.current = position }} demo={demo} overviewRequest={demo ? 0 : overviewRequest} />}
    {notebook && <NotebookReader key={notebook.id} book={notebook} data={rawData} onOpen={open} onClose={() => setNotebookId(null)} onAdd={addToPage} onMove={journal.moveToPage} onReturn={journal.returnToCanvas} onAddPage={afterId => journal.createPage(notebook.id, afterId)} onDeletePage={journal.removePage} onReorder={ids => journal.reorderPages(notebook.id, ids)} onReadingChange={values => journal.changeNotebookReading(notebook.id,values)} onEditBook={() => setBookSettings({ book: notebook })} onError={setNotice} readOnly={demo} />}
    {bookSettings && <NotebookSettings {...bookSettings} data={journal.data} position={canvasPosition.current} onSave={saveBook} onDelete={async id => { await journal.removeNotebook(id); setNotebookId(null) }} onClose={() => setBookSettings(null)} />}
    {adding && <AddMemory {...adding} trips={journal.data.trips} onSave={save} onSaveMark={saveMark} onImport={importPhotos} onCreateTrip={journal.createTrip} onClose={() => setAdding(null)} />}
    {batch && <BatchPhotoEditor photos={journal.data.entries.flatMap(entry => entry.photos).filter(photo => batch.ids.includes(photo.id))} positions={batch.positions} onSave={batchSave} onCreateTrip={journal.createTrip} trips={journal.data.trips} onClose={() => setBatch(null)} />}
    {deletingItems && <BatchItemDelete items={deletingItems} onDelete={batchDelete} onClose={() => setDeletingItems(null)} />}
    {markEditor && <MarkEditor {...markEditor} onSave={saveMark} onDelete={journal.deleteMark} onClose={() => setMarkEditor(null)} />}
    {editor !== undefined && <EntryEditor key={editor?.id || 'new'} entry={editor} initialPhotoId={editorPhoto} trips={journal.data.trips} onClose={() => setEditor(undefined)} onSave={save} onCreateTrip={journal.createTrip} />}
    {selection && <PhotoViewer key={selection.entryId + ':' + selection.photoId} selection={selection} data={data} onClose={() => setSelection(null)} onEdit={edit} onDelete={remove} onScene={scene} demo={demo} mobile={mobile} />}
    {notice && <div className="j-toast" role="status">{notice}</div>}
  </div>
}
