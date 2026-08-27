import { useLikes } from '../hooks/useLikes'
import { Heart } from 'lucide-react'
import { formatCount } from '../lib/utils'

export default function LikeButton({ targetId, targetType, count = 0 }) {
  const { liked, count: liveCount, loading, toggle } = useLikes(targetId, targetType, count)

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle() }}
      disabled={loading}
      className={`inline-flex items-center gap-1 text-xs transition-colors ${
        liked ? 'text-red-500' : 'text-gray-400 hover:text-red-400'
      }`}
    >
      <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''} ${loading ? 'animate-pulse' : ''}`} />
      <span>{formatCount(liveCount)}</span>
    </button>
  )
}
