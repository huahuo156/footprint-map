import { useMemo } from 'react'
import { MapPin, X, Crosshair, List } from 'lucide-react'
import { getLandmarkImage } from '../../data/landmarkImages'
import { ratingMeta, categoryColor } from '../../data/rating'

const DEFAULT_IMAGE = 'https://raw.githubusercontent.com/marksui/China-Travel-Map/main/assets/images/fallback.jpg'

/**
 * 右侧滑入的景点简介面板，仿照 China-Travel-Map 的 detail-panel。
 * 展示：照片、标题、省份·城市、评级标签、介绍、定位、同地区景点列表。
 */
export default function LandmarkDetailPanel({ landmark, landmarks, onLocate, onClose, onSelect }) {
  const imageUrl = landmark ? getLandmarkImage(landmark.name) : DEFAULT_IMAGE
  const color = landmark ? categoryColor(landmark.category) : '#64748b'

  // 同地区景点（排除当前选中，最多 8 个）
  const related = useMemo(() => {
    if (!landmark || !landmarks) return []
    return landmarks
      .filter((lm) => lm.province === landmark.province && lm.id !== landmark.id)
      .slice(0, 8)
  }, [landmark, landmarks])

  if (!landmark) return null

  return (
    <aside className="landmark-detail-panel">
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-white/70 hover:bg-white text-gray-500 hover:text-gray-800 shadow-sm transition-colors"
        aria-label="关闭简介"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="landmark-detail-scroll">
        {/* 照片 */}
        <div className="landmark-detail-image">
          <img
            src={imageUrl}
            alt={landmark.name}
            loading="lazy"
            decoding="async"
            onError={(e) => { e.currentTarget.src = DEFAULT_IMAGE }}
          />
        </div>

        <div className="landmark-detail-body">
          {/* 省份 · 城市 */}
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {landmark.province} · {landmark.city}
          </p>
          <h2 className="mt-1 text-xl font-bold text-gray-900 leading-snug">{landmark.name}</h2>

          {/* 评级标签 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="px-2.5 py-1 rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {ratingMeta(landmark)}
            </span>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-100"
            >
              {landmark.category}
            </span>
          </div>

          {/* 介绍 */}
          <p className="mt-4 text-sm text-gray-600 leading-relaxed">
            {landmark.description || '暂无介绍'}
          </p>

          {/* 操作按钮 */}
          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() => onLocate(landmark)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Crosshair className="w-4 h-4" />
              定位
            </button>
          </div>

          {/* 坐标 */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
            <MapPin className="w-3.5 h-3.5" />
            <span>{landmark.lat.toFixed(4)}, {landmark.lng.toFixed(4)}</span>
          </div>
        </div>

        {/* 同地区景点 */}
        {related.length > 0 && (
          <div className="px-5 pb-5">
            <div className="flex items-center gap-2 mb-3">
              <List className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-800">同地区景点</h3>
              <span className="text-xs text-gray-400">({related.length})</span>
            </div>
            <div className="space-y-1">
              {related.map((lm) => (
                <button
                  key={lm.id}
                  onClick={() => onSelect(lm)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <span className="block text-sm text-gray-800 truncate group-hover:text-blue-600">
                    {lm.name}
                  </span>
                  <span className="block text-xs text-gray-400 mt-0.5">
                    {lm.city} · {ratingMeta(lm)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
