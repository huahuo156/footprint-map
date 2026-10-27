const API_BASE = import.meta.env.VITE_API_BASE || '/api'
let csrfToken = null
let generation = 0
const requests = new Set()
export function clearApiSession() {
  generation += 1
  csrfToken = null
  for (const controller of requests) controller.abort()
  requests.clear()
}
export function setApiSession(session) { clearApiSession(); csrfToken = session?.csrfToken || null }
export function captureApiSession() { const version = generation; return () => { if (version !== generation) throw aborted() } }
const aborted = () => new DOMException('账号已切换，请重新操作。', 'AbortError')
export async function apiFetch(path, options = {}) {
  const controller = new AbortController(), version = generation
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) controller.abort()
  requests.add(controller)
  const cleanup = () => { requests.delete(controller); options.signal?.removeEventListener('abort', cancel) }
  const check = () => { if (controller.signal.aborted || version !== generation) throw aborted() }
  try {
    const response = await fetch(API_BASE + path, {
      ...options, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(!/^(GET|HEAD|OPTIONS)$/i.test(options.method || 'GET') && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers },
    })
    check()
    if (response.status === 401 && !path.startsWith('/auth/')) {
      clearApiSession()
      window.dispatchEvent(new Event('shitu-session-expired'))
      throw Object.assign(new Error('登录已过期，请重新登录。'), { status: 401 })
    }
    // Check after body decoding as well: abort alone cannot reject an already resolved body.
    return new Proxy(response, { get(target, property) {
      if (['json', 'blob', 'text', 'arrayBuffer'].includes(property)) return async (...args) => { try { check(); const data = await target[property](...args); check(); return data } finally { cleanup() } }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } catch (error) { cleanup(); throw error }
}
export async function request(path, options = {}) {
  const response = await apiFetch(path, options)
  const data = await response.json().catch(error => { if (error.name === 'AbortError') throw error; return { error: '暂时连不上手札，请检查后端服务是否已启动。' } })
  if (!response.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: response.status, code: data.code, invalidFiles: data.invalidFiles })
  return data
}
export const fetchSession = () => request('/auth/session')
export const authRequest = (action, values = {}, options = {}) => request('/auth/' + action, { method: 'POST', body: JSON.stringify(values), ...options })
function queryString(params) {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString()
}
export const fetchLandmarks = () => request('/landmarks')
export const searchPlaces = (query, signal) => request('/places?' + queryString({ q: query }), { signal })
export const fetchCheckins = (params = {}) => request('/checkins?' + queryString(params))
export const fetchMyCheckins = province => fetchCheckins({ province, all: true })
export const fetchGuides = (params = {}) => request('/guides?' + queryString(params))
export const fetchGuide = id => request('/guides/' + id)
export const createGuide = data => request('/guides', { method: 'POST', body: JSON.stringify(data) })
export const createCheckin = data => request('/checkins', { method: 'POST', body: JSON.stringify(data) })
export async function uploadImage(file, kind = 'checkin-images') {
  const body = new FormData()
  body.append('image', file)
  return (await request('/uploads/' + kind, { method: 'POST', body })).url
}
export const toggleLike = async (id, type) => (await request('/likes/' + type + '/' + id, { method: 'POST' })).liked
export const checkLiked = async (id, type) => (await request('/likes/' + type + '/' + id)).liked
// 本地版本按描述和省份搜索，不再生成随机向量。
export const searchSimilar = (query, limit = 20) => request('/search', { method: 'POST', body: JSON.stringify({ query, limit }) })

export const fetchJournal = signal => request('/journal', { signal })
export const saveCanvasGroup = (id, data) => request('/journal/groups' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) })
export const deleteCanvasGroup = id => request('/journal/groups/' + id, { method: 'DELETE' })
export const createJournalTrip = data => request('/journal/trips', { method: 'POST', body: JSON.stringify(data) })
export const saveJournalEntry = (id, body) => request('/journal/entries' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body })
export const deleteJournalEntry = id => request('/journal/entries/' + id, { method: 'DELETE' })
export const deleteJournalPhoto = id => request('/journal/photos/' + id, { method: 'DELETE' })
export const saveJournalLayout = items => request('/journal/layout', { method: 'PATCH', body: JSON.stringify({ items }) })
export const saveJournalMark = (id, data) => request('/journal/marks' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })
export const deleteJournalMark = id => request('/journal/marks/' + id, { method: 'DELETE' })
export const updatePhotoComponents = (photo_ids, components, positions) => request('/journal/photos/components', { method: 'PATCH', body: JSON.stringify({ photo_ids, components, positions }) })
export const deleteJournalPhotos = photo_ids => request('/journal/photos', { method: 'DELETE', body: JSON.stringify({ photo_ids }) })
export const deleteJournalItems = items => request('/journal/items', { method: 'DELETE', body: JSON.stringify({ items }) })
export const saveNotebook = (id, data) => request('/journal/notebooks' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) })
export const deleteNotebook = id => request('/journal/notebooks/' + id, { method: 'DELETE' })
export const saveNotebookReading = (id, data) => request('/journal/notebooks/' + id + '/reading', { method:'PATCH', body:JSON.stringify(data) })
export const uploadNotebookCover = file => {
  const body = new FormData(); body.append('image', file)
  return request('/journal/notebook-covers', { method: 'POST', body })
}
export const discardNotebookCover = url => request('/journal/notebook-covers?url=' + encodeURIComponent(url), { method: 'DELETE' })
export const addNotebookPage = (id, after_id) => request('/journal/notebooks/' + id + '/pages', { method: 'POST', body: JSON.stringify({ after_id }) })
export const reorderNotebookPages = (id, page_ids) => request('/journal/notebooks/' + id + '/pages', { method: 'PATCH', body: JSON.stringify({ page_ids }) })
export const deleteNotebookPage = id => request('/journal/notebook-pages/' + id, { method: 'DELETE' })
export const moveNotebookItems = (id, items) => request('/journal/notebook-pages/' + id + '/items', { method: 'POST', body: JSON.stringify({ items }) })
export const returnNotebookItems = items => request('/journal/notebook-items', { method: 'DELETE', body: JSON.stringify({ items: items.map(({ id, kind }) => ({ id, kind })) }) })
