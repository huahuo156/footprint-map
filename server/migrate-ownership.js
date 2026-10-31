import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export const OWNER_TABLES = ['journal_trips', 'journal_entries', 'journal_marks', 'journal_canvas_groups', 'journal_notebooks']
export async function resolveLegacyOwner(db, email, needed) {
  if (!email && needed) throw new Error('发现历史资料，必须显式指定 --legacy-owner=email；不会分配给第一个注册用户')
  if (!email) return null
  const [[user]] = await db.execute('SELECT id FROM users WHERE email=?', [email.trim().toLowerCase()])
  if (!user) throw new Error('指定旧账号不存在，请先运行 db:create-user')
  return user.id
}
export function assertSingleAssetOwner(seen, key, owner) {
  if (seen.has(key) && seen.get(key) !== owner) throw new Error(`文件归属冲突：${key}`)
  seen.set(key, owner)
}

// Run only while the application is stopped, using migration credentials and a recovery point.
export async function migrateOwnership(db, { legacyOwnerEmail, uploadDirectory }) {
  const [[lock]] = await db.query("SELECT GET_LOCK('shitu-ownership-v1',20) AS acquired")
  if (!lock.acquired) throw new Error('迁移正在运行')
  try {
    let unowned = 0
    for (const table of OWNER_TABLES) {
      const [columns] = await db.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, 'owner_id'])
      if (!columns.length) await db.query(`ALTER TABLE ${table} ADD COLUMN owner_id CHAR(36) NULL, ADD INDEX idx_${table}_owner (owner_id), ADD CONSTRAINT fk_${table}_owner FOREIGN KEY (owner_id) REFERENCES users(id)`)
      const [[row]] = await db.query(`SELECT COUNT(*) AS total FROM ${table} WHERE owner_id IS NULL`)
      unowned += Number(row.total)
    }
    const files = (await readdir(uploadDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error })).filter(name => /^[\w-]+\.(jpg|png|webp)$/.test(name))
    const [registered] = await db.query('SELECT storage_key FROM assets')
    const known = new Set(registered.map(row => row.storage_key))
    const legacyOwner = await resolveLegacyOwner(db, legacyOwnerEmail, unowned > 0 || files.some(name => !known.has(name)))
    await db.beginTransaction()
    try {
      if (legacyOwner) for (const table of OWNER_TABLES) await db.execute(`UPDATE ${table} SET owner_id=? WHERE owner_id IS NULL`, [legacyOwner])
      const [[badTrip]] = await db.query('SELECT COUNT(*) AS total FROM journal_entries e JOIN journal_trips t ON t.id=e.trip_id WHERE e.owner_id<>t.owner_id')
      const [[badGroup]] = await db.query('SELECT COUNT(*) AS total FROM journal_canvas_group_photos m JOIN journal_photos p ON p.id=m.photo_id JOIN journal_entries e ON e.id=p.entry_id JOIN journal_canvas_groups g ON g.id=m.group_id WHERE e.owner_id<>g.owner_id')
      const [[badChild]] = await db.query('SELECT COUNT(*) AS total FROM journal_canvas_group_children m JOIN journal_canvas_groups c ON c.id=m.child_id JOIN journal_canvas_groups p ON p.id=m.parent_id WHERE c.owner_id<>p.owner_id')
      if (Number(badTrip.total) || Number(badGroup.total) || Number(badChild.total)) throw new Error('历史资源父级归属不一致，迁移已回滚')
      for (const [kind, table, joins] of [
        ['photo', 'journal_photos', 'JOIN journal_entries e ON e.id=s.entry_id'], ['mark', 'journal_marks', ''], ['entry', 'journal_entries', ''],
      ]) {
        const owner = kind === 'photo' ? 'e.owner_id' : 's.owner_id'
        const [[bad]] = await db.query(`SELECT COUNT(*) AS total FROM journal_notebook_${kind}_items i JOIN ${table} s ON s.id=i.id ${joins} JOIN journal_notebook_pages p ON p.id=i.page_id JOIN journal_notebooks n ON n.id=p.notebook_id WHERE ${owner}<>n.owner_id`)
        if (Number(bad.total)) throw new Error('手札内容归属不一致，迁移已回滚')
      }
      const [references] = await db.query('SELECT e.owner_id,p.url FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id UNION ALL SELECT owner_id,cover_url AS url FROM journal_notebooks WHERE cover_url IS NOT NULL')
      const seen = new Map()
      for (const row of references) {
        const match = /^\/uploads\/([\w-]+\.(jpg|png|webp))$/.exec(row.url || '')
        if (match) assertSingleAssetOwner(seen, match[1], row.owner_id)
      }
      for (const name of files) {
        const [[existing]] = await db.execute('SELECT owner_id FROM assets WHERE storage_key=?', [name])
        const owner = seen.get(name) || existing?.owner_id || legacyOwner
        if (!owner && !known.has(name)) throw new Error('存在未归属图片，请指定旧账号')
        if (!owner) continue
        if (existing && existing.owner_id !== owner) throw new Error(`文件归属冲突：${name}`)
        if (!existing) {
          const file = await stat(path.join(uploadDirectory, name))
          if (!file.isFile()) continue
          await db.execute("INSERT INTO assets (storage_key,owner_id,bytes,mime,status) VALUES (?,?,?,?,'active')", [name, owner, file.size, name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : 'image/webp'])
        }
      }
      await db.commit()
    } catch (error) { await db.rollback(); throw error }
    // DDL commits implicitly. Each operation is resumable after interruption.
    for (const table of OWNER_TABLES) await db.query(`ALTER TABLE ${table} MODIFY owner_id CHAR(36) NOT NULL`)
    await db.query("INSERT IGNORE INTO journal_migrations (name) VALUES ('ownership-v1')")
  } finally { await db.query("SELECT RELEASE_LOCK('shitu-ownership-v1')") }
}
