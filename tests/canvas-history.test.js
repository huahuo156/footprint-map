import { expect, it } from 'vitest'
import { createHistory, recordHistory, undoHistory, redoHistory } from '../src/journal/canvas/history.js'

const item = (id, x, kind = 'photo') => ({ id, kind, x, y: 0, rotation: 0 })
const command = (id, x, next) => ({ id, before: [item('a', x)], after: [item('a', next)] })

it('undoes and redoes one layout edit without changing earlier states', () => {
  const empty = createHistory(), edited = recordHistory(empty, command('move', 0, 30))
  const undone = undoHistory(edited)
  expect(undone.items).toEqual([item('a', 0)])
  expect(redoHistory(undone.history).items).toEqual([item('a', 30)])
  expect(empty.past).toHaveLength(0)
  expect(edited.past).toHaveLength(1)
  expect(edited.future).toHaveLength(0)
})

it('undoes a group as one command and pairs reordered members by identity', () => {
  const edited = recordHistory(createHistory(), { id: 'group', before: [item('a', 0), item('b', 400)], after: [item('b', 430), item('a', 30)] })
  const undone = undoHistory(edited)
  expect(undone.items).toEqual([item('a', 0), item('b', 400)])
  expect(undoHistory(undone.history).items).toEqual([])
  expect(redoHistory(undone.history).items).toEqual([item('a', 30), item('b', 430)])
})

it('separates items sharing an id across kinds and preserves rotation and negative coordinates', () => {
  const before = [item('same', -10), item('same', -20, 'mark')]
  const after = [{ ...before[0], rotation: -7 }, { ...before[1], x: -40, y: 80, rotation: 12 }]
  const history = recordHistory(createHistory(), { id: 'mixed', before, after })
  expect(undoHistory(history).items).toEqual(before)
  expect(redoHistory(undoHistory(history).history).items).toEqual(after)
})

it('drops unchanged members and normalizes missing rotation', () => {
  const before = [{ id: 'a', kind: 'entry', x: 0, y: 0 }, item('b', 20)]
  const after = [item('a', 10, 'entry'), item('b', 20)]
  const history = recordHistory(createHistory(), { id: 'partial', before, after })
  expect(undoHistory(history).items).toEqual([item('a', 0, 'entry')])
})

it('leaves empty undo and redo unchanged', () => {
  const history = createHistory()
  expect(undoHistory(history)).toEqual({ history, items: [] })
  expect(redoHistory(history)).toEqual({ history, items: [] })
})

it('keeps redo for a no-op but clears it for a new edit', () => {
  const history = undoHistory(recordHistory(createHistory(), command('first', 0, 30))).history
  expect(recordHistory(history, command('noop', 0, 0))).toBe(history)
  expect(recordHistory(history, { id: 'empty', before: [], after: [] })).toBe(history)
  const branched = recordHistory(history, command('new', 0, 50))
  expect(redoHistory(branched).items).toEqual([])
  expect(undoHistory(branched).items).toEqual([item('a', 0)])
})

it('keeps the latest 100 commands and their undo boundary', () => {
  let history = createHistory()
  for (let index = 0; index < 101; index++) history = recordHistory(history, command('move-' + index, index, index + 1))
  expect(history.past).toHaveLength(100)
  let last
  for (let index = 0; index < 100; index++) { last = undoHistory(history); history = last.history }
  expect(last.items).toEqual([item('a', 1)])
  expect(undoHistory(history).items).toEqual([])
  expect(redoHistory(history).items).toEqual([item('a', 2)])
})

it('takes independent snapshots and does not freeze caller-owned data', () => {
  const input = command('copy', 0, 30), history = recordHistory(createHistory(), input)
  input.before[0].x = 900; input.after[0].x = 1000; input.after.push(item('b', 50))
  expect(undoHistory(history).items).toEqual([item('a', 0)])
  expect(redoHistory(undoHistory(history).history).items).toEqual([item('a', 30)])
  expect(() => { undoHistory(history).items[0].x = 7 }).toThrow(TypeError)
  expect(undoHistory(history).items).toEqual([item('a', 0)])
})

it('accepts 500 objects as one command but rejects 501', () => {
  const before = Array.from({ length: 500 }, (_, index) => item(String(index), 0))
  const after = before.map(value => ({ ...value, x: 1 }))
  expect(undoHistory(recordHistory(createHistory(), { id: 'limit', before, after })).items).toHaveLength(500)
  expect(() => recordHistory(createHistory(), { id: 'over', before: [...before, item('extra', 0)], after: [...after, item('extra', 1)] })).toThrow(TypeError)
})

it.each([
  ['missing command id', value => { value.id = '' }],
  ['different identities', value => { value.after[0].id = 'b' }],
  ['missing member', value => { value.after = [] }],
  ['sparse member list', value => { value.before = []; value.before.length = 1 }],
  ['duplicate identity', value => { value.before.push(item('a', 0)); value.after.push(item('a', 30)) }],
  ['unsupported kind', value => { value.before[0].kind = value.after[0].kind = 'notebook' }],
  ['non-finite coordinate', value => { value.after[0].x = Infinity }],
  ['NaN coordinate', value => { value.after[0].y = NaN }],
  ['coordinate outside bounds', value => { value.after[0].x = 10000001 }],
  ['string coordinate', value => { value.after[0].x = '30' }],
  ['rotation outside bounds', value => { value.after[0].rotation = 21 }],
  ['null rotation', value => { value.after[0].rotation = null }],
  ['empty item id', value => { value.before[0].id = value.after[0].id = '' }],
])('rejects %s without changing the redo branch', (_name, mutate) => {
  const history = undoHistory(recordHistory(createHistory(), command('old', 0, 10))).history
  const invalid = command('invalid', 0, 30); mutate(invalid)
  expect(() => recordHistory(history, invalid)).toThrow(TypeError)
  expect(redoHistory(history).items).toEqual([item('a', 10)])
})
