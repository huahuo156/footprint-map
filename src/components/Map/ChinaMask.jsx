import { useEffect, useMemo, useState } from 'react'
import { GeoJSON } from 'react-leaflet'

// 中国范围遮罩：用覆盖全球的多边形（以中国国界为洞）遮住境外区域，
// 使地图在任何缩放/平移下都只显示中国领土。
// DataV 国界数据本身即为 GCJ-02，与高德瓦片同坐标系，直接使用。
export default function ChinaMask() {
  const [border, setBorder] = useState(null)

  useEffect(() => {
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000.json')
      .then(r => r.json())
      .then(data => setBorder(data.features?.[0] || null))
      .catch(console.error)
  }, [])

  const maskData = useMemo(() => {
    if (!border?.geometry?.coordinates) return null
    const holes = border.geometry.coordinates.map(poly => poly[0])
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-200, -200], [-200, 200], [200, 200], [200, -200], [-200, -200]],
          ...holes,
        ],
      },
    }
  }, [border])

  if (!maskData) return null
  return (
    <GeoJSON
      data={maskData}
      interactive={false}
      pane="tilePane"
      style={{ fillColor: '#f2efe9', fillOpacity: 1, stroke: false }}
    />
  )
}
