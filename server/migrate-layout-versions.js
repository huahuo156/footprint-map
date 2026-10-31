// Explicit migration only. Importing this module never connects or changes schema.
const TABLES = ['journal_entries', 'journal_photos', 'journal_marks']
const MARKER = 'layout-versions-v1'
const fail = detail => { throw new Error(`布局版本结构无效（${detail}），请备份后执行 npm run db:migrate`) }

async function column(db, table, name) {
  const [rows] = await db.query('SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, name])
  return rows[0]
}
function versionColumn(value, name) {
  if (!value || value.COLUMN_TYPE.toLowerCase() !== 'bigint unsigned' || value.IS_NULLABLE !== 'NO' || String(value.COLUMN_DEFAULT) !== '0') fail(name)
}
async function stateTable(db) {
  versionColumn(await column(db, 'journal_layout_state', 'structure_version'), 'structure_version')
  const owner = await column(db, 'journal_layout_state', 'owner_id')
  if (!owner || owner.COLUMN_TYPE.toLowerCase() !== 'char(36)' || owner.IS_NULLABLE !== 'NO') fail('owner_id')
  const [primary] = await db.query("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_layout_state' AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX")
  if (primary.length !== 1 || primary[0].COLUMN_NAME !== 'owner_id') fail('owner primary key')
  const [foreign] = await db.query("SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA=DATABASE() AS same_schema,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='journal_layout_state' AND k.REFERENCED_TABLE_NAME IS NOT NULL")
  if (foreign.length !== 1 || foreign[0].COLUMN_NAME !== 'owner_id' || Number(foreign[0].same_schema) !== 1 || foreign[0].REFERENCED_TABLE_NAME !== 'users' || foreign[0].REFERENCED_COLUMN_NAME !== 'id' || foreign[0].DELETE_RULE !== 'CASCADE') fail('owner foreign key')
  const [[table]] = await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_layout_state'")
  if (table?.ENGINE !== 'InnoDB') fail('state engine')
}

/** Caller owns connection and a stopped-application maintenance window. */
export async function migrateLayoutVersions(db) {
  const [[lock]] = await db.query("SELECT GET_LOCK('shitu-layout-versions-v1',20) AS acquired")
  if (Number(lock.acquired) !== 1) throw new Error('布局版本迁移正在运行，请稍后重试')
  try {
    for (const table of TABLES) {
      if (!await column(db, table, 'layout_version')) await db.query(`ALTER TABLE ${table} ADD COLUMN layout_version BIGINT UNSIGNED NOT NULL DEFAULT 0`)
      versionColumn(await column(db, table, 'layout_version'), table + '.layout_version')
    }
    await db.query(`CREATE TABLE IF NOT EXISTS journal_layout_state (
      owner_id CHAR(36) PRIMARY KEY,
      structure_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await stateTable(db)
    await db.query('INSERT INTO journal_layout_state (owner_id) SELECT u.id FROM users u LEFT JOIN journal_layout_state s ON s.owner_id=u.id WHERE s.owner_id IS NULL')
    await db.query('INSERT IGNORE INTO journal_migrations (name) VALUES (?)', [MARKER])
  } finally { await db.query("SELECT RELEASE_LOCK('shitu-layout-versions-v1')") }
}

/** Read-only readiness check; never repairs a missing column or account row. */
export async function assertLayoutVersions(db) {
  const [markers] = await db.query('SELECT name FROM journal_migrations WHERE name=?', [MARKER])
  if (!markers.length) fail('missing migration marker')
  for (const table of TABLES) versionColumn(await column(db, table, 'layout_version'), table + '.layout_version')
  await stateTable(db)
  const [missing] = await db.query('SELECT u.id FROM users u LEFT JOIN journal_layout_state s ON s.owner_id=u.id WHERE s.owner_id IS NULL LIMIT 1')
  if (missing.length) fail('missing account state')
}
