import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchLandmarks, fetchCheckins } from '../../lib/api'
import CheckinPopup from './CheckinPopup'

const landmarkIcon = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const checkinIcon = L.divIcon({
  className: '',
  html: `<div style="background:#22c55e;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

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

export default function ChinaMap() {
  const navigate = useNavigate()
  const [geoJson, setGeoJson] = useState(null)
  const [landmarks, setLandmarks] = useState([])
  const [checkins, setCheckins] = useState([])
  const [hoveredProvince, setHoveredProvince] = useState(null)
  const [checkinPos, setCheckinPos] = useState(null)

  useEffect(() => {
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
      .then(r => r.json())
      .then(setGeoJson)
      .catch(console.error)
    fetchLandmarks().then(setLandmarks).catch(console.error)
    fetchCheckins().then(setCheckins).catch(console.error)
  }, [])

  const handleProvinceClick = useCallback((provinceName) => {
    const shortName = PROVINCE_MAP[provinceName] || provinceName
    navigate(`/province/${encodeURIComponent(shortName)}`)
  }, [navigate])

  const onEachFeature = useCallback((feature, layer) => {
    const name = feature.properties.name
    const shortName = PROVINCE_MAP[name] || name
    layer.on({
      click: () => handleProvinceClick(name),
      mouseover: (e) => {
        e.target.setStyle({ fillColor: '#93c5fd', fillOpacity: 0.6 })
        setHoveredProvince(shortName)
      },
      mouseout: (e) => {
        e.target.setStyle({ fillColor: '#dbeafe', fillOpacity: 0.3 })
        setHoveredProvince(null)
      },
    })
    layer.bindTooltip(shortName, { sticky: true })
  }, [handleProvinceClick])

  const geoJsonStyle = { fillColor: '#dbeafe', fillOpacity: 0.3, color: '#9ca3af', weight: 1 }

  const allMarkers = [
    ...landmarks.map(lm => ({ ...lm, type: 'landmark', position: [lm.lat, lm.lng] })),
    ...checkins.map(c => ({ ...c, type: 'checkin', position: [c.lat, c.lng] })),
  ]

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={[35.8617, 104.1954]}
        zoom={4}
        className="w-full h-full"
        minZoom={3}
        maxZoom={18}
        zoomControl={false}
        eventHandlers={{
          click: (e) => {
            if (e.originalEvent.target.classList?.contains('leaflet-container') ||
                e.originalEvent.target.classList?.contains('leaflet-tile')) {
              setCheckinPos({ lat: e.latlng.lat, lng: e.latlng.lng })
            }
          },
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {geoJson && (
          <GeoJSON key="china" data={geoJson} style={() => geoJsonStyle} onEachFeature={onEachFeature} />
        )}

        {allMarkers.map((item) => (
          <Marker
            key={`${item.type}-${item.id}`}
            position={item.position}
            icon={item.type === 'landmark' ? landmarkIcon : checkinIcon}
          >
            {item.type === 'checkin' ? (
              <Popup maxWidth={280}><CheckinPopup checkin={item} /></Popup>
            ) : (
              <Popup>
                <div className="w-48">
                  <h3 className="font-bold text-sm">{item.name}</h3>
                  <p className="text-xs text-gray-500">{item.province} · {item.category}</p>
                  <p className="text-xs text-gray-600 mt-1">{item.description}</p>
                </div>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>

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
