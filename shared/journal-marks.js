export const MARK_COLORS = ['ink', 'sage', 'sand', 'sky', 'rose', 'lavender']
export const MARK_SIZES = ['small', 'medium', 'large']
export const STICKERS = ['leaf', 'flower', 'sun', 'cloud', 'mountain', 'plane', 'heart', 'star', 'coffee', 'pin', 'camera', 'sparkles']
export const STICKER_LABELS = { leaf: '叶子', flower: '小花', sun: '太阳', cloud: '云朵', mountain: '山峰', plane: '飞机', heart: '爱心', star: '星星', coffee: '咖啡', pin: '路标', camera: '相机', sparkles: '闪光' }
export function markDimensions(mark) {
  if (mark.kind === 'sticker') { const side = { small: 80, medium: 112, large: 152 }[mark.size] || 112; return { width: side, height: side } }
  const fontSize = { small: 18, medium: 24, large: 32 }[mark.size] || 24
  const paragraphs = (mark.text || '').split('\n').map(line => [...line].reduce((count, char) => count + (char.codePointAt(0) > 255 ? 1 : .62), 0))
  const width = Math.max(132, Math.min(260, Math.ceil(Math.max(...paragraphs) * fontSize) + 74))
  const lines = paragraphs.reduce((total, units) => total + Math.max(1, Math.ceil(units * fontSize / (width - 74))), 0)
  return { width, height: Math.ceil(lines * fontSize * 1.7 + 74), fontSize }
}
