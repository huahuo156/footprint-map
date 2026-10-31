import * as api from '../lib/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCanvas, layoutCanvasGroups, planPhotoImport } from './model'
import { canvasData } from './notebooks'
import { prepareNotebookEntry } from './notebookImport'
import { canvasHeaders, canvasObstacles, collisionItems, planCanvasRepair } from './canvasCollision'
import { importPhotoFiles, readPhotoDimensions } from './importPhotos'
import { useLayoutPersistence } from './canvas/useLayoutPersistence.js'

const EMPTY = { trips: [], entries: [], marks: [] }
const key = item => `${item.kind}:${item.id}`
function rows(journal) {
  return new Map([...(journal.marks || []).map(row => [`mark:${row.id}`, row]), ...journal.entries.flatMap(row => [[`entry:${row.id}`, row], ...row.photos.map(photo => [`photo:${photo.id}`, photo])])])
}
function baseline(journal) {
  const sources = rows(journal)
  return { structure_version: journal.structure_version, items: buildCanvas(canvasData(journal), {}, false).items.map(item => {
    const id = item.kind === 'entry' ? item.entry.record_id || item.id : item.id
    return { id, kind: item.kind, x: item.x - (item.kind === 'photo' ? 0 : item.anchor.x), y: item.y - (item.kind === 'photo' ? 0 : item.anchor.y), rotation: item.rotation || 0, layout_version: sources.get(`${item.kind}:${id}`).layout_version }
  }) }
}
function overlay(journal, snapshot, origin) {
  if (!snapshot.items.length) return journal
  const versions = new Map((snapshot.versions || []).map(item => [key(item), item.layout_version])), sources = rows(journal), updates = new Map()
  for (const item of snapshot.items) {
    const before = origin.get(key(item)), row = sources.get(key(item))
    if (!before || !row) continue
    if (before.x !== item.x || before.y !== item.y || before.rotation !== item.rotation || versions.get(key(item)) !== row.layout_version)
      updates.set(key(item), { canvas_x: item.x, canvas_y: item.y, rotation: item.rotation, layout_version: versions.get(key(item)), ...(item.kind === 'photo' ? { canvas_absolute: 1 } : {}) })
  }
  return { ...journal, marks: (journal.marks || []).map(row => ({ ...row, ...updates.get(`mark:${row.id}`) })), entries: journal.entries.map(row => ({ ...row, ...updates.get(`entry:${row.id}`), photos: row.photos.map(photo => ({ ...photo, ...updates.get(`photo:${photo.id}`) })) })) }
}

export function useJournal(userId = 'mounted-journal') {
  const account = useMemo(() => ({ guard: api.captureApiSession(), reading: new Map(), readingVersions: new Map(), readingConfirmed: new Map(), readingPending: new Map(), readingDesired: new Map(), readingRevision: new Map(), readSnapshots: new WeakMap(), readEpoch: 0, sequence: 0, initialLoad: 0 }), [userId])
  const [store, setStore] = useState({ account, data: EMPTY, loading: true, error: '' })
  const server = useRef({ account, data: EMPTY, origin: new Map() })
  const send = useCallback((body, { signal }) => { account.guard(); return api.request('/journal/layout', { method: 'PATCH', body: JSON.stringify(body), signal }) }, [account])
  const layout = useLayoutPersistence({ sessionKey: account, send }), layoutRef = useRef(layout)
  layoutRef.current = layout
  const data = store.account === account ? overlay(store.data, layout, server.current.account === account ? server.current.origin : new Map()) : EMPTY
  function setError(error) { setStore(previous => previous.account === account ? { ...previous, error } : previous) }
  function commit(journal) {
    account.guard()
    const revision = account.readSnapshots.get(journal) ?? account.readEpoch
    const notebooks = (journal.notebooks || []).map(book => {
      const values = {}
      for (const field of ['bookmark_page_id', 'last_read_page_id']) {
        const id = book.id + ':' + field
        if (account.readingPending.has(id)) values[field] = account.readingDesired.get(id)
        else if ((account.readingRevision.get(id) || 0) > revision) values[field] = account.readingConfirmed.get(id)
        else account.readingConfirmed.set(id, book[field])
      }
      return { ...book, ...values }
    })
    server.current = { account, data: journal, origin: new Map(baseline(journal).items.map(item => [key(item), item])) }
    setStore({ account, data: { ...journal, notebooks }, loading: false, error: '' })
  }
  async function fetchSnapshot(signal, guard) {
    const revision = account.readEpoch
    const journal = await api.fetchJournal(signal); guard(); account.guard()
    account.readSnapshots.set(journal, revision)
    return journal
  }
  async function read(signal, guard) {
    let journal = await fetchSnapshot(signal, guard)
    const repair = planCanvasRepair(journal, server.current.account === account ? server.current.data : null)
    try {
    for (let index = 0; index < repair.items.length; index += 500) {
      const sources = rows(journal)
      await send({ expected_structure_version: journal.structure_version, items: repair.items.slice(index, index + 500).map(item => ({ ...item, expected_version: sources.get(key(item)).layout_version })) }, { signal })
      guard(); journal = await fetchSnapshot(signal, guard)
    }
    for (const book of repair.notebooks) {
      await api.request('/journal/notebooks/' + book.id, { method: 'PATCH', signal, body: JSON.stringify({ canvas_x: book.canvas_x, canvas_y: book.canvas_y }) }); guard()
    }
    if (repair.notebooks.length) journal = await fetchSnapshot(signal, guard)
    } catch (error) { throw Object.assign(error, { journal, message: '自动避让位置未保存，请点击重试。' + error.message }) }
    return journal
  }
  async function reload(options) {
    account.guard()
    const context = layoutRef.current.captureSession()
    let journal
    if (layoutRef.current.getSnapshot().status === 'loading') {
      const sequence = ++account.initialLoad
      const guard = () => { context.guard(); if (sequence !== account.initialLoad) throw new DOMException('已有更新的手帐读取', 'AbortError') }
      try { journal = await read(context.signal, guard); guard(); layoutRef.current.replaceBaseline(baseline(journal)) }
      catch (error) { guard(); if (error.journal) setStore({ account, data: error.journal, loading: false, error: error.message }); throw error }
    } else {
      await layoutRef.current.reloadBaseline(async ({ signal, guard }) => { journal = await read(signal, guard); return baseline(journal) }, { discardConflict: options?.discard === true })
    }
    context.guard(); commit(journal); return journal
  }
  const reloadRef = useRef(reload); reloadRef.current = reload
  useEffect(() => {
    const context = layoutRef.current.captureSession()
    reloadRef.current().catch(error => {
      try { context.guard(); if (error.name !== 'AbortError') setStore(previous => ({ ...previous, account, loading: false, error: error.message })) } catch { /* expired mount */ }
    })
  }, [account])
  useEffect(() => {
    const warn = event => { try { const snapshot = layoutRef.current.getSnapshot(); if (snapshot.hasUnconfirmed || snapshot.barrierStatus !== 'idle') { event.preventDefault(); event.returnValue = '' } } catch { /* unmounted session */ } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [account])

  async function mutate(action) {
    account.guard()
    const context = layoutRef.current.captureSession()
    let journal = server.current.data, result
    await layoutRef.current.runStructureOperation(async ({ signal, guard }) => {
      account.guard()
      const snapshot = layoutRef.current.getSnapshot(), versions = new Map((snapshot.versions || []).map(item => [key(item), item.layout_version]))
      async function request(path, method, values = {}) {
        guard(); account.guard()
        const sources = rows(journal)
        const enrich = value => ({ ...value, expected_structure_version: journal.structure_version,
          ...(value.positions ? { positions: value.positions.map(p => ({ ...p, expected_version: versions.get(`photo:${p.id}`) || sources.get(`photo:${p.id}`)?.layout_version })) } : {}),
          ...(path.startsWith('/marks/') && method === 'PUT' ? { expected_version: versions.get(`mark:${path.split('/').at(-1)}`) || sources.get(`mark:${path.split('/').at(-1)}`)?.layout_version } : {}) })
        let body
        if (values instanceof FormData) {
          body = new FormData(); values.forEach((value, name) => body.append(name, value))
          if (body.has('data')) body.set('data', JSON.stringify(enrich(JSON.parse(body.get('data')))))
          else body.set('expected_structure_version', journal.structure_version)
        } else body = JSON.stringify(enrich(values))
        const saved = await api.request('/journal' + path, { method, body, signal }); guard()
        journal = await fetchSnapshot(signal, guard); versions.clear()
        return saved
      }
      result = await action({ request, guard, signal, journal })
      journal = await read(signal, guard)
      return baseline(journal)
    })
    context.guard(); commit(journal); return result
  }
  function saveLayouts(items) {
    account.guard()
    const snapshot = layoutRef.current.getSnapshot(), previous = new Map(snapshot.items.map(item => [key(item), item]))
    layoutRef.current.editLayout({ id: globalThis.crypto.randomUUID(), before: items.map(item => previous.get(key(item))), after: items })
  }
  async function importPhotos(files, position, onProgress, pageId) {
    if (!files.length || files.length > 500) throw new Error('一次可导入1至500张照片。')
    return mutate(async ({ request, guard, journal }) => {
      const dimensions = await readPhotoDimensions(files); guard()
      let positions
      if (pageId) {
        const probe = new FormData(); probe.set('data', JSON.stringify({ components: [], photos: files.map((_, upload_index) => ({ upload_index, components: [] })) }))
        positions = JSON.parse(prepareNotebookEntry(probe, pageId, journal, dimensions).get('data')).photos.map(photo => ({ x: photo.canvas_x, y: photo.canvas_y }))
      } else {
        const model = buildCanvas(canvasData(journal), {}, false), items = collisionItems(model.items)
        positions = planPhotoImport(files.length, position || { x: 0, y: 0 }, canvasObstacles({ items, groups: layoutCanvasGroups(journal.canvas_groups || [], items), notebooks: journal.notebooks, headers: canvasHeaders(model) }), dimensions)
      }
      return importPhotoFiles(files, positions, onProgress, (_id, body) => {
        if (pageId) { const values = JSON.parse(body.get('data')); values.notebook_page_id = pageId; body.set('data', JSON.stringify(values)) }
        return request('/entries', 'POST', body)
      })
    })
  }
  async function changeNotebookReading(id, values) {
    account.guard()
    const sequence = ++account.sequence
    for (const field of Object.keys(values)) { account.readingVersions.set(id + ':' + field, sequence); account.readingPending.set(id + ':' + field, sequence); account.readingDesired.set(id + ':' + field, values[field]) }
    setStore(previous => {
      if (previous.account !== account) return previous
      return { ...previous, data: { ...previous.data, notebooks: (previous.data.notebooks || []).map(book => {
        if (book.id !== id) return book
        return { ...book, ...values }
      }) } }
    })
    const prior = account.reading.get(id) || Promise.resolve()
    const pending = prior.catch(() => {}).then(() => { account.guard(); return api.saveNotebookReading(id, values) })
    account.reading.set(id, pending)
    try {
      const result = await pending; account.guard()
      const revision = ++account.readEpoch
      for (const [field, value] of Object.entries(values)) { const key = id + ':' + field; account.readingConfirmed.set(key, value); account.readingRevision.set(key, revision); if (account.readingPending.get(key) === sequence) account.readingPending.delete(key) }
      return result
    }
    catch (error) {
      for (const field of Object.keys(values)) if (account.readingPending.get(id + ':' + field) === sequence) account.readingPending.delete(id + ':' + field)
      setStore(previous => previous.account === account ? { ...previous, data: { ...previous.data, notebooks: (previous.data.notebooks || []).map(book => book.id === id ? { ...book, ...Object.fromEntries(Object.keys(values).filter(field => account.readingVersions.get(id + ':' + field) === sequence).map(field => [field, account.readingConfirmed.get(id + ':' + field)])) } : book) } } : previous)
      setError(error.message); throw error
    }
    finally { if (account.reading.get(id) === pending) account.reading.delete(id) }
  }
  const write = (path, method, values) => mutate(({ request }) => request(path, method, values))
  return { data, layout, loading: store.account !== account || store.loading, error: store.account === account ? store.error : '', reload,
    saveLayout: item => saveLayouts([item]), saveLayouts,
    createTrip: values => write('/trips', 'POST', values), saveEntry: (id, body) => write('/entries' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body), deleteEntry: id => write('/entries/' + id, 'DELETE'),
    deletePhoto: id => write('/photos/' + id, 'DELETE'), deletePhotos: ids => write('/photos', 'DELETE', { photo_ids: ids }), deleteItems: items => write('/items', 'DELETE', { items }),
    saveGroup: (id, values) => write('/groups' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', values), removeGroup: id => write('/groups/' + id, 'DELETE'),
    saveMark: (id, values) => write('/marks' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', values), deleteMark: id => write('/marks/' + id, 'DELETE'),
    batchEditPhotos: (ids, parts, positions) => write('/photos/components', 'PATCH', { photo_ids: ids, components: parts, positions }), importPhotos,
    changeNotebook: (id, values) => write('/notebooks' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', values), changeNotebookReading, removeNotebook: id => write('/notebooks/' + id, 'DELETE'),
    createPage: (id, afterId) => write('/notebooks/' + id + '/pages', 'POST', { after_id: afterId }), reorderPages: (id, ids) => write('/notebooks/' + id + '/pages', 'PATCH', { page_ids: ids }), removePage: id => write('/notebook-pages/' + id, 'DELETE'),
    moveToPage: (id, items) => write('/notebook-pages/' + id + '/items', 'POST', { items }), returnToCanvas: items => write('/notebook-items', 'DELETE', { items: items.map(({ id, kind }) => ({ id, kind })) }),
    restoreBackup: file => { const body = new FormData(); body.append('backup', file); return write('/restore', 'POST', body) },
  }
}
