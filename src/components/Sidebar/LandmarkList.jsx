import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchLandmarks } from '../../lib/api'
import { useMapContext } from '../../contexts/MapContext'
import { MapPin, Loader2, Landmark } from 'lucide-react'

const CATEGORY_COLORS = {
  '历史古迹': 'bg-amber-100 text-amber-700',
  '自然风光': 'bg-green-100 text-green-700',
  '现代建筑': 'bg-blue-100 text-blue-700',
  '民俗文化': 'bg-purple-100 text-purple-700',
  '宗教圣地': 'bg-rose-100 text-rose-700',
}

export default function LandmarkList() {
  const { name } = useParams()
  const [landmarks, setLandmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const { setHoveredItem, clearHoveredItem, flyToLocation } = useMapContext()
  const cardRefs = useRef({})

  useEffect(() => {
    setLoading(true)
    fetchLandmarks()
      .then(all => setLandmarks(all.filter(l => l.province === name)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [name])

  const handleMouseEnter = useCallback((lm) => {
    const cardEl = cardRefs.current[lm.id]
    if (!cardEl) return
    const rect = cardEl.getBoundingClientRect()
    setHoveredItem(`landmark-${lm.id}`, 'landmark', rect, lm.lat, lm.lng)
  }, [setHoveredItem])

  const handleMouseLeave = useCallback(() => {
    clearHoveredItem()
  }, [clearHoveredItem])

  const handleClick = useCallback((lm) => {
    flyToLocation(lm.lat, lm.lng, 10)
  }, [flyToLocation])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (landmarks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Landmark className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">该省暂无景点数据</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {landmarks.map((lm, index) => (
        <div
          key={lm.id}
          ref={(el) => { cardRefs.current[lm.id] = el }}
          className="p-3 hover:bg-gray-50 transition-colors cursor-pointer list-item-animate"
          style={{ animationDelay: `${index * 50}ms` }}
          onMouseEnter={() => handleMouseEnter(lm)}
          onMouseLeave={handleMouseLeave}
          onClick={() => handleClick(lm)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm text-gray-900">{lm.name}</h3>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3" />
                <span>{lm.city}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{lm.description}</p>
            </div>
            {lm.category && (
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[lm.category] || 'bg-gray-100 text-gray-600'}`}>
                {lm.category}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
