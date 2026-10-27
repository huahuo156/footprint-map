import { verifyRecoveryPoint } from '../server/system-backup.js'
if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-system-backup.js <backup-directory>')
const { manifest, database } = await verifyRecoveryPoint(process.argv[2])
console.log(JSON.stringify({ verified: true, createdAt: manifest.createdAt, tables: database.tables.length, rows: database.tables.reduce((sum, table) => sum + table.rows.length, 0), images: manifest.files.length - 1 }, null, 2))
