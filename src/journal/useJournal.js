import * as api from '../lib/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { materializeJournal } from './components'
import { buildCanvas, cardBounds, planPhotoImport } from './model'
import { importPhotoFiles, readPhotoDimensions } from './importPhotos'

export function useJournal() {
  const scope = useRef(null)
  if (!scope.current) {
    const guard = api.captureApiSession()
    scope.current = Object.fromEntries(Object.entries(api).filter(([, value]) => typeof value === 'function').map(([name, fn]) => [name, (...args) => { guard(); return fn(...args) }]))
  }
  const { createJournalTrip, deleteJournalEntry, deleteJournalPhoto, deleteJournalPhotos, deleteJournalItems, deleteJournalMark, fetchJournal, saveJournalEntry, saveJournalLayout, saveJournalMark, updatePhotoComponents, saveCanvasGroup, deleteCanvasGroup, saveNotebook, saveNotebookReading, deleteNotebook, addNotebookPage, reorderNotebookPages, deleteNotebookPage, moveNotebookItems, returnNotebookItems } = scope.current

  const [data, setData] = useState({ trips: [], entries: [], marks: [] })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const readingQueues = useRef(new Map())
  const reload = useCallback(async signal => {
    const journal = await fetchJournal(signal)
    setData(journal); setError('')
    return journal
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal).catch(error => { if (error.name !== 'AbortError') setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])
  async function createTrip(values) {
    const trip = await createJournalTrip(values)
    setData(previous => ({ ...previous, trips: [...previous.trips, trip] }))
    return trip
  }
  async function saveEntry(id, form) {
    const saved = await saveJournalEntry(id, form)
    try { await reload() } catch { setError('这一页已保存，列表暂未刷新，请稍后点击重试。') }
    return saved
  }
  async function deleteEntry(id) { await deleteJournalEntry(id); setData(previous => ({ ...previous, entries: previous.entries.filter(entry => entry.id !== id) })) }
  async function deletePhoto(id) {
    await deleteJournalPhoto(id)
    setData(previous => ({ ...previous, entries: previous.entries.flatMap(entry => {
      if (!entry.photos.some(photo => photo.id === id)) return [entry]
      const photos = entry.photos.filter(photo => photo.id !== id)
      return photos.length ? [{ ...entry, photos }] : []
    }) }))
  }
  async function saveLayout(item) {
    return saveLayouts([item])
  }
  async function saveLayouts(items) {
    const updates = new Map(items.map(item => [item.id, { canvas_x: item.x, canvas_y: item.y, rotation: item.rotation, ...(item.kind === 'photo' ? { canvas_absolute: 1 } : {}) }]))
    setData(previous => ({ ...previous, marks: (previous.marks || []).map(mark => ({ ...mark, ...updates.get(mark.id) })), entries: previous.entries.map(entry => ({ ...entry, ...updates.get(entry.id), photos: entry.photos.map(photo => ({ ...photo, ...updates.get(photo.id) })) })) }))
    try { await saveJournalLayout(items) } catch (error) { await reload().catch(() => {}); throw error }
  }
  async function saveGroup(id, values) {
    const saved = await saveCanvasGroup(id, values), positions = new Map((values.positions || []).map(photo => [photo.id, photo]))
    setData(previous => ({ ...previous,
      canvas_groups: id ? (previous.canvas_groups || []).map(group => group.id === id ? { ...group, ...saved } : group) : [...(previous.canvas_groups || []).map(group => saved.child_group_ids.includes(group.id) ? { ...group, parent_id: saved.id } : group), saved],
      entries: previous.entries.map(entry => ({ ...entry, photos: entry.photos.map(photo => {
        const position = positions.get(photo.id)
        return position ? { ...photo, canvas_x: position.x, canvas_y: position.y, rotation: position.rotation, canvas_absolute: 1 } : photo
      }) })),
    }))
    await reload().catch(() => setError('色块已保存，列表暂未刷新，请点击重试。'))
  }
  async function removeGroup(id) {
    await deleteCanvasGroup(id)
    setData(previous => {
      const removed = (previous.canvas_groups || []).find(group => group.id === id)
      return { ...previous, canvas_groups: (previous.canvas_groups || []).filter(group => group.id !== id).map(group => ({ ...group,
        parent_id: group.parent_id === id ? removed?.parent_id || null : group.parent_id,
        ...(group.id === removed?.parent_id ? { direct_photo_ids: [...(group.direct_photo_ids || []), ...(removed.direct_photo_ids || [])] } : {}),
      })) }
    })
    await reload().catch(() => setError('分组已解除，列表暂未刷新，请点击重试。'))
  }
  async function saveMark(id, values) {
    const saved = await saveJournalMark(id, values)
    try { await reload() } catch { setError('标注已保存，列表暂未刷新，请点击重试。') }
    return saved
  }
  async function deleteMark(id) { await deleteJournalMark(id); setData(previous => ({ ...previous, marks: (previous.marks || []).filter(mark => mark.id !== id) })) }
  async function batchEditPhotos(ids, parts, positions) {
    await updatePhotoComponents(ids, parts, positions)
    await reload()
  }
  async function deletePhotos(ids) {
    await deleteJournalPhotos(ids)
    const removed = new Set(ids)
    setData(previous => ({ ...previous, entries: previous.entries.flatMap(entry => {
      if (!entry.photos.some(photo => removed.has(photo.id))) return [entry]
      const photos = entry.photos.filter(photo => !removed.has(photo.id))
      return photos.length ? [{ ...entry, photos }] : []
    }) }))
  }
  async function deleteItems(items) {
    await deleteJournalItems(items)
    const photoIds = new Set(items.filter(item => item.kind === 'photo').map(item => item.id)), entryIds = new Set(items.filter(item => item.kind === 'entry').map(item => item.id)), markIds = new Set(items.filter(item => item.kind === 'mark').map(item => item.id))
    setData(previous => ({ ...previous, marks: (previous.marks || []).filter(mark => !markIds.has(mark.id)), entries: previous.entries.flatMap(entry => {
      if (entryIds.has(entry.id)) return []
      if (!entry.photos.some(photo => photoIds.has(photo.id))) return [entry]
      const photos = entry.photos.filter(photo => !photoIds.has(photo.id))
      return photos.length ? [{ ...entry, photos }] : []
    }) }))
  }
  async function importPhotos(files, position, onProgress) {
    if (!files.length || files.length > 500) throw new Error('一次可导入 1 至 500 张照片。')
    const guard = api.captureApiSession()
    const dimensions = await readPhotoDimensions(files)
    guard()
    const model = buildCanvas(materializeJournal(data)), positions = planPhotoImport(files.length, position || { x: 0, y: 0 }, [...model.headers, ...model.items.map(item => cardBounds(item.kind === 'photo' ? { ...item, width: 280, height: 326 } : item))], dimensions)
    try { return await importPhotoFiles(files, positions, onProgress) }
    finally { await reload().catch(() => setError('请重试刷新列表，已导入的照片会保留。')) }
  }
  async function changeNotebook(id, values) { const result = await saveNotebook(id, values); await reload(); return result }
  async function changeNotebookReading(id, values) {
    setData(previous => ({ ...previous, notebooks:(previous.notebooks || []).map(book => book.id === id ? {...book,...values} : book) }))
    const queue = readingQueues.current.get(id) || { tail:Promise.resolve(), failed:false }
    const pending = queue.tail.catch(()=>{}).then(()=>saveNotebookReading(id, values))
    queue.tail = pending
    readingQueues.current.set(id,queue)
    try { return await pending }
    catch(error) { queue.failed = true; throw error }
    finally { if (queue.tail === pending) { readingQueues.current.delete(id); if (queue.failed) await reload().catch(()=>{}) } }
  }
  async function removeNotebook(id) { await deleteNotebook(id); await reload() }
  async function createPage(id, afterId) { const result = await addNotebookPage(id, afterId); await reload(); return result }
  async function reorderPages(id, ids) { await reorderNotebookPages(id, ids); await reload() }
  async function removePage(id) { await deleteNotebookPage(id); await reload() }
  async function moveToPage(id, items) { await moveNotebookItems(id, items); await reload() }
  async function returnToCanvas(items) { await returnNotebookItems(items); await reload() }
  return { data, loading, error, reload, createTrip, saveEntry, deleteEntry, deletePhoto, deletePhotos, deleteItems, saveLayout, saveLayouts, saveGroup, removeGroup, saveMark, deleteMark, importPhotos, batchEditPhotos, changeNotebook, changeNotebookReading, removeNotebook, createPage, reorderPages, removePage, moveToPage, returnToCanvas }
}
