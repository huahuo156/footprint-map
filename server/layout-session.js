// No pool import: callers supply an initialized database and authenticated data.
async function transaction(database, start, action) {
  const connection = await database.getConnection()
  try {
    await start(connection)
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
}

/** Caller validates email/password and computes the password hash before calling.
 * Account and structure token either both exist or neither exists.
 */
export async function createLayoutUser(database, user) {
  const { id, email, passwordHash, emailVerifiedAt = null } = user
  const verified = emailVerifiedAt instanceof Date ? new Date(emailVerifiedAt) : emailVerifiedAt
  return transaction(database, connection => connection.beginTransaction(), async connection => {
    await connection.execute('INSERT INTO users (id,email,password_hash,email_verified_at) VALUES (?,?,?,?)', [id, email, passwordHash, verified])
    await connection.execute('INSERT INTO journal_layout_state (owner_id) VALUES (?)', [id])
    return { id, structure_version: '0' }
  })
}

/** reader must use the supplied connection for every part of the journal,
 * including notebooks and nested memberships; it must not use the global pool.
 */
export async function readLayoutSnapshot(database, ownerId, reader) {
  if (typeof ownerId !== 'string' || !ownerId || typeof reader !== 'function') throw new TypeError('Invalid layout snapshot reader')
  return transaction(database, async connection => {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
  }, async connection => {
    const [[state]] = await connection.execute('SELECT CAST(structure_version AS CHAR) AS structure_version FROM journal_layout_state WHERE owner_id=?', [ownerId])
    if (!state) throw Object.assign(new Error('请先执行布局版本迁移'), { status: 503, code: 'LAYOUT_MIGRATION_REQUIRED' })
    const journal = await reader(connection, ownerId)
    return { ...journal, structure_version: state.structure_version }
  })
}
