const EMPTY = Object.freeze([])
const key = item => `${item.kind}:${item.id}`
const state = (past, future) => Object.freeze({ past: Object.freeze(past), future: Object.freeze(future) })

function position(value) {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || !['photo', 'entry', 'mark'].includes(value.kind)) throw new TypeError('Invalid layout identity')
  const rotation = value.rotation === undefined ? 0 : value.rotation
  if (![value.x, value.y].every(number => Number.isFinite(number) && Math.abs(number) <= 1e7) || !Number.isFinite(rotation) || Math.abs(rotation) > 20) throw new TypeError('Invalid layout position')
  return Object.freeze({ id: value.id, kind: value.kind, x: value.x, y: value.y, rotation })
}

function positions(values) {
  if (!Array.isArray(values) || values.length > 500) throw new TypeError('Invalid layout batch')
  const result = Array.from(values, position)
  if (new Set(result.map(key)).size !== result.length) throw new TypeError('Duplicate layout identity')
  return result
}

/** Shared validation and immutable position snapshots for history/persistence. */
export function snapshotLayoutPositions(values) { return Object.freeze(positions(values)) }

/** History owns frozen copies of commands; API versions belong to persistence. */
export function createHistory() { return state([], []) }

export function recordHistory(history, command) {
  if (!command || typeof command.id !== 'string' || !command.id.trim()) throw new TypeError('Invalid layout command')
  const before = positions(command.before), after = positions(command.after)
  const byKey = new Map(after.map(item => [key(item), item]))
  if (before.length !== after.length || before.some(item => !byKey.has(key(item)))) throw new TypeError('Layout identities do not match')
  const changed = before.filter(item => {
    const next = byKey.get(key(item))
    return item.x !== next.x || item.y !== next.y || item.rotation !== next.rotation
  })
  if (!changed.length) return history
  const entry = Object.freeze({ id: command.id, before: Object.freeze(changed), after: Object.freeze(changed.map(item => byKey.get(key(item)))) })
  return state([...history.past, entry].slice(-100), [])
}

export function undoHistory(history) {
  const command = history.past.at(-1)
  if (!command) return { history, items: EMPTY }
  return { history: state(history.past.slice(0, -1), [...history.future, command]), items: command.before }
}

export function redoHistory(history) {
  const command = history.future.at(-1)
  if (!command) return { history, items: EMPTY }
  return { history: state([...history.past, command], history.future.slice(0, -1)), items: command.after }
}
