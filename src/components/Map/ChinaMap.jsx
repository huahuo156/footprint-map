import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import { MapBridge, useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../lib/coordTransform'
import CheckinPopup from './CheckinPopup'
import FootprintTrail from './FootprintTrail'
import ChinaMask from './ChinaMask'
import MapViewSwitcher from './MapViewSwitcher'
import { createSimpleLandmarkIcon, createSimpleCheckinIcon } from './SimpleMarkerIcon'
import { Search, MapPin, X, ChevronDown, ChevronUp } from 'lucide-react'

// ============================================================
// OpenStreetMap 瓦片
// ============================================================
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// ---- 地标标记：按类别区分颜色 + emoji ----
const CATEGORY_STYLES = {
  '历史古迹': { bg: '#f59e0b', glow: 'rgba(245,158,11,.4)', icon: '🏯' },
  '自然风光': { bg: '#22c55e', glow: 'rgba(34,197,94,.4)',   icon: '🏔️' },
  '现代建筑': { bg: '#3b82f6', glow: 'rgba(59,130,246,.4)',  icon: '🏢' },
  '民俗文化': { bg: '#a855f7', glow: 'rgba(168,85,247,.4)',  icon: '🏮' },
  '宗教圣地': { bg: '#f43f5e', glow: 'rgba(244,63,94,.4)',   icon: '🛕' },
}
const DEFAULT_CAT_STYLE = { bg: '#64748b', glow: 'rgba(100,116,139,.4)', icon: '📍' }

function makeLandmarkIcon(category, highlighted = false) {
  const s = CATEGORY_STYLES[category] || DEFAULT_CAT_STYLE
  const size = highlighted ? 32 : 26
  const tail = 8
  const total = size + tail
  const emoji = highlighted ? 16 : 13

  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${total}px;cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${s.bg};border:2.5px solid white;
          display:flex;align-items:center;justify-content:center;
          font-size:${emoji}px;line-height:1;
          --marker-glow:${s.glow};
          box-shadow:${highlighted ? `0 0 0 4px ${s.glow},0 2px 8px rgba(0,0,0,.4)` : '0 1px 3px rgba(0,0,0,.3)'};
          ${highlighted ? 'animation:marker-pulse 1.5s ease-in-out infinite;' : ''}
          transition:transform .15s;
        ">${s.icon}</div>
        <div style="
          position:absolute;bottom:0;left:50%;transform:translateX(-50%);
          width:0;height:0;
          border-left:${tail * 0.6}px solid transparent;
          border-right:${tail * 0.6}px solid transparent;
          border-top:${tail}px solid ${s.bg};
        "></div>
      </div>`,
    iconSize: [size + 4, total + 4],
    iconAnchor: [(size + 4) / 2, total + 4],
  })
}

// ---- 打卡标记 ----
const checkinIcon = L.divIcon({
  className: '',
  html: `<div style="background:#22c55e;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [16, 16], iconAnchor: [8, 8],
})
const highlightedCheckinIcon = L.divIcon({
  className: '',
  html: `<div class="marker-pulse" style="background:#16a34a;width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 4px rgba(22,163,74,.25),0 2px 6px rgba(0,0,0,.4)"></div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
})

// ---- 省份热力色阶 ----
const HEAT_SCALE = [
  { min: 10, color: '#3b82f6' },
  { min: 7,  color: '#60a5fa' },
  { min: 4,  color: '#93c5fd' },
  { min: 1,  color: '#bfdbfe' },
  { min: 0,  color: '#dbeafe' },
]
function getHeatColor(count) {
  for (const tier of HEAT_SCALE) {
    if (count >= tier.min) return tier.color
  }
  return '#dbeafe'
}

const PROVINCE_MAP = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '河北省': '河北', '山西省': '山西', '辽宁省': '辽宁', '吉林省': '吉林',
  '黑龙江省': '黑龙江', '江苏省': '江苏', '浙江省': '浙江', '安徽省': '安徽',
  '福建省': '福建', '江西省': '江西', '山东省': '山东', '河南省': '河南',
  '湖北省': '湖北', '湖南省': '湖南', '广东省': '广东', '海南省': '海南',
  '四川省': '四川', '贵州省': '贵州', '云南省': '云南', '陕西省': '陕西',
  '甘肃省': '甘肃', '青海省': '青海', '台湾省': '台湾',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西',
  '西藏自治区': '西藏', '宁夏回族自治区': '宁夏',
  '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门',
}

// ---- 省级热力图层 ----
// 仅在全国/省级视角（zoom ≤ 9）显示。放大到城市级后：
// 1) 全国热力色已无参考意义；2) 省界多边形顶点稀疏，放大后会呈现明显锯齿。
// 高德底图本身会继续绘制省界，因此不影响边界展示。
function ProvinceLayer({ geoJson, style, onEachFeature }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())

  useEffect(() => {
    const onZoomEnd = () => setZoom(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map])

  if (zoom > 9) return null
  return <GeoJSON data={geoJson} style={style} onEachFeature={onEachFeature} />
}

// ---- 省份名称标注 (zoom ≤ 5) ----
function ProvinceLabels({ geoJson }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())

  useEffect(() => {
    const onZoomEnd = () => setZoom(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map])

  const centers = useMemo(() => {
    if (!geoJson) return []
    return geoJson.features.map(feature => {
      const name = feature.properties.name
      const shortName = PROVINCE_MAP[name] || name
      const latlng = L.geoJSON(feature).getBounds().getCenter()
      return { name: shortName, lat: latlng.lat, lng: latlng.lng }
    })
  }, [geoJson])

  if (zoom > 5) return null

  return centers.map(c => (
    <Marker
      key={`label-${c.name}`}
      position={[c.lat, c.lng]}
      icon={L.divIcon({
        className: '',
        html: `<div style="font-size:12px;color:#1e293b;font-weight:600;white-space:nowrap;pointer-events:none;text-shadow:1px 1px 2px white,-1px -1px 2px white,1px -1px 2px white,-1px 1px 2px white">${c.name}</div>`,
        iconSize: [60, 20],
        iconAnchor: [30, 10],
      })}
      interactive={false}
    />
  ))
}

// ---- 景点名称标注 (zoom >= 6) ----
function LandmarkLabels({ landmarks }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())

  useEffect(() => {
    const onZoomEnd = () => setZoom(map.getZoom())
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map])

  if (zoom < 6) return null

  return landmarks.map(lm => (
    <Marker
      key={`lbl-${lm.id}`}
      position={[lm.lat, lm.lng]}
      icon={L.divIcon({
        className: '',
        html: `<div style="
          font-size:11px;color:#1e293b;font-weight:600;
          white-space:nowrap;pointer-events:none;
          background:rgba(255,255,255,.88);
          padding:1px 6px;border-radius:4px;
          box-shadow:0 1px 4px rgba(0,0,0,.15);
          margin-top:-4px;
          animation:label-fade-in .25s ease-out both;
        ">${lm.name}</div>`,
        iconSize: [100, 20],
        iconAnchor: [50, -18],
      })}
      interactive={false}
    />
  ))
}

// 监听缩放级别变化的组件
function ZoomTracker({ onZoomChange }) {
  const map = useMap()

  useEffect(() => {
    const onZoomEnd = () => {
      onZoomChange(map.getZoom())
    }
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

// ============================================================
// 主组件
// ============================================================
export default function ChinaMap() {
  const navigate = useNavigate()
  const { hoveredItemId, selectedItemId } = useMapContext()
  const [geoJson, setGeoJson] = useState(null)
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])
  const [hoveredProvince, setHoveredProvince] = useState(null)
  const [checkinPos, setCheckinPos] = useState(null)
  const [viewMode, setViewMode] = useState('landmark') // 'landmark' | 'checkin'
  const [zoomLevel, setZoomLevel] = useState(5)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [selectedLandmark, setSelectedLandmark] = useState(null)
  const [flyToPosition, setFlyToPosition] = useState(null)
  const searchInputRef = useRef(null)

  useEffect(() => {
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
      .then(r => r.json())
      // DataV areas_v3 边界数据本身即为 GCJ-02（火星坐标），与高德瓦片同坐标系，
      // 直接使用即可对齐，不能再做 wgs84→gcj02 转换，否则会双重加密导致边界偏移。
      .then(data => setGeoJson(data))
      .catch(console.error)
    fetchLandmarks().then(setLandmarks).catch(console.error)
    fetchCheckins().then(setCheckins).catch(console.error)
  }, [])

  const provinceCounts = useMemo(() => {
    const counts = {}
    for (const lm of landmarks) {
      counts[lm.province] = (counts[lm.province] || 0) + 1
    }
    return counts
  }, [landmarks])

  // 按类别缓存图标，避免每次渲染重建
  const iconCache = useMemo(() => {
    const cache = {}
    for (const lm of landmarks) {
      const cat = lm.category || '_default'
      if (!cache[cat]) {
        cache[cat] = {
          normal: makeLandmarkIcon(lm.category, false),
          highlighted: makeLandmarkIcon(lm.category, true),
        }
      }
    }
    return cache
  }, [landmarks])

  const handleProvinceClick = useCallback((provinceName) => {
    const shortName = PROVINCE_MAP[provinceName] || provinceName
    navigate(`/province/${encodeURIComponent(shortName)}`)
  }, [navigate])

  const onEachFeature = useCallback((feature, layer) => {
    const name = feature.properties.name
    const shortName = PROVINCE_MAP[name] || name
    const count = provinceCounts[name] || provinceCounts[shortName] || 0
    const baseColor = getHeatColor(count)

    layer.on({
      click: () => handleProvinceClick(name),
      mouseover: (e) => {
        e.target.setStyle({ fillColor: '#60a5fa', fillOpacity: 0.45, weight: 2.5 })
        e.target.bringToFront()
        setHoveredProvince(shortName)
      },
      mouseout: (e) => {
        e.target.setStyle({ fillColor: baseColor, fillOpacity: 0.35, weight: 1.5 })
        setHoveredProvince(null)
      },
    })
    layer.bindTooltip(shortName, { sticky: true, className: 'province-tooltip' })
  }, [handleProvinceClick, provinceCounts])

  const geoJsonStyle = useCallback((feature) => {
    const name = feature.properties.name
    const shortName = PROVINCE_MAP[name] || name
    const count = provinceCounts[name] || provinceCounts[shortName] || 0
    return {
      fillColor: getHeatColor(count),
      fillOpacity: 0.35,
      color: '#475569',
      weight: 1.5,
    }
  }, [provinceCounts])

  // 搜索功能
  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
    if (query.trim()) {
      const results = landmarks.filter(lm =>
        lm.name.toLowerCase().includes(query.toLowerCase()) ||
        lm.province.toLowerCase().includes(query.toLowerCase()) ||
        lm.city.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20)
      setSearchResults(results)
      setShowSearchPanel(true)
    } else {
      setSearchResults([])
      setShowSearchPanel(false)
    }
  }, [landmarks])

  // 选择景点
  const handleSelectLandmark = useCallback((landmark) => {
    setSelectedLandmark(landmark)
    const [gcjLng, gcjLat] = wgs84ToGcj02(landmark.lng, landmark.lat)
    setFlyToPosition([gcjLat, gcjLng])
    setShowSearchPanel(false)
    setSearchQuery('')
  }, [])

  // 根据缩放级别过滤显示的景点（逐步展开）
  const visibleLandmarks = useMemo(() => {
    // 如果有搜索查询，显示搜索结果
    if (searchQuery.trim() && searchResults.length > 0) {
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

  const visibleCheckins = useMemo(() => {
    if (zoomLevel >= 8) {
      return checkins
    } else if (zoomLevel >= 6) {
      return checkins.filter((_, index) => index % 3 === 0)
    } else {
      return checkins.filter((_, index) => index % 10 === 0)
    }
  }, [checkins, zoomLevel])

  const allMarkers = [
    ...visibleLandmarks.map(lm => {
      const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)
      return { ...lm, type: 'landmark', position: [gcjLat, gcjLng] }
    }),
    ...visibleCheckins.map(c => {
      const [gcjLng, gcjLat] = wgs84ToGcj02(c.lng, c.lat)
      return { ...c, type: 'checkin', position: [gcjLat, gcjLng] }
    }),
  ]

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
        eventHandlers={{
          click: (e) => {
            if (e.originalEvent.target.classList?.contains('leaflet-container') ||
                e.originalEvent.target.classList?.contains('leaflet-tile')) {
              // Map click gives GCJ-02 coordinates; convert to WGS-84 for database storage
              const [wgsLng, wgsLat] = gcj02ToWgs84(e.latlng.lng, e.latlng.lat)
              setCheckinPos({ lat: wgsLat, lng: wgsLng })
            }
          },
        }}
      >
        <MapBridge />

        {/* 缩放级别跟踪 */}
        <ZoomTracker onZoomChange={setZoomLevel} />

        {/* OpenStreetMap 瓦片 */}
        <TileLayer
          url={OSM_TILE_URL}
          subdomains="abc"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* 中国范围遮罩：遮住境外区域，仅保留中国领土 */}
        <ChinaMask />

        {/* 省份多边形叠加（半透明，让地形透出） */}
        {geoJson && (
          <>
            <ProvinceLayer geoJson={geoJson} style={geoJsonStyle} onEachFeature={onEachFeature} />
            <ProvinceLabels geoJson={geoJson} />
          </>
        )}

        {/* 根据视图模式显示不同的标记 */}
        {viewMode === 'landmark' ? (
          // 景点视图：显示简洁的小圆点标记
          allMarkers.filter(m => m.type === 'landmark').map((lm) => {
            const isHighlighted = hoveredItemId === `landmark-${lm.id}` || selectedLandmark?.id === lm.id

            return (
              <Marker
                key={`landmark-${lm.id}`}
                position={lm.position}
                icon={createSimpleLandmarkIcon(lm.category, isHighlighted)}
                eventHandlers={{
                  click: () => handleSelectLandmark(lm),
                }}
              >
                <Popup maxWidth={280}>
                  <div className="w-64">
                    <h3 className="font-bold text-sm">{lm.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">{lm.province} · {lm.city} · {lm.category}</p>
                    <p className="text-xs text-gray-600 mt-2">{lm.description}</p>
                  </div>
                </Popup>
              </Marker>
            )
          })
        ) : (
          // 打卡视图：显示简洁的小圆点标记
          allMarkers.filter(m => m.type === 'checkin').map((c) => {
            const isHighlighted = hoveredItemId === `checkin-${c.id}`
            const isSelected = selectedItemId === `checkin-${c.id}`
            const highlight = isHighlighted || isSelected

            return (
              <Marker
                key={`checkin-${c.id}`}
                position={c.position}
                icon={createSimpleCheckinIcon(highlight)}
              >
                <Popup maxWidth={280}>
                  <CheckinPopup checkin={c} />
                </Popup>
              </Marker>
            )
          })
        )}

        {/* 飞行到指定位置 */}
        {flyToPosition && <FlyToLocation position={flyToPosition} zoom={10} />}

        {/* 景点名称标注（zoom >= 6 时显示） */}
        <LandmarkLabels landmarks={landmarks} />

        <FootprintTrail />
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
                setSearchResults([])
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
                  onClick={() => setSelectedLandmark(null)}
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
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
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

      {/* 视图切换控件 */}
      <MapViewSwitcher
        currentView={viewMode}
        onViewChange={setViewMode}
      />

      {/* 缩放级别提示 */}
      <div className="absolute bottom-4 right-4 z-[1000]">
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow px-3 py-2 text-xs text-gray-600">
          <div className="font-medium">显示 {visibleLandmarks.length} 个景点</div>
          <div className="text-gray-400 mt-0.5">缩放级别: {zoomLevel}</div>
        </div>
      </div>

      {hoveredProvince && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 px-3 py-1.5 rounded-lg shadow text-sm font-medium text-gray-700 z-[1000] pointer-events-none">
          {hoveredProvince}
        </div>
      )}

      {checkinPos && (
        <CheckinForm
          lat={checkinPos.lat}
          lng={checkinPos.lng}
          onClose={() => setCheckinPos(null)}
          onSuccess={(checkin) => {
            setCheckins(prev => [checkin, ...prev])
            setCheckinPos(null)
          }}
        />
      )}
    </div>
  )
}

// Lazy import to avoid circular deps
import CheckinForm from '../CheckinForm'
