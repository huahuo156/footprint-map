import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import { MapBridge, useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../lib/coordTransform'
import CheckinPopup from './CheckinPopup'
import FootprintTrail from './FootprintTrail'
import ChinaMask from './ChinaMask'
import MapLayerControl, { getTileUrl } from './MapLayerControl'
import MapViewSwitcher from './MapViewSwitcher'
import { createLandmarkImageIcon, createCheckinImageIcon } from './ImageMarkerIcon'
import { getLandmarkImage } from '../../data/landmarkImages'

// ============================================================
// 高德地图瓦片 — 标准路网
// API Key: 免费注册 https://console.amap.com/
// ============================================================
const GAODE_KEY = '5868643b4d58fb0e3ddfb707a20ca11c'

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
  const [mapStyle, setMapStyle] = useState('standard')
  const [viewMode, setViewMode] = useState('landmark') // 'landmark' | 'checkin'

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

  const allMarkers = [
    ...landmarks.map(lm => {
      const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)
      return { ...lm, type: 'landmark', position: [gcjLat, gcjLng] }
    }),
    ...checkins.map(c => {
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

        {/* 全国模式：高德地图瓦片（支持多种样式切换） */}
        <TileLayer
          key={mapStyle}
          url={getTileUrl(mapStyle, GAODE_KEY)}
          subdomains={['1', '2', '3', '4']}
          maxZoom={18}
          attribution='&copy; <a href="https://www.amap.com/">高德地图</a>'
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
          // 景点视图：显示景点图片标记
          landmarks.map((lm) => {
            const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)
            const isHighlighted = hoveredItemId === `landmark-${lm.id}`
            const isSelected = selectedItemId === `landmark-${lm.id}`
            const highlight = isHighlighted || isSelected
            const imageUrl = getLandmarkImage(lm.name)

            return (
              <Marker
                key={`landmark-${lm.id}`}
                position={[gcjLat, gcjLng]}
                icon={createLandmarkImageIcon(imageUrl, lm.name, highlight)}
              >
                <Popup maxWidth={300}>
                  <div className="w-72">
                    <img
                      src={imageUrl}
                      alt={lm.name}
                      className="w-full h-40 object-cover rounded-t-lg"
                      onError={(e) => {
                        e.target.src = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=200&h=200&fit=crop'
                      }}
                    />
                    <div className="p-3">
                      <h3 className="font-bold text-base">{lm.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{lm.province} · {lm.city} · {lm.category}</p>
                      <p className="text-sm text-gray-600 mt-2">{lm.description}</p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })
        ) : (
          // 打卡视图：显示用户打卡照片标记
          checkins.map((c) => {
            const [gcjLng, gcjLat] = wgs84ToGcj02(c.lng, c.lat)
            const isHighlighted = hoveredItemId === `checkin-${c.id}`
            const isSelected = selectedItemId === `checkin-${c.id}`
            const highlight = isHighlighted || isSelected
            const imageUrl = c.image_url?.startsWith('http')
              ? c.image_url
              : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/checkin-images/${c.image_url}`

            return (
              <Marker
                key={`checkin-${c.id}`}
                position={[gcjLat, gcjLng]}
                icon={createCheckinImageIcon(imageUrl, highlight)}
              >
                <Popup maxWidth={280}>
                  <CheckinPopup checkin={c} />
                </Popup>
              </Marker>
            )
          })
        )}

        {/* 景点名称标注（zoom >= 6 时显示） */}
        <LandmarkLabels landmarks={landmarks} />

        <FootprintTrail />
      </MapContainer>

      {/* 图层切换控件 */}
      <MapLayerControl
        currentStyle={mapStyle}
        onStyleChange={setMapStyle}
        apiKey={GAODE_KEY}
      />

      {/* 视图切换控件 */}
      <MapViewSwitcher
        currentView={viewMode}
        onViewChange={setViewMode}
      />

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
