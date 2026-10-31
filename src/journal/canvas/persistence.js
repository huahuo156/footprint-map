import { createHistory, recordHistory, undoHistory, redoHistory, snapshotLayoutPositions } from './history.js'

const MAX = 18446744073709551615n
const key = item => `${item.kind}:${item.id}`
const same = (a, b) => a.x === b.x && a.y === b.y && a.rotation === b.rotation
const token = value => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > MAX) throw new TypeError('Invalid layout version')
  return value
}
const copyPosition = item => snapshotLayoutPositions([item])[0]

/** One account/mount lifetime. send(body, {signal}) must return the API receipt.
 * Consumers subscribe with useSyncExternalStore and explicitly replace baselines
 * only after resolving pending writes or receiving an atomic conflict.
 */
export function createLayoutPersistence({ baseline, send }) {
  if (typeof send !== 'function') throw new TypeError('Missing layout transport')
  let confirmed, current, structure, history = createHistory()
  let status = 'saved', failure = null, conflict = false, inFlight = null
  let active = true, scheduled = false, sending = false, snapshot
  const listeners = new Set(), abort = new AbortController()
  function load(value) {
    const nextStructure = token(value?.structure_version)
    if (!Array.isArray(value.items)) throw new TypeError('Invalid baseline items')
    const next = new Map(Array.from(value.items, item => {
      const position = copyPosition(item)
      return [key(position), Object.freeze({ ...position, layout_version: token(item.layout_version) })]
    }))
    if (next.size !== value.items.length) throw new TypeError('Duplicate baseline identity')
    structure = nextStructure; confirmed = next
    current = new Map([...next].map(([id, item]) => [id, copyPosition(item)]))
    history = createHistory(); status = 'saved'; failure = null; conflict = false
  }
  load(baseline)
  const dirty = (values = current, base = confirmed) => [...values.values()].filter(item => !same(item, base.get(key(item))))
  function publish() {
    snapshot = Object.freeze({ status, error: failure, conflict, structure_version: structure, versions: Object.freeze([...confirmed.values()].map(item => Object.freeze({ kind: item.kind, id: item.id, layout_version: item.layout_version }))), items: Object.freeze([...current.values()]), canUndo: active && !!history.past.length, canRedo: active && !!history.future.length, canRetry: active && status === 'failed' && !conflict && !!inFlight, hasUnconfirmed: active && (!!inFlight || !!dirty().length) })
    for (const listener of listeners) listener()
  }
  function ensureActive() { if (!active) throw new Error('Layout session has ended') }
  function schedule() {
    if (scheduled || !active || status === 'failed' || sending) return
    scheduled = true
    Promise.resolve().then(() => { scheduled = false; pump() })
  }
  function receipt(result, body) {
    if (result?.saved !== body.items.length || !Array.isArray(result.items) || result.items.length !== body.items.length) throw new Error('Invalid layout acknowledgement')
    const expected = new Map(body.items.map(item => [key(item), item]))
    const versions = new Map()
    for (const item of result.items) {
      const original = expected.get(key(item))
      if (!original || versions.has(key(item)) || BigInt(token(item.layout_version)) !== BigInt(original.expected_version) + 1n) throw new Error('Invalid layout acknowledgement')
      versions.set(key(item), item.layout_version)
    }
    return versions
  }
  async function pump() {
    if (!active || sending || status === 'failed') return
    if (!inFlight) {
      const changed = dirty()
      if (!changed.length) { status = 'saved'; publish(); return }
      inFlight = Object.freeze({ expected_structure_version: structure, items: Object.freeze(changed.map(item => Object.freeze({ ...item, expected_version: confirmed.get(key(item)).layout_version }))) })
    }
    const body = inFlight
    sending = true; status = 'saving'; publish()
    if (!active) { sending = false; return }
    try {
      const result = await send(body, { signal: abort.signal })
      if (!active) return
      const versions = receipt(result, body)
      for (const item of body.items) confirmed.set(key(item), Object.freeze({ ...copyPosition(item), layout_version: versions.get(key(item)) }))
      inFlight = null; failure = null; status = dirty().length ? 'unsaved' : 'saved'
    } catch (error) {
      if (!active) return
      if (error?.status === 401) { dispose(); return }
      failure = error instanceof Error ? error.message : '布局保存失败，请重试'
      status = 'failed'; conflict = error?.status === 409
      if (conflict) inFlight = null
    } finally {
      sending = false
      if (active) { publish(); schedule() }
    }
  }
  function apply(items, nextHistory) {
    const next = new Map(current)
    for (const item of items) {
      if (!next.has(key(item))) throw new Error('Layout object is outside the baseline')
      next.set(key(item), item)
    }
    // Preserve atomic commands rather than silently splitting one across saves.
    const afterAcknowledgement = new Map(confirmed)
    for (const item of inFlight?.items || []) afterAcknowledgement.set(key(item), item)
    if (dirty(next).length > 500 || dirty(next, afterAcknowledgement).length > 500) throw new Error('请先重试保存当前布局，再继续批量修改（最多500项待保存对象）')
    current = next; history = nextHistory
    if (status !== 'failed' && !sending) status = dirty().length || inFlight ? 'unsaved' : 'saved'
    publish(); schedule()
  }
  function editLayout(command) {
    ensureActive()
    const next = recordHistory(history, command)
    // Validate before even for no-op commands; stale gestures must not enter history.
    for (const value of command.before) {
      const previous = current.get(key(value))
      if (!previous || !same(previous, copyPosition(value))) throw new Error('Layout command has a stale starting position')
    }
    if (next !== history) apply(next.past.at(-1).after, next)
  }
  function undoLayout() { ensureActive(); const result = undoHistory(history); if (result.items.length) apply(result.items, result.history) }
  function redoLayout() { ensureActive(); const result = redoHistory(history); if (result.items.length) apply(result.items, result.history) }
  function retryLayout() {
    ensureActive()
    if (status !== 'failed' || conflict || !inFlight) return
    failure = null; status = 'unsaved'; publish(); schedule()
  }
  function replaceBaseline(value) {
    ensureActive()
    if (inFlight || sending || (status !== 'saved' && !conflict)) throw new Error('请先确认待保存请求，再重新载入')
    load(value); publish()
  }
  function dispose() {
    if (!active) return
    active = false; abort.abort(); confirmed.clear(); current.clear(); history = createHistory(); inFlight = null
    status = 'inactive'; failure = null; conflict = false; publish(); listeners.clear()
  }
  publish()
  return { getSnapshot: () => snapshot, subscribe(listener) { if (!active) return () => {}; listeners.add(listener); return () => listeners.delete(listener) }, editLayout, undoLayout, redoLayout, retryLayout, replaceBaseline, dispose }
}
