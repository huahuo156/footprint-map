import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import { MapBridge, useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02 } from '../../lib/coordTransform'
import CheckinPopup from './CheckinPopup'
import FootprintTrail from './FootprintTrail'
import ChinaMask from './ChinaMask'
import { ArrowLeft } from 'lucide-react'

// 高德地图瓦片 — 标准路网
const GAODE_KEY = '5868643b4d58fb0e3ddfb707a20ca11c'

const PROVINCE_CENTERS = {
  '北京': [39.9, 116.4], '天津': [39.1, 117.2], '上海': [31.2, 121.5],
  '重庆': [29.6, 106.5], '河北': [38.0, 114.5], '山西': [37.9, 112.5],
  '辽宁': [41.8, 123.4], '吉林': [43.9, 125.3], '黑龙江': [46.0, 127.7],
  '江苏': [32.1, 118.8], '浙江': [30.3, 120.2], '安徽': [31.8, 117.3],
  '福建': [26.1, 119.3], '江西': [27.6, 116.0], '山东': [36.7, 117.0],
  '河南': [34.8, 113.7], '湖北': [30.6, 114.3], '湖南': [28.2, 112.9],
  '广东': [23.1, 113.3], '海南': [19.2, 109.7], '四川': [30.6, 104.1],
  '贵州': [26.6, 106.7], '云南': [25.0, 102.7], '陕西': [34.3, 108.9],
  '甘肃': [36.1, 103.8], '青海': [36.6, 101.8], '台湾': [23.7, 121.0],
  '内蒙古': [40.8, 111.7], '广西': [22.8, 108.3], '西藏': [29.7, 91.1],
  '宁夏': [37.5, 106.3], '新疆': [43.8, 87.6],
  '香港': [22.3, 114.2], '澳门': [22.2, 113.5],
}

function FlyToProvince({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) {
      const [gcjLng, gcjLat] = wgs84ToGcj02(center[1], center[0])
      map.flyTo([gcjLat, gcjLng], 7, { duration: 1.5 })
    }
  }, [center, map])
  return null
}

// ---- 地标标记：按类别区分 ----
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
  const size = highlighted ? 30 : 24
  const tail = 7
  const total = size + tail
  const emoji = highlighted ? 15 : 12

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

export default function ProvinceView() {
  const { name } = useParams()
  const navigate = useNavigate()
  const { hoveredItemId } = useMapContext()
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])
  const center = PROVINCE_CENTERS[name] || [35.86, 104.19]
  const gcjCenter = useMemo(() => {
    const [gcjLng, gcjLat] = wgs84ToGcj02(center[1], center[0])
    return [gcjLat, gcjLng]
  }, [name])

  useEffect(() => {
    fetchLandmarks().then(all => setLandmarks(all.filter(l => l.province === name))).catch(console.error)
    fetchCheckins({ province: name }).then(setCheckins).catch(console.error)
  }, [name])

  // 按类别缓存图标
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

  return (
    <div className="w-full h-full relative">
      <MapContainer center={gcjCenter} zoom={7} className="w-full h-full" minZoom={4} maxZoom={18} maxBounds={[[2, 73], [55, 135]]} maxBoundsViscosity={1.0}>
        <MapBridge />

        {/* 省份模式：高德标准路网 */}
        <TileLayer
          url={`https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7&key=${GAODE_KEY}`}
          subdomains={['1', '2', '3', '4']}
          maxZoom={18}
          attribution='&copy; <a href="https://www.amap.com/">高德地图</a>'
        />

        {/* 中国范围遮罩：遮住境外区域，仅保留中国领土 */}
        <ChinaMask />

        <FlyToProvince center={center} />

        {landmarks.map(lm => {
          const isHighlighted = hoveredItemId === `landmark-${lm.id}`
          const cat = lm.category || '_default'
          const cached = iconCache[cat]
          const icon = isHighlighted ? cached.highlighted : cached.normal
          const [gcjLng, gcjLat] = wgs84ToGcj02(lm.lng, lm.lat)

          return (
            <Marker key={`lm-${lm.id}`} position={[gcjLat, gcjLng]} icon={icon}>
              <Popup>
                <div className="w-48">
                  <div className="flex items-center gap-1.5">
                    <span>{(CATEGORY_STYLES[lm.category] || DEFAULT_CAT_STYLE).icon}</span>
                    <h3 className="font-bold text-sm">{lm.name}</h3>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{lm.city} · {lm.category}</p>
                  <p className="text-xs text-gray-600 mt-1">{lm.description}</p>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {checkins.map(c => {
          const isHighlighted = hoveredItemId === `checkin-${c.id}`
          const [gcjLng, gcjLat] = wgs84ToGcj02(c.lng, c.lat)
          return (
            <Marker key={`ck-${c.id}`} position={[gcjLat, gcjLng]} icon={isHighlighted ? highlightedCheckinIcon : checkinIcon}>
              <Popup maxWidth={280}><CheckinPopup checkin={c} /></Popup>
            </Marker>
          )
        })}

        <FootprintTrail />
      </MapContainer>

      <button
        onClick={() => navigate('/')}
        className="absolute top-4 left-4 z-[1000] bg-white hover:bg-gray-50 shadow-lg rounded-lg px-3 py-2 flex items-center gap-2 text-sm font-medium text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" /> 全国地图
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 shadow-lg rounded-lg px-4 py-2 text-center pointer-events-none">
        <h2 className="font-bold text-gray-900">{name}</h2>
        <p className="text-xs text-gray-500">{landmarks.length} 个景点 · {checkins.length} 条打卡</p>
      </div>
    </div>
  )
}
