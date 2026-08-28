import { useEffect, useState, useRef } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import { fetchMyCheckins } from '../../lib/api'
import { wgs84ToGcj02 } from '../../lib/coordTransform'

export default function FootprintTrail() {
  const map = useMap()
  const [positions, setPositions] = useState([])
  const trailRef = useRef(null)

  useEffect(() => {
    fetchMyCheckins().then(checkins => {
      if (checkins.length < 2) return
      // Sort by created_at to form a chronological trail
      const sorted = [...checkins].sort((a, b) =>
        new Date(a.created_at) - new Date(b.created_at)
      )
      setPositions(sorted.map(c => {
        const [gcjLng, gcjLat] = wgs84ToGcj02(c.lng, c.lat)
        return [gcjLat, gcjLng]
      }))
    }).catch(() => {})
  }, [])

  // Animate the trail's stroke-dashoffset
  useEffect(() => {
    if (positions.length < 2) return

    const interval = setInterval(() => {
      // Find the SVG path element for the trail
      const paths = document.querySelectorAll('.footprint-trail-path')
      paths.forEach(path => {
        const current = parseFloat(path.style.strokeDashoffset || '0')
        path.style.strokeDashoffset = `${current - 0.5}`
      })
    }, 50)

    return () => clearInterval(interval)
  }, [positions])

  if (positions.length < 2) return null

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: '#f59e0b',
        weight: 2.5,
        dashArray: '10 6',
        opacity: 0.8,
        className: 'footprint-trail-path',
      }}
    />
  )
}
