// 景点评级与类别工具：从数据库字段推导徽章、元信息与颜色。
// 数据来源：supabase/migrations/20260828000000_replace_landmarks.sql，
// description 形如「国家5A景区，2020年评定」。

export const CATEGORY_COLORS = {
  '历史古迹': '#f59e0b',
  '自然风光': '#22c55e',
  '现代建筑': '#3b82f6',
  '民俗文化': '#a855f7',
  '宗教圣地': '#f43f5e',
}

export const DEFAULT_CATEGORY_COLOR = '#64748b'

/**
 * 从 description 解析政府评级与评定年份。
 * 形如「国家5A景区，2020年评定」→ { rating: '5A', year: 2020, isOfficial: true }
 * 兜底：名称含「4A」→ 4A；含「5A」→ 5A；否则默认 5A。
 * @param {string} name - 景点名称
 * @param {string} [description] - 景点描述
 * @returns {{ rating: '5A'|'4A', year: number|null }}
 */
export function parseRating(name, description) {
  const text = `${name || ''} ${description || ''}`
  const ratingMatch = text.match(/(5A|4A)/)
  const rating = ratingMatch ? ratingMatch[1] : '5A'

  const yearMatch = (description || '').match(/(20\d{2})\s*年/)
  const year = yearMatch ? Number(yearMatch[1]) : null

  return { rating, year }
}

/** 徽章文本：5A / 4A */
export function ratingBadge(landmark) {
  const { rating } = parseRating(landmark.name, landmark.description)
  return rating
}

/** 元信息文本：如「国家5A · 2007」 */
export function ratingMeta(landmark) {
  const { rating, year } = parseRating(landmark.name, landmark.description)
  const label = `国家${rating}`
  return year ? `${label} · ${year}` : label
}

/** 类别颜色 */
export function categoryColor(category) {
  return CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR
}
