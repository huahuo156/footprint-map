const counters = Object.fromEntries([
  'mail_success', 'mail_failure', 'http_requests', 'http_server_errors', 'storage_rejections',
  'restore_started', 'restore_succeeded', 'restore_failed', 'restore_active',
  'maintenance_success', 'maintenance_failure',
].map(name => [name, 0]))

export function incrementMetric(name, delta = 1) {
  if (!Object.hasOwn(counters, name)) throw new TypeError('Unknown metric')
  if (!Number.isSafeInteger(delta) || (delta < 0 && name !== 'restore_active')) throw new TypeError('Invalid metric delta')
  counters[name] = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, counters[name] + delta))
}

export function metricsSnapshot() { return { ...counters } }
