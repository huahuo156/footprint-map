import { useImageResource } from './ImageResourceProvider.jsx'

function PrefetchLease({ src }) {
  useImageResource({ src, priority: 'prefetch', role: 'prefetch' })
  return null
}

// Each child owns one cancellable cache lease; prefetch never creates an image.
export default function ImageResourcePrefetch({ enabled = false, sources = [], profile = 'desktop' }) {
  if (!enabled) return null
  const unique = new Set()
  const limit = profile === 'desktop' ? 8 : 4
  for (const src of sources) {
    if (typeof src !== 'string' || !/^\/uploads\/[\w-]+\.(jpg|png|webp)(\?thumbnail=1)?$/.test(src)) continue
    unique.add(src.split('?')[0] + '?thumbnail=1')
    if (unique.size >= limit) break
  }
  return [...unique].map(src => <PrefetchLease key={src} src={src} />)
}
