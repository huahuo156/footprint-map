import { expect, it } from 'vitest'
import { incrementMetric, metricsSnapshot } from '../server/telemetry.js'

it('accepts only fixed numeric counters and returns independent snapshots', () => {
  const before = metricsSnapshot()
  incrementMetric('mail_success')
  incrementMetric('restore_active', 1)
  incrementMetric('restore_active', -1)
  expect(metricsSnapshot().mail_success).toBe(before.mail_success + 1)
  expect(metricsSnapshot().restore_active).toBe(0)
  before.mail_success = -100
  expect(metricsSnapshot().mail_success).toBeGreaterThanOrEqual(1)
  expect(() => incrementMetric('user@example.com')).toThrow()
  expect(() => incrementMetric('mail_success', -1)).toThrow()
  expect(() => incrementMetric('mail_success', NaN)).toThrow()
  expect(Object.values(metricsSnapshot()).every(Number.isFinite)).toBe(true)
})
