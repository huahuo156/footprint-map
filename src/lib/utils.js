/**
 * Format a timestamp to relative time string (e.g. "3小时前")
 */
export function timeAgo(dateStr) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

/**
 * Format a number with abbreviation (e.g. 1200 -> "1.2k")
 */
export function formatCount(num) {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * Get Supabase public URL for a storage object
 */
export function getPublicUrl(bucket, path) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  return `${baseUrl}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * Generate a random filename for uploads
 */
export function randomFilename(originalName) {
  const ext = originalName.split('.').pop()
  const random = crypto.randomUUID()
  return `${random}.${ext}`
}
