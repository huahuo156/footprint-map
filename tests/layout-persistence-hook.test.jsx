import { StrictMode, useEffect } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLayoutPersistence } from '../src/journal/canvas/useLayoutPersistence.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const p = x => ({ kind: 'mark', id, x, y: 0, rotation: 0 })
const baseline = (x = 0, version = '0') => ({ structure_version: '3', items: [{ ...p(x), layout_version: version }] })
const command = (from, to) => ({ id: `${from}-${to}`, before: [p(from)], after: [p(to)] })
const ack = body => ({ saved: body.items.length, items: body.items.map(item => ({ kind: item.kind, id: item.id, layout_version: String(BigInt(item.expected_version) + 1n) })) })
function setup(wrapper) {
  const pending = [], send = vi.fn((body, options) => new Promise((resolve, reject) => pending.push({ body, options, resolve, reject })))
  const hook = renderHook(({ sessionKey, transport = send }) => useLayoutPersistence({ sessionKey, send: transport }), { initialProps: { sessionKey: 'account-a' }, wrapper })
  return { ...hook, pending, send }
}
it('initializes explicitly and survives React StrictMode effect replay', async () => {
  const { result, pending } = setup(StrictMode)
  expect(result.current.status).toBe('loading')
  act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => pending[0].resolve(ack(pending[0].body)))
  expect(result.current.status).toBe('saved'); expect(result.current.items[0].x).toBe(10)
})
it('clears the account scope and ignores late acknowledgements', async () => {
  const { result, pending, rerender } = setup()
  const oldEdit = result.current.editLayout
  act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1))
  rerender({ sessionKey: 'account-b' })
  expect(result.current).toMatchObject({ status: 'loading', items: [], canUndo: false })
  expect(pending[0].options.signal.aborted).toBe(true)
  expect(() => oldEdit(command(10, 20))).toThrow()
  act(() => result.current.replaceBaseline(baseline(50)))
  await act(async () => pending[0].resolve(ack(pending[0].body)))
  expect(result.current.items[0].x).toBe(50)
})
it('aborts on unmount and rejects captured methods', async () => {
  const { result, pending, unmount } = setup()
  act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1))
  const replace = result.current.replaceBaseline; unmount()
  expect(pending[0].options.signal.aborted).toBe(true); expect(() => replace(baseline())).toThrow()
})
it('blocks structural writes and baseline refresh while layout outcome is unknown', async () => {
  const { result, pending } = setup()
  act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1))
  const action = vi.fn()
  await expect(result.current.runStructureOperation(action)).rejects.toThrow()
  expect(action).not.toHaveBeenCalled(); expect(() => result.current.replaceBaseline(baseline())).toThrow()
  await act(async () => pending[0].reject(new Error('offline')))
  await expect(result.current.runStructureOperation(action)).rejects.toThrow()
})
it('locks editing during structural work and commits the new baseline only after success', async () => {
  const { result } = setup(); act(() => result.current.replaceBaseline(baseline()))
  let resolve, pending
  act(() => { pending = result.current.runStructureOperation(() => new Promise(done => { resolve = done })) })
  expect(result.current.barrierStatus).toBe('running')
  expect(() => result.current.editLayout(command(0, 10))).toThrow()
  await act(async () => { resolve(baseline(30)); await pending })
  expect(result.current.items[0].x).toBe(30); expect(result.current.barrierStatus).toBe('idle')
})
it('retains history after structural failure and requires a fresh baseline', async () => {
  const { result, pending } = setup(); act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1)); await act(async () => pending[0].resolve(ack(pending[0].body)))
  expect(result.current.canUndo).toBe(true)
  await act(async () => { await expect(result.current.runStructureOperation(async () => { throw new Error('refresh failed') })).rejects.toThrow('refresh failed') })
  expect(result.current).toMatchObject({ barrierStatus: 'reload-required', canUndo: false })
  expect(result.current.items[0].x).toBe(10)
  act(() => result.current.replaceBaseline(baseline(20, '2')))
  expect(result.current).toMatchObject({ barrierStatus: 'idle', canUndo: false }); expect(result.current.items[0].x).toBe(20)
})
it('invalidates async structural callbacks across session changes', async () => {
  const { result, rerender } = setup(); act(() => result.current.replaceBaseline(baseline()))
  let resolve, guard, signal, task
  act(() => { task = result.current.runStructureOperation(context => { guard = context.guard; signal = context.signal; return new Promise(done => { resolve = done }) }) })
  rerender({ sessionKey: 'account-b' })
  expect(signal.aborted).toBe(true); expect(() => guard()).toThrow()
  await act(async () => { resolve(baseline(999)); await expect(task).rejects.toThrow() })
  expect(result.current.items).toEqual([])
})
it('does not discard a draft when an ordinary render creates a new transport callback', async () => {
  const { result, pending, rerender, send } = setup()
  act(() => result.current.replaceBaseline(baseline()))
  act(() => result.current.editLayout(command(0, 10)))
  await waitFor(() => expect(pending).toHaveLength(1))
  const nextTransport = vi.fn()
  rerender({ sessionKey: 'account-a', transport: nextTransport })
  expect(result.current.items[0].x).toBe(10); expect(pending[0].options.signal.aborted).toBe(false)
  await act(async () => pending[0].resolve(ack(pending[0].body)))
  act(() => result.current.editLayout(command(10, 20)))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(nextTransport).not.toHaveBeenCalled()
})
it('invalidates captured load guards during StrictMode replay even with the same account key', () => {
  const contexts = [], send = vi.fn()
  renderHook(() => {
    const layout = useLayoutPersistence({ sessionKey: 'account-a', send })
    useEffect(() => { contexts.push(layout.captureSession()) }, [])
    return layout
  }, { wrapper: StrictMode })
  expect(contexts).toHaveLength(2)
  expect(contexts[0].signal.aborted).toBe(true); expect(() => contexts[0].guard()).toThrow()
  expect(() => contexts[1].guard()).not.toThrow()
})
