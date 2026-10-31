// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('keeps atlas geography and optional reading/editing tools out of the production canvas dependency graph', () => {
  const output = execFileSync(process.execPath, ['scripts/check-bundle.mjs'], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('Canvas initial dependency graph excludes deferred features and geography.')
}, 35_000)
