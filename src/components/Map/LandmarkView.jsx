import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks } from '../../lib/api'
import { MapBridge } from '../../contexts/MapContext'
import { wgs84ToGcj02 } from '../../lib/coordTransform'
import { Search, X, MapPin } from 'lucide-react'
import { MarkerClusterGroup } from './markerClusterLayer'
import LandmarkDetailPanel from './LandmarkDetailPanel'
import { parseRating, ratingMeta, categoryColor } from '../../data/rating'

// OpenStreetMap 瓦片
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// 地图默认中心（中国，WGS-84 需转 GCJ-02）
const MAP_CENTER_WGS = [104.1954, 35.8617]

// 搜索建议的最大条数
const SEARCH_LIMIT = 6

// 创建图钉标记（teardrop，带评级徽章）
function createPinIcon(landmark, highlighted = false) {
  const { rating } = parseRating(landmark.name, landmark.description)
  const color = categoryColor(landmark.category)
  // 5A 为指定色底 + 白色字；4A 用同色底（默认深色文字）
  const ink = rating === '4A' ? '#061a0b' : '#ffffff'
  const size = highlighted ? 38 : 34
  const scale = highlighted ? 'scale(1.16)' : 'scale(1)'

  return L.divIcon({
    className: 'lm-pin-shell',
    html: `<div class="lm-pin" style="
      width:${size}px;height:${size}px;
      background:${color};color:${ink};
      ${highlighted ? `box-shadow:0 0 0 7px ${color}30, 0 4px 11px rgba(0,0,0,.3);` : 'box-shadow:0 2px 7px rgba(0,0,0,.28);'}
      transform:rotate(-45deg) ${scale};
    "><span class="lm-pin-badge">${rating}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// 飞行到指定位置组件
function FlyToLocation({ position, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (position) {
      map.flyTo(position, zoom || 10, { duration: 1.5 })
    }
  }, [position, zoom, map])
  return null
}

// 归一化搜索文本（去空白、转小写）
function normalize(text) {
  return String(text || '').trim().toLowerCase()
}

// 计算景点与查询的匹配分数（仿照 China-Travel-Map 的 searchSuggestionScore）
function searchScore(landmark, query) {
  const name = normalize(landmark.name)
  const location = normalize(`${landmark.province} ${landmark.city} ${landmark.province}`)
  const desc = normalize(landmark.description || '') + (landmark.category ? normalize(landmark.category) : '')

  let score = 0
  if (name === query) score = 150
  else if (name.startsWith(query)) score = 120
  else if (name.includes(query)) score = 96
  else if (location.includes(query)) score = 74
  else if (desc.includes(query)) score = 48
  if (!score) return 0

  const { rating } = parseRating(landmark.name, landmark.description)
  score += rating === '5A' ? 9 : 3 // 5A 略优先
  return score
}

export default function LandmarkView() {
  const [landmarks, setLandmarks] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [selectedLandmark, setSelectedLandmark] = useState(null)
  const [flyToPosition, setFlyToPosition] = useState(null)
  const searchInputRef = useRef(null)

  // 加载景点数据
  useEffect(() => {
    fetchLandmarks().then(setLandmarks).catch(console.error)
  }, [])

  // 搜索联想（打分排序，取前 N 条）
  const searchResults = useMemo(() => {
    const query = normalize(searchQuery)
    if (!query) return []
    return landmarks
      .map((lm) => ({ lm, score: searchScore(lm, query) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.lm.name.localeCompare(b.lm.name, 'zh-CN'))
      .slice(0, SEARCH_LIMIT)
      .map((row) => row.lm)
  }, [landmarks, searchQuery])

  // 地图中心点（WGS-84 → GCJ-02）
  const mapCenter = useMemo(() => {
    const [gcjLng, gcjLat] = wgs84ToGcj02(MAP_CENTER_WGS[0], MAP_CENTER_WGS[1])
    return [gcjLat, gcjLng]
  }, [])

  // 选择景点：打开简介 + 飞行定位
  const handleSelectLandmark = useCallback((landmark) => {
    setSelectedLandmark(landmark)
    const [gcjLng, gcjLat] = wgs84ToGcj02(landmark.lng, landmark.lat)
    setFlyToPosition([gcjLat, gcjLng])
    setSearchOpen(false)
    setSearchQuery('')
    setActiveIndex(-1)
  }, [])

  // 关闭简介并复位
  const handleCloseDetail = useCallback(() => {
    setSelectedLandmark(null)
    setFlyToPosition(null)
  }, [])

  // 搜索输入变化
  const handleSearch = useCallback((value) => {
    setSearchQuery(value)
    setActiveIndex(-1)
    setSearchOpen(!!value.trim())
  }, [])

  // 清空搜索
  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchOpen(false)
    setActiveIndex(-1)
  }, [])

  // 键盘导航搜索联想
  const handleKeyDown = useCallback((e) => {
    if (!searchOpen || searchResults.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) => (prev + 1) % searchResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && searchResults[activeIndex]) {
        handleSelectLandmark(searchResults[activeIndex])
      } else if (searchResults[0]) {
        handleSelectLandmark(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClearSearch()
    }
  }, [searchOpen, searchResults, activeIndex, handleSelectLandmark, handleClearSearch])

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={mapCenter}
        zoom={5}
        className="w-full h-full"
        minZoom={4}
        maxZoom={18}
        maxBounds={[[2, 73], [55, 135]]}
        maxBoundsViscosity={1.0}
        zoomControl={false}
      >
        <MapBridge />
        <FlyToLocation position={flyToPosition} zoom={10} />

        {/* OpenStreetMap 瓦片 */}
        <TileLayer
          url={OSM_TILE_URL}
          subdomains="abc"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* 景点标记：markercluster 处理低缩放聚合，放大后拆分 */}
        <MarkerClusterGroup
          maxClusterRadius={46}
          showCoverageOnHover={false}
          zoomToBoundsOnClick
        >
          {landmarks.map((lm) => {
            const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)
            const isHighlighted = selectedLandmark?.id === lm.id

            return (
              <Marker
                key={`landmark-${lm.id}`}
                position={[gcjLat, gcjLng]}
                icon={createPinIcon(lm, isHighlighted)}
                eventHandlers={{
                  click: () => handleSelectLandmark(lm),
                }}
              />
            )
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {/* 搜索框 */}
      <div className="absolute top-4 left-4 z-[1000] w-72">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchQuery.trim() && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="搜索景点或地区..."
            className="w-full pl-10 pr-10 py-2.5 bg-white rounded-lg shadow-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 搜索联想面板 */}
        {searchOpen && searchResults.length > 0 && (
          <div className="mt-2 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 text-xs text-gray-500 border-b bg-gray-50">
              找到 {searchResults.length} 个相关景点
            </div>
            <div className="max-h-80 overflow-y-auto">
              {searchResults.map((lm, index) => (
                <button
                  key={lm.id}
                  disabled={false}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleSelectLandmark(lm)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left border-b border-gray-100 last:border-0 transition-colors ${
                    activeIndex === index ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-sm text-gray-900 truncate">{lm.name}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {lm.province} · {lm.city} · {ratingMeta(lm)}
                    </span>
                  </span>
                  <span
                    className="ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                    style={{ backgroundColor: categoryColor(lm.category) }}
                  >
                    {parseRating(lm.name, lm.description).rating}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 无结果 */}
        {searchOpen && searchQuery && searchResults.length === 0 && (
          <div className="mt-2 bg-white rounded-lg shadow-lg border border-gray-200 p-4 text-center">
            <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">未找到匹配的景点</p>
          </div>
        )}
      </div>

      {/* 右侧简介面板 */}
      <LandmarkDetailPanel
        landmark={selectedLandmark}
        landmarks={landmarks}
        onLocate={(lm) => handleSelectLandmark(lm)}
        onClose={handleCloseDetail}
        onSelect={(lm) => handleSelectLandmark(lm)}
      />
    </div>
  )
}
