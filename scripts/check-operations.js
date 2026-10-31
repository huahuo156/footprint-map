import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function checkOperations({ url = process.env.OPERATIONS_URL, token = process.env.OPERATIONS_TOKEN, fetcher = fetch } = {}) {
  if (!url || typeof token !== 'string' || token.length < 32) throw new Error('Configure OPERATIONS_URL and OPERATIONS_TOKEN (at least 32 characters)')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid operations URL')
  const response = await fetcher(parsed.href, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) throw new Error(`Operations HTTP ${response.status}`)
  const status = await response.json()
  if (!Array.isArray(status.warnings) || status.warnings.some(w => typeof w !== 'string')) throw new Error('Invalid operations status')
  return { ok: status.warnings.length === 0, warnings: status.warnings }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkOperations()
    console.log(JSON.stringify({ ok: result.ok, warningCount: result.warnings.length }))
    if (!result.ok) process.exitCode = 1
  } catch { console.error(JSON.stringify({ ok: false, code: 'OPERATIONS_CHECK_FAILED' })); process.exitCode = 1 }
}
