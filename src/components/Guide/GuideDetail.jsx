import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchGuide } from '../../lib/api'
import LikeButton from '../LikeButton'
import { timeAgo } from '../../lib/utils'
import { ArrowLeft, Loader2, MapPin } from 'lucide-react'

export default function GuideDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [guide, setGuide] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchGuide(id).then(setGuide).catch(console.error).finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-400">
        <p>攻略不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-blue-600 hover:underline">返回首页</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> 返回
        </button>
      </header>

      <article className="max-w-3xl mx-auto p-6">
        {guide.cover_image_url && (
          <img src={guide.cover_image_url} alt="" className="w-full h-64 object-cover rounded-xl mb-6" />
        )}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{guide.title}</h1>
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
          <span>{guide.profiles?.nickname || '匿名'}</span>
          <span>{timeAgo(guide.created_at)}</span>
          {guide.province && (
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{guide.province}</span>
          )}
          <LikeButton targetId={guide.id} targetType="guide" count={guide.likes_count} />
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
            {guide.content || '（无内容）'}
          </div>
        </div>
      </article>
    </div>
  )
}
