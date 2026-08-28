import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchGuides } from '../../lib/api'
import LikeButton from '../LikeButton'
import { timeAgo, truncate, getPublicUrl } from '../../lib/utils'
import { BookOpen, Loader2 } from 'lucide-react'

export default function GuideList() {
  const navigate = useNavigate()
  const [guides, setGuides] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGuides({ limit: 20 }).then(setGuides).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (guides.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">还没有攻略</p>
        <p className="text-xs mt-1">点击"写攻略"开始分享旅程</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {guides.map((guide, index) => (
        <div
          key={guide.id}
          onClick={() => navigate(`/guide/${guide.id}`)}
          className="p-3 hover:bg-gray-50 transition-colors cursor-pointer list-item-animate"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {guide.cover_image_url && (
            <img src={getPublicUrl('guide-covers', guide.cover_image_url)} alt="" className="w-full h-32 object-cover rounded-lg mb-2" />
          )}
          <h3 className="font-medium text-sm text-gray-900">{guide.title}</h3>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{truncate(guide.content?.replace(/[#*`\n]/g, ' '), 80)}</p>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>{guide.profiles?.nickname || '匿名'}</span>
            <span>{timeAgo(guide.created_at)}</span>
          </div>
          <div className="mt-1.5">
            <LikeButton targetId={guide.id} targetType="guide" count={guide.likes_count} />
          </div>
        </div>
      ))}
    </div>
  )
}
