import { expect, it } from 'vitest'
import { resolveLegacyOwner, assertSingleAssetOwner } from '../server/migrate-ownership.js'

it('requires an explicit existing legacy account and never chooses the first signup', async () => {
  await expect(resolveLegacyOwner({ execute: async () => [[{ id: 'first-signup' }]] }, null, true)).rejects.toThrow('legacy-owner')
  expect(await resolveLegacyOwner({ execute: async () => [[{ id: 'specified' }]] }, 'old@example.com', true)).toBe('specified')
  await expect(resolveLegacyOwner({ execute: async () => [[]] }, 'missing@example.com', true)).rejects.toThrow('不存在')
  expect(await resolveLegacyOwner({}, null, false)).toBeNull()
})

it('rejects one historical file referenced by different owners', () => {
  const seen = new Map()
  assertSingleAssetOwner(seen, 'a.jpg', 'owner-a')
  assertSingleAssetOwner(seen, 'a.jpg', 'owner-a')
  expect(() => assertSingleAssetOwner(seen, 'a.jpg', 'owner-b')).toThrow('归属冲突')
})
