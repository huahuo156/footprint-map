import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountMenu } from '../auth/Account'
import { ArrowLeft, BookOpen, DatabaseBackup, ImagePlus, LayoutDashboard, Map, Orbit, Plus, RefreshCw } from 'lucide-react'
import { useJournal } from './useJournal'
import { demoJournal } from './demo'
import JourneyCanvas from './images/CanvasImageResources.jsx'
import MobileFeed from './MobileFeed'
import { materializeJournal } from './components'
import { canvasData, findPagePosition, pageItems, PAGE_WIDTH, PAGE_HEIGHT } from './notebooks'
import { prepareNotebookEntry } from './notebookImport'
import { readPhotoDimensions } from './importPhotos'
import { fetchLandmarks } from '../lib/api'
import { markDimensions } from '../../shared/journal-marks'
import useButtonHints from './useButtonHints'
import { notebookDropPage, planNotebookDrop } from './notebookDrop'
import './journal.css'

const EntryEditor = lazy(() => import('./EntryEditor'))
const PhotoViewer = lazy(() => import('./PhotoViewer'))
const MarkEditor = lazy(() => import('./MarkEditor'))
const AddMemory = lazy(() => import('./AddMemory'))
const BatchPhotoEditor = lazy(() => import('./BatchPhotoEditor'))
const BatchItemDelete = lazy(() => import('./BatchItemDelete'))
const PlaceAtlas = lazy(() => import('./PlaceAtlas'))
const NotebookReader = lazy(() => import('./NotebookReader'))
const NotebookSettings = lazy(() => import('./NotebookSettings'))
const BackupDialog = lazy(() => import('./BackupDialog'))
const WestLakeScene = lazy(() => import('./WestLakeScene'))
function useMobile() {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches)
  useEffect(() => { const query = matchMedia('(max-width: 767px)'), change = () => setMobile(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change) }, [])
  return mobile
}
export default function JournalPage({ userId }) {
  useButtonHints()
  const journal = useJournal(userId), mobile = useMobile()
  const [demo, setDemo] = useState(false), [editor, setEditor] = useState(undefined), [selection, setSelection] = useState(null), [sceneTrip, setSceneTrip] = useState(null), [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(null), canvasPosition = useRef({ x: 0, y: 0 })
  const [editorPhoto, setEditorPhoto] = useState(null)
  const [overviewRequest, setOverviewRequest] = useState(0)
  const [markEditor, setMarkEditor] = useState(null)
  const [batch, setBatch] = useState(null)
  const [deletingItems, setDeletingItems] = useState(null)
  const [notebookId, setNotebookId] = useState(null), [bookSettings, setBookSettings] = useState(null), [backup, setBackup] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [view, setView] = useState('canvas'), [landmarks, setLandmarks] = useState([])
  useEffect(() => {
    if (view !== 'atlas') return
    let alive = true
    fetchLandmarks().then(rows => { if (alive) setLandmarks(rows) }).catch(() => {})
    return () => { alive = false }
  }, [view])
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
    await journal.saveMark(id, values); setDemo(false); setSceneTrip(null); if (!id) setOverviewRequest(value => value + 1); setNotice('已经放到手札里。')
  }
  function edit(entry, photoId) { const record = journal.data.entries.find(item => item.id === (entry.record_id || entry.id)); setSelection(null); setEditorPhoto(photoId); setEditor(record) }
  async function remove(entry, photoId) { if (photoId) await journal.deletePhoto(photoId); else await journal.deleteEntry(entry.record_id || entry.id) }
  function scene(id) { setSelection(null); setView('canvas'); setSceneTrip(id) }
  async function save(id, body) {
    if (!id && adding?.pageId) body = prepareNotebookEntry(body, adding.pageId, journal.data, await readPhotoDimensions(body.getAll('images')))
    await journal.saveEntry(id, body); setDemo(false); setSceneTrip(null); if (!id) setOverviewRequest(value => value + 1); setNotice('这一刻已经留下。')
  }
  async function retry() {
    if (journal.layout.conflict && !window.confirm('重新载入将丢弃本页未保存的布局和撤销历史。要继续吗？')) return
    try { await journal.reload({ discard: journal.layout.conflict }) } catch (error) { setNotice(error.message) }
  }
  async function importPhotos(files, position, onProgress) {
    try { const result = await journal.importPhotos(files, position, onProgress, adding?.pageId); if (result.importedCount) setNotice(`已导入 ${result.importedCount} 张照片，可以在画布上排版和多选编辑。`); return result }
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
  const viewSwitcher = <nav className="j-view-switch" aria-label="手札视图"><button aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}><LayoutDashboard />自由画布</button><button aria-pressed={view === 'atlas'} onClick={() => { setView('atlas'); setSceneTrip(null) }}><Map />足迹版图</button></nav>
  return <div className={'journal-app ' + (mobile ? 'is-mobile' : 'is-desktop')}>
    {<header className="j-app-header"><Link className="j-brand" to="/"><Orbit /><span>拾途</span></Link>{!mobile && viewSwitcher}<div className="j-header-actions"><button className="j-button" onClick={() => setAccountOpen(true)}>账号</button><button className="j-button" onClick={() => setBackup(true)}><DatabaseBackup />备份</button>{!mobile && view === 'canvas' && <button className="j-button" onClick={() => setBookSettings({})}><BookOpen />创建手札</button>}<button className="j-button j-primary" onClick={create}><Plus />留下一刻</button></div></header>}
    {mobile && <div className="j-mobile-view-switch">{viewSwitcher}</div>}
    {demo && <div className="j-demo-banner"><span><BookOpen />正在探索示例手札</span><button onClick={() => { setDemo(false); setSelection(null); setSceneTrip(null) }}><ArrowLeft />返回我的手札</button></div>}
    {!demo && journal.error && <div className="j-connection-error" role="alert"><span>{journal.error}</span><button className="j-button" onClick={retry}><RefreshCw />重试</button></div>}
    {!demo && !journal.loading && <div className="j-layout-status" aria-label="布局保存状态"><span role="status">{({ loading: '正在准备布局', unsaved: '未保存', saving: '保存中', saved: '已保存', failed: '保存失败', inactive: '会话已结束' })[journal.layout.status]}</span><button className="j-button" disabled={!journal.layout.canUndo || journal.layout.status === 'saving' || !!notebook} onClick={() => { try { journal.layout.undoLayout() } catch (error) { setNotice(error.message) } }}>撤销布局</button><button className="j-button" disabled={!journal.layout.canRedo || journal.layout.status === 'saving' || !!notebook} onClick={() => { try { journal.layout.redoLayout() } catch (error) { setNotice(error.message) } }}>重做布局</button>{journal.layout.canRetry && <button className="j-button" onClick={journal.layout.retryLayout}>重试保存</button>}{journal.layout.conflict && <button className="j-button" onClick={retry}>丢弃本页布局并重新载入</button>}{journal.layout.barrierStatus === 'reload-required' && <button className="j-button" onClick={retry}>重新载入布局</button>}{(journal.layout.error || journal.layout.barrierError) && <span role="alert">{journal.layout.conflict ? '其他页面已修改布局，请重新载入。' : journal.layout.error || journal.layout.barrierError}</span>}</div>}
    {journal.loading && !demo ? <main className="journal-loading" role="status"><Orbit /><p>正在展开你的手札…</p></main> : view === 'atlas' ? <Suspense fallback={<main className="journal-loading" role="status">正在展开足迹版图…</main>}><PlaceAtlas userId={userId} mobile={mobile} data={data} landmarks={landmarks} onOpen={open} /></Suspense> : empty ? <main className="j-empty"><span className="j-empty-eyebrow">拾途 · 私人旅行手札</span><div className="j-empty-photos" aria-hidden="true"><span /><span><ImagePlus /></span><span /></div><h1>从一张照片，或一句话开始。</h1><p>留住走过的地方，和当时的小事。<br />以后想起来，再慢慢整理。</p><div><button className="j-button j-primary" onClick={create}><Plus />留下一刻</button><button className="j-button" onClick={() => setBookSettings({})}>创建手札</button>{mobile && <button className="j-button" onClick={() => setBackup(true)}><DatabaseBackup />备份与还原</button>}<button className="j-button" onClick={() => setDemo(true)}>看看示例手札</button></div></main> : mobile ? <><div className="nb-mobile-books"><button onClick={() => setBookSettings({})}>＋ 创建手札</button>{(rawData.notebooks || []).map(book => <button key={book.id} onClick={() => setNotebookId(book.id)}>{book.name}</button>)}<button aria-label="备份与还原" onClick={() => setBackup(true)}><DatabaseBackup /></button></div><MobileFeed data={looseData} onOpen={open} onNew={create} /></> : sceneTrip ? <Suspense fallback={<div className="journal-loading" role="status">正在准备景点场景…</div>}><WestLakeScene entries={sceneEntries} onClose={() => setSceneTrip(null)} onOpen={open} onNew={create} /></Suspense> : <JourneyCanvas userId={userId} key={demo ? 'demo' : 'personal'} data={looseData} onOpen={open} onScene={scene} onNotebook={setNotebookId} onMoveNotebook={journal.changeNotebook} onDropItem={dropIntoPage} notebookOpen={!!notebook} layout={demo ? undefined : journal.layout} onMove={journal.saveLayout} onMoveGroup={journal.saveLayouts} onSaveGroup={journal.saveGroup} onDeleteGroup={journal.removeGroup} onError={setNotice} onBatchEdit={(ids, positions) => setBatch({ ids, positions })} onBatchDelete={setDeletingItems} onViewPosition={position => { canvasPosition.current = position }} demo={demo} overviewRequest={demo ? 0 : overviewRequest} />}
    {notebook && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><NotebookReader key={notebook.id} book={notebook} data={rawData} onOpen={open} onClose={() => setNotebookId(null)} onAdd={addToPage} onMove={journal.moveToPage} onReturn={journal.returnToCanvas} onAddPage={afterId => journal.createPage(notebook.id, afterId)} onDeletePage={journal.removePage} onReorder={ids => journal.reorderPages(notebook.id, ids)} onReadingChange={values => journal.changeNotebookReading(notebook.id,values)} onEditBook={() => setBookSettings({ book: notebook })} onError={setNotice} readOnly={demo} /></Suspense>}
    {bookSettings && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><NotebookSettings {...bookSettings} data={journal.data} position={canvasPosition.current} onSave={saveBook} onDelete={async id => { await journal.removeNotebook(id); setNotebookId(null) }} onClose={() => setBookSettings(null)} /></Suspense>}
    {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} />}
    {backup && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><BackupDialog onRestore={journal.restoreBackup} onClose={() => setBackup(false)} onRestored={async () => { setNotice('备份已经还原，新内容已并入手札。') }} /></Suspense>}
    {adding && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><AddMemory {...adding} trips={journal.data.trips} onSave={save} onSaveMark={saveMark} onImport={importPhotos} onCreateTrip={journal.createTrip} onClose={() => setAdding(null)} /></Suspense>}
    {batch && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><BatchPhotoEditor photos={journal.data.entries.flatMap(entry => entry.photos).filter(photo => batch.ids.includes(photo.id))} positions={batch.positions} onSave={batchSave} onCreateTrip={journal.createTrip} trips={journal.data.trips} onClose={() => setBatch(null)} /></Suspense>}
    {deletingItems && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><BatchItemDelete items={deletingItems} onDelete={batchDelete} onClose={() => setDeletingItems(null)} /></Suspense>}
    {markEditor && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><MarkEditor {...markEditor} onSave={saveMark} onDelete={journal.deleteMark} onClose={() => setMarkEditor(null)} /></Suspense>}
    {editor !== undefined && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><EntryEditor key={editor?.id || 'new'} entry={editor} initialPhotoId={editorPhoto} trips={journal.data.trips} onClose={() => setEditor(undefined)} onSave={save} onCreateTrip={journal.createTrip} /></Suspense>}
    {selection && <Suspense fallback={<div className="j-toast" role="status">正在准备…</div>}><PhotoViewer key={selection.entryId + ':' + selection.photoId} selection={selection} data={data} onClose={() => setSelection(null)} onEdit={edit} onDelete={remove} onScene={scene} demo={demo} mobile={mobile} /></Suspense>}
    {notice && <div className="j-toast" role="status">{notice}</div>}
  </div>
}
