// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { acquireRestoreSlot } from '../server/restore-runner.js'

it('revokes admission when the MySQL lock session is lost', async () => {
  const connection = new EventEmitter()
  connection.query = vi.fn(async () => [[{ acquired: 1 }]])
  connection.release = vi.fn(); connection.destroy = vi.fn()
  connection.on('error', () => {})
  const release = await acquireRestoreSlot('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { database: { getConnection: async () => connection } })
  connection.emit('error', new Error('socket lost'))
  expect(release.signal?.aborted).toBe(true)
  await release()
  expect(connection.destroy).toHaveBeenCalledOnce()
})
