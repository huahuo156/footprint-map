import { useEffect, useState, useRef, useCallback } from 'react'
import { fetchCheckins } from '../../lib/api'
import { useMapContext } from '../../contexts/MapContext'
import LikeButton from '../LikeButton'
import { timeAgo, truncate, getPublicUrl } from '../../lib/utils'
import { MapPin, Loader2, Camera } from 'lucide-react'

export default function CheckinList() {
  const [checkins, setCheckins] = useState([])
  const [loading, setLoading] = useState(true)
  const { setHoveredItem, clearHoveredItem, flyToLocation } = useMapContext()
  const imgRefs = useRef({})

  useEffect(() => {
    fetchCheckins({ limit: 30 }).then(setCheckins).catch(console.error).finally(() => setLoading(false))
  }, [])

  const handleMouseEnter = useCallback((checkin) => {
    const imgEl = imgRefs.current[checkin.id]
    if (!imgEl) return
    const rect = imgEl.getBoundingClientRect()
    setHoveredItem(`checkin-${checkin.id}`, 'checkin', rect, checkin.lat, checkin.lng)
  }, [setHoveredItem])

  const handleMouseLeave = useCallback(() => {
    clearHoveredItem()
  }, [clearHoveredItem])

  const handleClick = useCallback((checkin) => {
    flyToLocation(checkin.lat, checkin.lng, 8)
  }, [flyToLocation])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (checkins.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">还没有打卡记录</p>
        <p className="text-xs mt-1">点击地图开始打卡吧！</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {checkins.map((checkin, index) => {
        const imageUrl = checkin.image_url?.startsWith('http')
          ? checkin.image_url
          : getPublicUrl('checkin-images', checkin.image_url)
        return (
          <div
            key={checkin.id}
            className="p-3 hover:bg-gray-50 transition-colors cursor-pointer list-item-animate"
            style={{ animationDelay: `${index * 50}ms` }}
            onMouseEnter={() => handleMouseEnter(checkin)}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleClick(checkin)}
          >
            <div className="flex gap-3">
              <img
                ref={(el) => { imgRefs.current[checkin.id] = el }}
                src={imageUrl}
                alt=""
                className="w-16 h-16 rounded-lg object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 line-clamp-2">{truncate(checkin.caption, 60) || '无描述'}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>{checkin.profiles?.nickname || '匿名'}</span>
                  <span>·</span>
                  <span>{timeAgo(checkin.created_at)}</span>
                  {checkin.province && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{checkin.province}</span>
                    </>
                  )}
                </div>
                <div className="mt-1.5">
                  <LikeButton targetId={checkin.id} targetType="checkin" count={checkin.likes_count} />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
