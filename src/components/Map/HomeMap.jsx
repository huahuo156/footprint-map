import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchMyCheckins } from '../../lib/api'
import { MapBridge, useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../lib/coordTransform'
import ChinaMask from './ChinaMask'
import MapViewSwitcher from './MapViewSwitcher'
import LandmarkDetailPanel from './LandmarkDetailPanel'
import { MarkerClusterGroup } from './markerClusterLayer'
import { parseRating, ratingMeta, categoryColor } from '../../data/rating'
import LikeButton from '../LikeButton'
import { timeAgo, getPublicUrl } from '../../lib/utils'
import CheckinForm from '../CheckinForm'
import { Search, X, MapPin, Camera, Images } from 'lucide-react'

// ============================================================
// OpenStreetMap 瓦片
// ============================================================
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// 搜索建议的最大条数
const SEARCH_LIMIT = 6

// 景点图钉标记（teardrop，带评级徽章）
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

// 打卡图钉标记（与景点图钉同款水滴造型，绿色系 + 相机字形）
function createCheckinPinIcon(highlighted = false) {
  const color = '#16a34a'
  const size = highlighted ? 36 : 30
  const scale = highlighted ? 'scale(1.16)' : 'scale(1)'

  return L.divIcon({
    className: 'lm-pin-shell',
    html: `<div class="lm-pin" style="
      width:${size}px;height:${size}px;
      background:${color};color:#ffffff;
      ${highlighted ? `box-shadow:0 0 0 7px ${color}30, 0 4px 11px rgba(0,0,0,.3);` : 'box-shadow:0 2px 7px rgba(0,0,0,.28);'}
      transform:rotate(-45deg) ${scale};
    "><span class="lm-pin-badge">📷</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// 足迹聚合气泡：绿色系，与打卡 pin 同色、和景点蓝色区分
function createCheckinClusterIcon(cluster) {
  const count = cluster.getChildCount()
  const size = count < 10 ? 32 : count < 50 ? 40 : 48
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(22,163,74,.92);color:#fff;font-weight:700;font-size:12px;
      display:flex;align-items:center;justify-content:center;
      border:2.5px solid white;box-shadow:0 1px 5px rgba(0,0,0,.3)">${count}</div>`,
    className: '',
    iconSize: [size, size],
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

// ------------------------------------------------------------
// 足迹聚合交互
// ------------------------------------------------------------

// 贪心网格模拟（近似 leaflet.markercluster 的聚合规则）：
// 在指定 zoom 下逐点并入最近的簇（屏幕距离 ≤ maxRadius），
// 返回"单例标记数 / 总簇数"，用于估算要展开到哪一级才能让多数 pin 变成 1。
function simulateSingletonRatio(points, zoom, maxRadius) {
  const px = points.map(p => L.point(map2px(p, zoom)))
  const clusters = [] // { center: L.Point, size }
  for (const p of px) {
    let best = null
    let bestDist = Infinity
    for (const c of clusters) {
      const d = p.distanceTo(c.center)
      if (d <= maxRadius && d < bestDist) { bestDist = d; best = c }
    }
    if (best) {
      best.center = L.point(
        (best.center.x * best.size + p.x) / (best.size + 1),
        (best.center.y * best.size + p.y) / (best.size + 1),
      )
      best.size += 1
    } else {
      clusters.push({ center: p, size: 1 })
    }
  }
  const singletons = clusters.filter(c => c.size === 1).length
  return { singletons, total: clusters.length }
}

function map2px(latlng, zoom) {
  const point = L.CRS.Earth.project(latlng)
  const scale = 0.5 / Math.pow(2, zoom)
  return [point.x / scale, point.y / scale]
}

// 把 cluster 展开到"多数单例"：搜索第一个满足 单例占比≥80%（或已是最高分裂级）
// 的 zoom，再 +1 留安全余量，然后 flyToBounds。
function expandClusterToSingletons(cluster, map) {
  const maxZoom = map.getMaxZoom()
  const zoomCap = Math.min(cluster.__group?.options?.disableClusteringAtZoom ?? maxZoom, maxZoom)
  const startZoom = map.getZoom()

  if (cluster.getChildCount() === 1) {
    map.fitBounds(cluster.getBounds(), { maxZoom: Math.min(zoomCap + 2, maxZoom), padding: [80, 80] })
    return
  }

  const points = cluster.getAllChildMarkers().map(m => m.getLatLng())
  let target = null
  for (let z = startZoom + 1; z <= zoomCap; z++) {
    const { singletons, total } = simulateSingletonRatio(points, z, 50)
    if (singletons / total >= 0.8) {
      target = Math.min(z + 1, zoomCap)
      break
    }
  }
  if (target === null) target = zoomCap
  map.flyToBounds(cluster.getBounds(), { maxZoom: target, padding: [60, 60], duration: 0.8 })
}

// 监听 clusterclick：数字>1 → 渐进展开；数字=1 → 交给对应 marker 的 click（打开相册）。
// 同时替代 zoomToBoundsOnClick（需置 false），并阻止点击穿透触发"地图打卡"。
function ExpandOnClusterClick({ onSuppressMapClick }) {
  const map = useMap()
  useEffect(() => {
    const handler = (e) => {
      const cluster = e.layer
      if (!cluster || typeof cluster.getChildCount !== 'function') return
      onSuppressMapClick()
      expandClusterToSingletons(cluster, map)
    }
    map.on('clusterclick', handler)
    return () => map.off('clusterclick', handler)
  }, [map, onSuppressMapClick])
  return null
}

// 同坐标挤着多个"值=1 的 pin"（disableClusteringAtZoom 之下）：
// 点击时先就地放大两级，让它们裂开；到达最高聚类级仍在一起才作为"同点"处理。
function ZoomAtSamePoint({ center, zoomCap, onDone }) {
  const map = useMap()
  useEffect(() => {
    const current = map.getZoom()
    const done = () => onDone?.()
    map.once('zoomend', done)
    if (current < zoomCap) {
      map.setView(center, Math.min(current + 2, zoomCap), { duration: 0.5 })
    } else {
      map.off('zoomend', done)
      onDone?.()
    }
    return () => map.off('zoomend', done)
  }, [map, center, zoomCap, onDone])
  return null
}

// 点击地图打卡（仅足迹视图启用）：直接绑定 leaflet map 的 click 事件，
// 避免 MapContainer eventHandlers 在某些渲染下不触发的问题。
function ClickToCheckin({ enabled, onClick }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled) return undefined
    const handler = (e) => {
      const t = e.originalEvent.target
      if (t?.closest?.('.leaflet-marker-icon, .leaflet-control, .leaflet-popup')) return
      onClick(e.latlng)
    }
    map.on('click', handler)
    return () => map.off('click', handler)
  }, [map, enabled, onClick])
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

// ============================================================
// 首页：同一张地图，两个视图（足迹 / 景点）干净分离
//   · 足迹视图：聚合打卡点（点气泡渐进展开至多数为 1；点单 pin 打开右侧图片相册）
//     + 点击地图空白打卡 + 统计概览
//   · 景点视图：景点聚合图钉 + 搜索联想 + 右侧简介面板
// ============================================================
export default function HomeMap() {
  const [view, setView] = useState('footprint') // 'footprint' | 'landmark'
  const [landmarks, setLandmarks] = useState([])
  const [myCheckins, setMyCheckins] = useState([])
  const [checkinPos, setCheckinPos] = useState(null)

  // 景点视图状态（聚合由视图切换时重挂载，见 landmarkLayerVersion）
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [selectedLandmark, setSelectedLandmark] = useState(null)
  const [flyToPosition, setFlyToPosition] = useState(null)
  const [landmarkLayerVersion, setLandmarkLayerVersion] = useState(0)
  const [footprintLayerVersion, setFootprintLayerVersion] = useState(0)
  // 相册侧边栏：pin 值=1 且被点击时打开，展示该位置的全部打卡图片
  const [albumIds, setAlbumIds] = useState(null)
  // 同坐标多单点点击 → 就地放大请求（带 tick 以便连点重置）
  const [samePointZoom, setSamePointZoom] = useState(null)
  const clickSuppressRef = useRef(0)
  const searchInputRef = useRef(null)
  const { mapRef } = useMapContext()

  // 同坐标叠放的打卡（zoom 到底仍挤在一起的"值=1 pin 组"）
  const samePointGroups = useMemo(() => {
    const groups = new Map()
    for (const c of myCheckins) {
      const key = `${Number(c.lat).toFixed(4)},${Number(c.lng).toFixed(4)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(c.id)
    }
    return groups
  }, [myCheckins])

  // 相册内容：按 id 集合取打卡，时间倒序
  const albumCheckins = useMemo(() => {
    if (!albumIds) return []
    const set = new Set(albumIds)
    return myCheckins
      .filter(c => set.has(c.id))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [albumIds, myCheckins])

  // 打开相册（点击单 pin 或最高聚类级仍同坐标的多 pin）
  const openAlbum = useCallback((ids) => {
    setAlbumIds(ids)
    clickSuppressRef.current = Date.now()
  }, [])

  // 点击聚合气泡展开时，抑制穿透到地图的 click 触发打卡表单；同时收起相册
  const suppressMapClick = useCallback(() => {
    clickSuppressRef.current = Date.now()
    setAlbumIds(null)
  }, [])

  // 切换视图时重挂载聚合层（足迹/景点各一份），清除 leaflet.markercluster 内部缓存；
  // 相册面板仅属于足迹视图，切换即关闭
  useEffect(() => {
    if (view === 'landmark') setLandmarkLayerVersion(v => v + 1)
    if (view === 'footprint') setFootprintLayerVersion(v => v + 1)
    setAlbumIds(null)
  }, [view])

  // 加载景点与我的打卡
  useEffect(() => {
    fetchLandmarks().then(setLandmarks).catch(console.error)
    fetchMyCheckins().then(setMyCheckins).catch(console.error)
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

  // 景点 id → 景点，用于打卡统计
  const landmarkById = useMemo(() => {
    const m = new Map()
    for (const lm of landmarks) m.set(lm.id, lm)
    return m
  }, [landmarks])

  // 地图中心（WGS-84 → GCJ-02）
  const mapCenter = useMemo(() => {
    const [gcjLng, gcjLat] = wgs84ToGcj02(104.1954, 35.8617)
    return [gcjLat, gcjLng]
  }, [])

  // 我的打卡点（转换成 GCJ-02）
  const myCheckinMarkers = useMemo(() => {
    return myCheckins.map(c => {
      const [gcjLng, gcjLat] = wgs84ToGcj02(c.lng, c.lat)
      return { ...c, position: [gcjLat, gcjLng] }
    })
  }, [myCheckins])

  // 足迹统计概览：省份 / 城市 / 景点 / 打卡
  const stats = useMemo(() => {
    const provinces = new Set()
    const cities = new Set()
    const visitedLandmarks = new Set()
    for (const c of myCheckins) {
      if (c.province) provinces.add(c.province)
      const lm = c.landmark_id ? landmarkById.get(c.landmark_id) : null
      if (lm?.city) cities.add(lm.city)
      if (c.landmark_id) visitedLandmarks.add(c.landmark_id)
    }
    return {
      provinces: provinces.size,
      cities: cities.size,
      landmarks: visitedLandmarks.size,
      checkins: myCheckins.length,
    }
  }, [myCheckins, landmarkById])

  // 选择景点：打开简介 + 飞行定位
  const handleSelectLandmark = useCallback((landmark) => {
    setSelectedLandmark(landmark)
    const [gcjLng, gcjLat] = wgs84ToGcj02(landmark.lng, landmark.lat)
    setFlyToPosition([gcjLat, gcjLng])
    setSearchOpen(false)
    setSearchQuery('')
    setActiveIndex(-1)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setSelectedLandmark(null)
    setFlyToPosition(null)
  }, [])

  // 地图点击打卡：得到 GCJ-02 坐标，存库前转回 WGS-84。
  // 聚合气泡/单 pin 点击后短暂抑制，避免事件穿透误触发打卡表单。
  const handleMapCheckinClick = useCallback((latlng) => {
    if (Date.now() - clickSuppressRef.current < 300) return
    const [wgsLng, wgsLat] = gcj02ToWgs84(latlng.lng, latlng.lat)
    setCheckinPos({ lat: wgsLat, lng: wgsLng })
  }, [])

  const handleSearch = useCallback((value) => {
    setSearchQuery(value)
    setActiveIndex(-1)
    setSearchOpen(!!value.trim())
  }, [])

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
      {/* ============ 单一地图：瓦片/遮罩两视图共享 ============ */}
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
        <ClickToCheckin enabled={view === 'footprint'} onClick={handleMapCheckinClick} />

        <TileLayer
          url={OSM_TILE_URL}
          subdomains="abc"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* 中国范围遮罩：遮住境外区域，仅保留中国领土 */}
        <ChinaMask />

        {/* ============ 足迹视图：我的打卡（聚合，渐进展开） ============ */}
        {view === 'footprint' && (
          <>
            <ExpandOnClusterClick onSuppressMapClick={suppressMapClick} />
            <MarkerClusterGroup
              key={`checkin-cluster-${footprintLayerVersion}`}
              maxClusterRadius={50}
              disableClusteringAtZoom={11}
              showCoverageOnHover={false}
              iconCreateFunction={createCheckinClusterIcon}
            >
              {myCheckinMarkers.map((c) => (
                <Marker
                  key={`checkin-${c.id}`}
                  position={c.position}
                  icon={createCheckinPinIcon(albumIds?.includes(c.id) ?? false)}
                  eventHandlers={{
                    click: () => {
                      // 同坐标叠放的多个"单点"：先就地放大；已到最高聚类级仍同坐标 → 作为同点相册
                      const key = `${Number(c.lat).toFixed(4)},${Number(c.lng).toFixed(4)}`
                      const group = samePointGroups.get(key)
                      if (group && group.length > 1) {
                        if (mapRef.current && mapRef.current.getZoom() < 11) {
                          setSamePointZoom({ center: c.position, zoomCap: 11, tick: Date.now() })
                          suppressMapClick()
                        } else {
                          openAlbum(group)
                        }
                        return
                      }
                      openAlbum([c.id])
                    },
                  }}
                />
              ))}
            </MarkerClusterGroup>
            {samePointZoom && (
              <ZoomAtSamePoint
                key={`same-pt-${samePointZoom.center.join(',')}-${samePointZoom.tick}`}
                center={samePointZoom.center}
                zoomCap={samePointZoom.zoomCap}
                onDone={() => setSamePointZoom(null)}
              />
            )}
          </>
        )}

        {/* ============ 景点视图：聚合图钉 ============ */}
        {view === 'landmark' && landmarks.length > 0 && (
          <MarkerClusterGroup
            key={`cluster-${landmarkLayerVersion}`}
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
        )}

        {/* 景点定位飞行 */}
        <FlyToLocation position={flyToPosition} zoom={10} />
      </MapContainer>

      {/* 视图切换器（两视图共享，固定顶部） */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1200]">
        <MapViewSwitcher currentView={view} onViewChange={setView} />
      </div>

      {/* ============ 景点视图 UI：搜索 + 简介面板 ============ */}
      {view === 'landmark' && (
        <>
          <div className="absolute top-20 left-4 z-[1000] w-72">
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

          <LandmarkDetailPanel
            landmark={selectedLandmark}
            landmarks={landmarks}
            onLocate={(lm) => handleSelectLandmark(lm)}
            onClose={handleCloseDetail}
            onSelect={(lm) => handleSelectLandmark(lm)}
          />
        </>
      )}

      {/* ============ 足迹视图 UI：统计概览 ============ */}
      {view === 'footprint' && (
        <div className="absolute bottom-4 left-4 z-[1100] bg-white/95 backdrop-blur-sm rounded-xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-800">我的足迹</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-gray-100">
            <StatCell value={stats.provinces} label="省份" />
            <StatCell value={stats.cities} label="城市" />
            <StatCell value={stats.landmarks} label="景点" />
            <StatCell value={stats.checkins} label="打卡" />
          </div>
          <div className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
            点击地图空白处即可打卡
          </div>
        </div>
      )}

      {/* ============ 足迹视图 UI：图片相册侧边栏（仅单 pin 点击时） ============ */}
      {view === 'footprint' && albumCheckins.length > 0 && (
        <aside className="checkin-album-panel">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
              <Images className="w-4 h-4 text-green-600 shrink-0" />
              <h3 className="text-sm font-semibold text-gray-800 truncate">
                {albumCheckins[0].caption || '打卡点'}
              </h3>
              <span className="text-xs text-gray-400 shrink-0">· {albumCheckins.length} 张</span>
            </div>
            <button
              onClick={() => setAlbumIds(null)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              aria-label="关闭相册"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {albumCheckins.map(c => {
              const imageUrl = c.image_url?.startsWith('http')
                ? c.image_url
                : getPublicUrl('checkin-images', c.image_url)
              return (
                <figure key={c.id} className="rounded-xl overflow-hidden border border-gray-100 shadow-sm bg-white">
                  <img
                    src={imageUrl}
                    alt={c.caption || '打卡照片'}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-44 object-cover"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                  />
                  <figcaption className="p-3">
                    {c.caption && <p className="text-sm text-gray-800">{c.caption}</p>}
                    <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400">
                      <span>{c.province ? `${c.province} · ` : ''}{timeAgo(c.created_at)}</span>
                      <LikeButton targetId={c.id} targetType="checkin" count={c.likes_count || 0} />
                    </div>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </aside>
      )}

      {/* 打卡表单弹窗 */}
      {checkinPos && (
        <CheckinForm
          lat={checkinPos.lat}
          lng={checkinPos.lng}
          onClose={() => setCheckinPos(null)}
          onSuccess={(checkin) => {
            setMyCheckins(prev => [checkin, ...prev])
            setCheckinPos(null)
          }}
        />
      )}
    </div>
  )
}

// 统计卡片单元格
function StatCell({ value, label }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-gray-900 leading-none">{value}</div>
      <div className="text-[11px] text-gray-400 mt-1">{label}</div>
    </div>
  )
}
