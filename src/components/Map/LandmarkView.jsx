import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks } from '../../lib/api'
import { MapBridge, useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../lib/coordTransform'
import { Search, MapPin, X, ChevronDown, ChevronUp } from 'lucide-react'

// OpenStreetMap 瓦片
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// 景点类别颜色
const CATEGORY_COLORS = {
  '历史古迹': '#f59e0b',
  '自然风光': '#22c55e',
  '现代建筑': '#3b82f6',
  '民俗文化': '#a855f7',
  '宗教圣地': '#f43f5e',
}

// 创建简洁的景点标记图标
function createMarkerIcon(category, highlighted = false) {
  const color = CATEGORY_COLORS[category] || '#64748b'
  const size = highlighted ? 12 : 8
  const shadow = highlighted
    ? `0 0 0 4px ${color}40, 0 2px 6px rgba(0,0,0,0.3)`
    : '0 1px 3px rgba(0,0,0,0.2)'

  return L.divIcon({
    className: '',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid white;
      box-shadow: ${shadow};
      cursor: pointer;
      transition: all 0.2s;
      ${highlighted ? 'animation: marker-pulse 1.5s ease-in-out infinite;' : ''}
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// 缩放级别跟踪组件
function ZoomTracker({ onZoomChange }) {
  const map = useMap()
  useEffect(() => {
    const onZoomEnd = () => onZoomChange(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map, onZoomChange])
  return null
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

export default function LandmarkView() {
  const { hoveredItemId, selectedItemId } = useMapContext()
  const [landmarks, setLandmarks] = useState([])
  const [zoomLevel, setZoomLevel] = useState(5)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLandmark, setSelectedLandmark] = useState(null)
  const [flyToPosition, setFlyToPosition] = useState(null)
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const searchInputRef = useRef(null)

  // 加载景点数据
  useEffect(() => {
    fetchLandmarks().then(setLandmarks).catch(console.error)
  }, [])

  // 搜索过滤
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    return landmarks.filter(lm =>
      lm.name.toLowerCase().includes(query) ||
      lm.province.toLowerCase().includes(query) ||
      lm.city.toLowerCase().includes(query) ||
      (lm.description && lm.description.toLowerCase().includes(query))
    ).slice(0, 20) // 最多显示20个结果
  }, [landmarks, searchQuery])

  // 根据缩放级别过滤显示的景点（渐进式展开）
  const visibleLandmarks = useMemo(() => {
    // 如果有搜索查询，显示搜索结果
    if (searchQuery.trim()) {
      return searchResults
    }

    // 根据缩放级别渐进式展开
    if (zoomLevel >= 10) {
      // 高缩放级别：显示所有景点
      return landmarks
    } else if (zoomLevel >= 8) {
      // 中高缩放级别：显示5A和4A景点
      return landmarks.filter(lm =>
        lm.name.includes('5A') || lm.name.includes('4A') || lm.name.includes('国家')
      )
    } else if (zoomLevel >= 6) {
      // 中缩放级别：显示主要景点（每3个显示1个）
      return landmarks.filter((_, index) => index % 3 === 0)
    } else {
      // 低缩放级别：只显示少量代表性景点（每10个显示1个）
      return landmarks.filter((_, index) => index % 10 === 0)
    }
  }, [landmarks, zoomLevel, searchQuery, searchResults])

  // 处理搜索
  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
    if (query.trim()) {
      setShowSearchPanel(true)
    }
  }, [])

  // 选择景点
  const handleSelectLandmark = useCallback((landmark) => {
    setSelectedLandmark(landmark)
    const [gcjLng, gcjLat] = wgs84ToGcj02(landmark.lng, landmark.lat)
    setFlyToPosition([gcjLat, gcjLng])
    setShowSearchPanel(false)
    setSearchQuery('')
  }, [])

  // 关闭详情
  const handleCloseDetail = useCallback(() => {
    setSelectedLandmark(null)
    setFlyToPosition(null)
  }, [])

  // 地图中心点
  const mapCenter = useMemo(() => {
    const [gcjLng, gcjLat] = wgs84ToGcj02(104.1954, 35.8617)
    return [gcjLat, gcjLng]
  }, [])

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
        <ZoomTracker onZoomChange={setZoomLevel} />
        <FlyToLocation position={flyToPosition} zoom={10} />

        {/* OpenStreetMap 瓦片 */}
        <TileLayer
          url={OSM_TILE_URL}
          subdomains="abc"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* 景点标记 */}
        {visibleLandmarks.map((lm) => {
          const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)
          const isHighlighted = hoveredItemId === `landmark-${lm.id}` || selectedLandmark?.id === lm.id

          return (
            <Marker
              key={`landmark-${lm.id}`}
              position={[gcjLat, gcjLng]}
              icon={createMarkerIcon(lm.category, isHighlighted)}
              eventHandlers={{
                click: () => handleSelectLandmark(lm),
              }}
            >
              <Popup maxWidth={280}>
                <div className="w-64">
                  <h3 className="font-bold text-sm">{lm.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{lm.province} · {lm.city} · {lm.category}</p>
                  {lm.description && (
                    <p className="text-xs text-gray-600 mt-2">{lm.description}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        })}
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
            placeholder="搜索景点、省份或城市..."
            className="w-full pl-10 pr-10 py-2.5 bg-white rounded-lg shadow-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('')
                setShowSearchPanel(false)
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 搜索结果面板 */}
        {showSearchPanel && searchResults.length > 0 && (
          <div className="mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-80 overflow-y-auto">
            <div className="p-2 text-xs text-gray-500 border-b">
              找到 {searchResults.length} 个景点
            </div>
            {searchResults.map((lm) => (
              <button
                key={lm.id}
                onClick={() => handleSelectLandmark(lm)}
                className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                <div className="font-medium text-sm text-gray-900">{lm.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {lm.province} · {lm.city} · {lm.category}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 无搜索结果 */}
        {showSearchPanel && searchQuery && searchResults.length === 0 && (
          <div className="mt-2 bg-white rounded-lg shadow-lg border border-gray-200 p-4 text-center">
            <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">未找到匹配的景点</p>
          </div>
        )}
      </div>

      {/* 景点详情面板 */}
      {selectedLandmark && (
        <div className="absolute bottom-4 left-4 z-[1000] w-80">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            {/* 头部 */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-base text-gray-900">{selectedLandmark.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedLandmark.province} · {selectedLandmark.city}
                  </p>
                </div>
                <button
                  onClick={handleCloseDetail}
                  className="p-1 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* 内容 */}
            <div className="p-4">
              {/* 类别标签 */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="px-2 py-1 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: `${CATEGORY_COLORS[selectedLandmark.category] || '#64748b'}20`,
                    color: CATEGORY_COLORS[selectedLandmark.category] || '#64748b',
                  }}
                >
                  {selectedLandmark.category}
                </span>
              </div>

              {/* 描述 */}
              {selectedLandmark.description && (
                <p className="text-sm text-gray-600 leading-relaxed">
                  {selectedLandmark.description}
                </p>
              )}

              {/* 坐标信息 */}
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <MapPin className="w-3 h-3" />
                  <span>
                    {selectedLandmark.lat.toFixed(4)}, {selectedLandmark.lng.toFixed(4)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 缩放级别提示 */}
      <div className="absolute bottom-4 right-4 z-[1000]">
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow px-3 py-2 text-xs text-gray-600">
          <div className="font-medium">显示 {visibleLandmarks.length} 个景点</div>
          <div className="text-gray-400 mt-0.5">缩放级别: {zoomLevel}</div>
        </div>
      </div>
    </div>
  )
}
