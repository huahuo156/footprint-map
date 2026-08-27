import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import CheckinPopup from './CheckinPopup'
import { ArrowLeft } from 'lucide-react'

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
    if (center) map.flyTo(center, 7, { duration: 1.5 })
  }, [center, map])
  return null
}

const landmarkIcon = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
})

const checkinIcon = L.divIcon({
  className: '',
  html: `<div style="background:#22c55e;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
})

export default function ProvinceView() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])
  const center = PROVINCE_CENTERS[name] || [35.86, 104.19]

  useEffect(() => {
    fetchLandmarks().then(all => setLandmarks(all.filter(l => l.province === name))).catch(console.error)
    fetchCheckins({ province: name }).then(setCheckins).catch(console.error)
  }, [name])

  return (
    <div className="w-full h-full relative">
      <MapContainer center={center} zoom={7} className="w-full h-full" minZoom={3} maxZoom={18}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FlyToProvince center={center} />

        {landmarks.map(lm => (
          <Marker key={`lm-${lm.id}`} position={[lm.lat, lm.lng]} icon={landmarkIcon}>
            <Popup>
              <div className="w-48">
                <h3 className="font-bold text-sm">{lm.name}</h3>
                <p className="text-xs text-gray-500">{lm.city} · {lm.category}</p>
                <p className="text-xs text-gray-600 mt-1">{lm.description}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {checkins.map(c => (
          <Marker key={`ck-${c.id}`} position={[c.lat, c.lng]} icon={checkinIcon}>
            <Popup maxWidth={280}><CheckinPopup checkin={c} /></Popup>
          </Marker>
        ))}
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
