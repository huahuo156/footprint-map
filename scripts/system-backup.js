import 'dotenv/config'
import mysql from 'mysql2/promise'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSystemBackup, assertOffline } from '../server/system-backup.js'

const args = process.argv.slice(2)
if (args.some((value, index) => value !== '--offline' && value !== '--out' && args[index - 1] !== '--out') || args.filter(value => value === '--out').length !== 1 || !args[args.indexOf('--out') + 1] || args[args.indexOf('--out') + 1].startsWith('--')) throw new Error('Usage: node scripts/system-backup.js --offline --out <new-private-directory>')
const offline = args.includes('--offline')
await assertOffline({ offline })
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'footprint', password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'footprint_map', charset: 'utf8mb4', timezone: 'Z',
  dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
  ...(process.env.MYSQL_SSL_CA ? { ssl: { ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true } } : {}),
})
try {
  console.log(JSON.stringify(await createSystemBackup({ connection, offline,
    uploadDirectory: process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : fileURLToPath(new URL('../uploads/', import.meta.url)),
    outputDirectory: path.resolve(args[args.indexOf('--out') + 1]),
  }), null, 2))
} finally { await connection.end() }
