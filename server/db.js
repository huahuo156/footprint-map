import 'dotenv/config'
import mysql from 'mysql2/promise'
import { readFile } from 'node:fs/promises'

export function createDatabasePool() { return mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'footprint',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'footprint_map',
  charset: 'utf8mb4',
  timezone: 'Z',
  connectionLimit: 10,
}) }
export const pool = createDatabasePool()

export async function initializeDatabase() {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  for (const statement of schema.split(';').filter(s => s.trim())) {
    await pool.query(statement)
  }
  const journalSchema = await readFile(new URL('./journal-schema.sql', import.meta.url), 'utf8')
  for (const statement of journalSchema.split(';').filter(s => s.trim())) await pool.query(statement)
  await migrateComposer()
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM landmarks')
  if (!count) {
    const seed = await readFile(new URL('./landmarks.sql', import.meta.url), 'utf8')
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      for (const statement of seed.split(';').filter(s => s.trim())) await connection.query(statement)
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
  await migrateLegacyCheckins()
}

async function migrateComposer() {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('shitu-composer-v1', 20) AS acquired")
    if (!lock.acquired) throw new Error('等待手帐结构升级超时，请重试')
    locked = true
    // Run before the composer marker: existing installations may have already
    // completed that migration while still needing notebook cover metadata.
    for (const [column, definition] of [['cover_label', "VARCHAR(60) NOT NULL DEFAULT 'MEMO'"], ['cover_text', "VARCHAR(500) NOT NULL DEFAULT ''"], ['bookmark_page_id', 'CHAR(36) NULL'], ['last_read_page_id', 'CHAR(36) NULL']]) {
      const [columns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_notebooks' AND COLUMN_NAME=?", [column])
      if (!columns.length) await connection.query(`ALTER TABLE journal_notebooks ADD COLUMN ${column} ${definition}`)
    }
    const [coverColumns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_notebooks' AND COLUMN_NAME='cover_mode'")
    if (!coverColumns.length) await connection.query('ALTER TABLE journal_notebooks ADD COLUMN cover_mode VARCHAR(10) NULL')
    // Nullable intermediate column makes interrupted upgrades safe to resume.
    await connection.query("UPDATE journal_notebooks SET cover_mode=CASE WHEN COALESCE(cover_url,'')<>'' THEN 'photo' ELSE 'solid' END WHERE cover_mode IS NULL")
    await connection.query("ALTER TABLE journal_notebooks MODIFY cover_mode VARCHAR(10) NOT NULL DEFAULT 'solid'")
    const [colorColumns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_notebooks' AND COLUMN_NAME='cover_color'")
    if (!colorColumns.length) await connection.query("ALTER TABLE journal_notebooks ADD COLUMN cover_color CHAR(7) NOT NULL DEFAULT '#e3e9dd'")
    const [groupColumns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_canvas_groups' AND COLUMN_NAME='collapsed'")
    if (!groupColumns.length) await connection.query('ALTER TABLE journal_canvas_groups ADD COLUMN collapsed BOOLEAN NOT NULL DEFAULT FALSE')
    const [layoutColumns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_photos' AND COLUMN_NAME='canvas_absolute'")
    if (!layoutColumns.length) await connection.query('ALTER TABLE journal_photos ADD COLUMN canvas_absolute BOOLEAN NOT NULL DEFAULT FALSE')
    const [markers] = await connection.query("SELECT name FROM journal_migrations WHERE name='photo-components-v1'")
    if (markers.length) return
    for (const [table, column, type] of [['journal_entries', 'components', 'JSON'], ['journal_entries', 'captured_on', 'DATE'], ['journal_photos', 'components', 'JSON']]) {
      const [columns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column])
      if (!columns.length) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type} NULL`)
    }
    await connection.query('ALTER TABLE journal_entries MODIFY trip_id CHAR(36) NULL, MODIFY mood VARCHAR(20) NULL DEFAULT NULL')
    await connection.query('UPDATE journal_entries SET captured_on=entry_date WHERE captured_on IS NULL')
    await connection.query("INSERT IGNORE INTO journal_migrations (name) VALUES ('photo-components-v1')")
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('shitu-composer-v1')")
    connection.release()
  }
}

async function migrateLegacyCheckins() {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [marker] = await connection.execute("INSERT IGNORE INTO journal_migrations (name) VALUES ('legacy-checkins-v1')")
    if (marker.affectedRows) {
      const [regions] = await connection.query("SELECT DISTINCT COALESCE(NULLIF(province,''),'未分类') AS region FROM checkins ORDER BY region")
      for (const [index, row] of regions.entries()) {
        await connection.execute('INSERT INTO journal_trips (id,name,region,legacy_key,canvas_x,canvas_y) VALUES (UUID(),?,?,?,?,?)', [row.region, row.region, row.region, index % 3 * 800, Math.floor(index / 3) * 900])
      }
      await connection.query(`INSERT INTO journal_entries (id,trip_id,entry_date,caption,place_name,landmark_id,lat,lng,legacy_checkin_id)
        SELECT UUID(),t.id,DATE(CONVERT_TZ(c.created_at,'+00:00','+08:00')),c.caption,COALESCE(l.name,c.province,'旅行记忆'),c.landmark_id,c.lat,c.lng,c.id
        FROM checkins c JOIN journal_trips t ON t.legacy_key=COALESCE(NULLIF(c.province,''),'未分类') LEFT JOIN landmarks l ON l.id=c.landmark_id`)
      await connection.query(`INSERT INTO journal_photos (id,entry_id,url)
        SELECT UUID(),e.id,c.image_url FROM journal_entries e JOIN checkins c ON c.id=e.legacy_checkin_id`)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
