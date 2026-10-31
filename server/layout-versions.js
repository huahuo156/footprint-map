const MAX = 18446744073709551615n
const TABLES = { photo: 'journal_photos', entry: 'journal_entries', mark: 'journal_marks' }
const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const invalid = () => error(400, 'INVALID_LAYOUT', '画布位置或版本无效')
const conflict = () => error(409, 'LAYOUT_CONFLICT', '其他页面已修改布局，请重新载入')
const key = item => `${item.kind}:${item.id}`
function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > MAX) throw invalid()
  return value
}

// Call inside an existing transaction, before locking any layout objects.
// The caller owns commit/rollback and may increment once after a structural change.
export async function lockLayoutStructure(db, ownerId, expected) {
  if (typeof ownerId !== 'string' || !ownerId) throw error(401, 'UNAUTHENTICATED', '请先登录')
  if (expected !== undefined) version(expected)
  const [[state]] = await db.execute('SELECT CAST(structure_version AS CHAR) AS structure_version FROM journal_layout_state WHERE owner_id=? FOR UPDATE', [ownerId])
  if (!state) throw error(503, 'LAYOUT_MIGRATION_REQUIRED', '请先执行布局版本迁移')
  if (expected !== undefined && state.structure_version !== expected) throw conflict()
  let incremented = false
  return { version: state.structure_version, async increment() {
    if (incremented) throw new Error('Structure version already incremented')
    if (BigInt(state.structure_version) === MAX) throw conflict()
    incremented = true
    await db.execute('UPDATE journal_layout_state SET structure_version=structure_version+1 WHERE owner_id=?', [ownerId])
    return String(BigInt(state.structure_version) + 1n)
  } }
}
/** For business writers inside a caller-owned transaction, after locking the
 * account structure row. Checks the whole batch before exposing any increments.
 * Call increment only for objects whose layout actually changed; caller must
 * roll back the entire transaction on any error. No commit/release here.
 */
export async function lockLayoutObjects(db, ownerId, items) {
  if (typeof ownerId !== 'string' || !ownerId) throw error(401, 'UNAUTHENTICATED', '请先登录')
  if (!Array.isArray(items) || !items.length || items.length > 500) throw invalid()
  const batch = Array.from(items, item => {
    if (!item || !Object.hasOwn(TABLES, item.kind) || typeof item.kind !== 'string' || typeof item.id !== 'string' || !/^[a-f\d-]{36}$/i.test(item.id)) throw invalid()
    return { kind: item.kind, id: item.id.toLowerCase(), expected_version: item.expected_version === undefined ? undefined : version(item.expected_version) }
  })
  if (new Set(batch.map(key)).size !== batch.length || batch.some(item => (item.expected_version !== undefined) !== (batch[0].expected_version !== undefined))) throw invalid()
  batch.sort((a, b) => key(a).localeCompare(key(b)))
  const locked = new Map()
  for (const item of batch) {
    const table = TABLES[item.kind]
    const owner = item.kind === 'photo' ? 'EXISTS (SELECT 1 FROM journal_entries owner_entry WHERE owner_entry.id=journal_photos.entry_id AND owner_entry.owner_id=?)' : 'owner_id=?'
    const [[row]] = await db.execute(`SELECT rotation,CAST(layout_version AS CHAR) AS layout_version FROM ${table} WHERE id=? AND ${owner} FOR UPDATE`, [item.id, ownerId])
    if (!row) throw error(404, 'LAYOUT_ITEM_MISSING', '照片或记录已经不存在了')
    if (item.expected_version !== undefined && item.expected_version !== row.layout_version) throw conflict()
    locked.set(key(item), { item, row, owner, incremented: false })
  }
  return { async increment(kind, id) {
    const state = locked.get(key({ kind, id }))
    if (!state || state.incremented) throw new Error('Object not locked or already incremented')
    if (BigInt(state.row.layout_version) === MAX) throw conflict()
    state.incremented = true
    await db.execute(`UPDATE ${TABLES[state.item.kind]} SET layout_version=layout_version+1 WHERE id=? AND ${state.owner}`, [state.item.id, ownerId])
    return String(BigInt(state.row.layout_version) + 1n)
  } }
}
function normalize(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 500) throw invalid()
  const versioned = body.expected_structure_version !== undefined
  const structure = versioned ? version(body.expected_structure_version) : null
  const items = Array.from(body.items, item => {
    if (!item || typeof item.kind !== 'string' || !Object.hasOwn(TABLES, item.kind) || typeof item.id !== 'string' || !/^[a-f\d-]{36}$/i.test(item.id)) throw invalid()
    const rotation = item.rotation ?? 0
    if (![item.x, item.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7) || !Number.isFinite(rotation) || Math.abs(rotation) > 20) throw invalid()
    if ((item.expected_version !== undefined) !== versioned) throw invalid()
    return { id: item.id.toLowerCase(), kind: item.kind, x: item.x, y: item.y, rotation, expected_version: versioned ? version(item.expected_version) : null }
  })
  if (new Set(items.map(key)).size !== items.length) throw invalid()
  return { items, structure, versioned }
}

/** Owns one transaction on a caller-owned connection, never releases it.
 * ownerId must come from authenticated request context, never the request body.
 * Runtime routes switch to this service only after all version writers are ready.
 */
export async function writeLayout(db, ownerId, body) {
  const request = normalize(body)
  if (typeof ownerId !== 'string' || !ownerId) throw error(401, 'UNAUTHENTICATED', '请先登录')
  await db.beginTransaction()
  try {
    await lockLayoutStructure(db, ownerId, request.versioned ? request.structure : undefined)
    const rows = new Map()
    const sorted = [...request.items].sort((a, b) => key(a).localeCompare(key(b)))
    for (const item of sorted) {
      const table = TABLES[item.kind]
      const owner = item.kind === 'photo' ? 'EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=journal_photos.entry_id AND e.owner_id=?)' : 'owner_id=?'
      const [[row]] = await db.execute(`SELECT canvas_x,canvas_y,rotation,${item.kind === 'photo' ? 'canvas_absolute,' : ''}CAST(layout_version AS CHAR) AS layout_version FROM ${table} WHERE id=? AND ${owner} FOR UPDATE`, [item.id, ownerId])
      if (!row) throw error(404, 'LAYOUT_ITEM_MISSING', '照片或记录已经不存在了')
      rows.set(key(item), row)
    }
    const fresh = !request.versioned || sorted.every(item => rows.get(key(item)).layout_version === item.expected_version)
    const replay = request.versioned && sorted.every(item => {
      const row = rows.get(key(item))
      return BigInt(row.layout_version) === BigInt(item.expected_version) + 1n && row.canvas_x === item.x && row.canvas_y === item.y && row.rotation === item.rotation && (item.kind !== 'photo' || Number(row.canvas_absolute) === 1)
    })
    if (!fresh && !replay) throw conflict()
    if (fresh && sorted.some(item => BigInt(rows.get(key(item)).layout_version) === MAX)) throw conflict()
    if (fresh) for (const item of sorted) {
      const table = TABLES[item.kind]
      const owner = item.kind === 'photo' ? 'EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=journal_photos.entry_id AND e.owner_id=?)' : 'owner_id=?'
      await db.execute(`UPDATE ${table} SET canvas_x=?,canvas_y=?,rotation=?,layout_version=layout_version+1${item.kind === 'photo' ? ',canvas_absolute=TRUE' : ''} WHERE id=? AND ${owner}`, [item.x, item.y, item.rotation, item.id, ownerId])
    }
    const items = request.items.map(item => ({ id: item.id, kind: item.kind, layout_version: String(BigInt(rows.get(key(item)).layout_version) + (fresh ? 1n : 0n)) }))
    await db.commit()
    return { saved: items.length, items }
  } catch (failure) { await db.rollback(); throw failure }
}
