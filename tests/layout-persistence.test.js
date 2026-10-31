import { expect, it, vi } from 'vitest'
import { createLayoutPersistence } from '../src/journal/canvas/persistence.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const position = x => ({ kind: 'mark', id, x, y: 0, rotation: 0 })
const baseline = () => ({ structure_version: '3', items: [{ ...position(0), layout_version: '9007199254740995' }] })
const command = (before, after) => ({ id: `move-${before}-${after}`, before: [position(before)], after: [position(after)] })
const ack = body => ({ saved: body.items.length, items: body.items.map(item => ({ kind: item.kind, id: item.id, layout_version: String(BigInt(item.expected_version) + 1n) })) })
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
function setup() {
  const pending = [], send = vi.fn((body, options) => new Promise((resolve, reject) => pending.push({ body, options, resolve, reject })))
  const controller = createLayoutPersistence({ baseline: baseline(), send })
  return { controller, pending, send }
}
it('makes unsaved observable and serializes immutable snapshots without reverting later intent', async () => {
  const { controller: c, pending, send } = setup()
  const input = command(0, 10); c.editLayout(input); input.after[0].x = 999
  expect(c.getSnapshot().status).toBe('unsaved')
  await flush(); expect(c.getSnapshot().status).toBe('saving')
  c.editLayout(command(10, 20)); await flush(); expect(send).toHaveBeenCalledTimes(1)
  expect(Object.isFrozen(pending[0].body.items[0])).toBe(true)
  pending[0].resolve(ack(pending[0].body)); await flush()
  expect(c.getSnapshot().items[0].x).toBe(20)
  expect(pending[1].body.items[0].expected_version).toBe('9007199254740996')
  pending[1].resolve(ack(pending[1].body)); await flush(); expect(c.getSnapshot().status).toBe('saved')
})
it('retains failed edits and replays the exact unknown request before saving newer intent', async () => {
  const { controller: c, pending, send } = setup()
  c.editLayout(command(0, 10)); await flush(); const original = pending[0].body
  pending[0].reject(new Error('offline')); await flush()
  c.editLayout(command(10, 20)); await flush(); expect(send).toHaveBeenCalledTimes(1)
  expect(c.getSnapshot()).toMatchObject({ status: 'failed', canUndo: true })
  c.retryLayout(); await flush(); expect(pending[1].body).toBe(original)
  pending[1].resolve(ack(original)); await flush()
  expect(pending[2].body.items[0]).toMatchObject({ x: 20, expected_version: '9007199254740996' })
  pending[2].resolve(ack(pending[2].body)); await flush(); expect(c.getSnapshot().status).toBe('saved')
})
it('undoes a failed edit locally and confirms its unknown request before reverting it remotely', async () => {
  const { controller: c, pending } = setup()
  c.editLayout(command(0, 10)); await flush(); pending[0].reject(new Error('timeout')); await flush()
  c.undoLayout(); expect(c.getSnapshot().items[0].x).toBe(0)
  c.retryLayout(); await flush(); pending[1].resolve(ack(pending[1].body)); await flush()
  expect(pending[2].body.items[0].x).toBe(0)
  pending[2].resolve(ack(pending[2].body)); await flush()
  expect(c.getSnapshot()).toMatchObject({ status: 'saved', canRedo: true })
})
it('treats 409 as ended, retains intent and allows explicit baseline replacement only', async () => {
  const { controller: c, pending, send } = setup()
  c.editLayout(command(0, 10)); await flush(); pending[0].reject(Object.assign(new Error('conflict'), { status: 409 })); await flush()
  expect(c.getSnapshot()).toMatchObject({ status: 'failed', conflict: true, canRetry: false })
  c.retryLayout(); await flush(); expect(send).toHaveBeenCalledTimes(1)
  c.replaceBaseline(baseline()); expect(c.getSnapshot()).toMatchObject({ status: 'saved', canUndo: false })
})
it('blocks refresh while a request has an unknown outcome', async () => {
  const { controller: c, pending } = setup()
  c.editLayout(command(0, 10)); await flush()
  expect(() => c.replaceBaseline(baseline())).toThrow()
  pending[0].reject(new Error('offline')); await flush()
  expect(() => c.replaceBaseline(baseline())).toThrow()
})
it('aborts disposal and ignores old acknowledgements', async () => {
  const { controller: c, pending } = setup()
  const listener = vi.fn(); c.subscribe(listener)
  c.editLayout(command(0, 10)); await flush(); c.dispose(); const count = listener.mock.calls.length
  expect(pending[0].options.signal.aborted).toBe(true)
  pending[0].resolve(ack(pending[0].body)); await flush()
  expect(listener).toHaveBeenCalledTimes(count); expect(() => c.editLayout(command(10, 20))).toThrow()
})
it('does not trust incomplete acknowledgements or guess a new version', async () => {
  const { controller: c, pending } = setup()
  c.editLayout(command(0, 10)); await flush(); pending[0].resolve({ saved: 1, items: [] }); await flush()
  expect(c.getSnapshot().status).toBe('failed')
  c.retryLayout(); await flush(); expect(pending[1].body).toBe(pending[0].body)
})
it('does not send or record an unchanged command and checks stale before positions', async () => {
  const { controller: c, send } = setup()
  c.editLayout(command(0, 0)); await flush(); expect(send).not.toHaveBeenCalled()
  expect(c.getSnapshot().canUndo).toBe(false)
  expect(() => c.editLayout(command(5, 10))).toThrow()
})
it('clears memory and history when the session expires', async () => {
  const { controller: c, pending } = setup()
  c.editLayout(command(0, 10)); await flush(); pending[0].reject(Object.assign(new Error('expired'), { status: 401 })); await flush()
  expect(c.getSnapshot()).toMatchObject({ status: 'inactive', items: [], canUndo: false, hasUnconfirmed: false })
})
it('protects subscribers from caller mutations and supports unsubscribe', async () => {
  const { controller: c } = setup(); const listener = vi.fn(); const unsubscribe = c.subscribe(listener)
  c.editLayout(command(0, 10)); expect(listener).toHaveBeenCalled()
  expect(Object.isFrozen(c.getSnapshot().items[0])).toBe(true)
  unsubscribe(); const count = listener.mock.calls.length; c.dispose(); expect(listener).toHaveBeenCalledTimes(count)
})
it('never creates an oversized snapshot after retrying a failed batch and local undo', async () => {
  const positions = Array.from({ length: 1000 }, (_, index) => ({ kind: 'mark', id: String(index), x: 0, y: 0, rotation: 0, layout_version: '0' }))
  const pending = [], send = vi.fn(body => new Promise((_resolve, reject) => pending.push({ body, reject })))
  const c = createLayoutPersistence({ baseline: { structure_version: '0', items: positions }, send })
  const move = values => ({ id: 'batch', before: values, after: values.map(item => ({ ...item, x: 10 })) })
  c.editLayout(move(positions.slice(0, 500))); await flush(); pending[0].reject(new Error('offline')); await flush()
  c.undoLayout()
  expect(() => c.editLayout(move(positions.slice(500)))).toThrow(/500/)
  expect(c.getSnapshot().items.every(item => item.x === 0)).toBe(true)
  expect(c.getSnapshot().canRedo).toBe(true)
})
it('does not start transport when a subscriber ends the session on saving', async () => {
  const { controller: c, send } = setup()
  c.subscribe(() => { if (c.getSnapshot().status === 'saving') c.dispose() })
  c.editLayout(command(0, 10)); await flush()
  expect(send).not.toHaveBeenCalled()
})
it('redo writes with the confirmed version and a new edit clears the redo branch', async () => {
  const { controller: c, pending } = setup()
  c.editLayout(command(0, 10)); await flush(); pending[0].resolve(ack(pending[0].body)); await flush()
  c.undoLayout(); await flush(); pending[1].resolve(ack(pending[1].body)); await flush()
  c.redoLayout(); await flush(); expect(pending[2].body.items[0]).toMatchObject({ x: 10, expected_version: '9007199254740997' })
  pending[2].resolve(ack(pending[2].body)); await flush()
  c.undoLayout(); c.editLayout(command(0, 20)); expect(c.getSnapshot().canRedo).toBe(false)
  c.dispose()
})
