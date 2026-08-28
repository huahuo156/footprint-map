import { useEffect, useState, useCallback } from 'react'
import { useMapContext } from '../../contexts/MapContext'
import { wgs84ToGcj02 } from '../../lib/coordTransform'

export default function ConnectionLineOverlay() {
  const {
    hoveredItemId,
    hoveredItemRect,
    hoveredItemLat,
    hoveredItemLng,
    mapRef,
    mapContainerRef,
    mapVersion,
  } = useMapContext()

  const [lineCoords, setLineCoords] = useState(null)

  const updateCoords = useCallback(() => {
    if (!hoveredItemId || !hoveredItemRect || !hoveredItemLat || !hoveredItemLng) {
      setLineCoords(null)
      return
    }

    const map = mapRef.current
    const mapContainer = mapContainerRef.current
    if (!map || !mapContainer) {
      setLineCoords(null)
      return
    }

    // Start point: center of the sidebar image (viewport coordinates)
    const startX = hoveredItemRect.left + hoveredItemRect.width / 2
    const startY = hoveredItemRect.top + hoveredItemRect.height / 2

    // End point: marker position in viewport coordinates (convert to GCJ-02 to match marker positions)
    const mapRect = mapContainer.getBoundingClientRect()
    const [gcjLng, gcjLat] = wgs84ToGcj02(hoveredItemLng, hoveredItemLat)
    const point = map.latLngToContainerPoint([gcjLat, gcjLng])
    const endX = mapRect.left + point.x
    const endY = mapRect.top + point.y

    setLineCoords({ startX, startY, endX, endY })
  }, [hoveredItemId, hoveredItemRect, hoveredItemLat, hoveredItemLng, mapRef, mapContainerRef])

  // Recalculate when hover state or map position changes
  useEffect(() => {
    updateCoords()
  }, [updateCoords, mapVersion])

  // Recalculate on sidebar scroll
  useEffect(() => {
    if (!hoveredItemId) return

    const sidebar = document.querySelector('.sidebar-scroll')
    if (!sidebar) return

    const onScroll = () => updateCoords()
    sidebar.addEventListener('scroll', onScroll, { passive: true })
    return () => sidebar.removeEventListener('scroll', onScroll)
  }, [hoveredItemId, updateCoords])

  // Recalculate on window resize
  useEffect(() => {
    if (!hoveredItemId) return
    const onResize = () => updateCoords()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [hoveredItemId, updateCoords])

  if (!lineCoords) return null

  const { startX, startY, endX, endY } = lineCoords

  // Calculate control point for quadratic Bezier (arc away from the direct line)
  const midX = (startX + endX) / 2
  const midY = (startY + endY) / 2
  // Perpendicular offset for the curve
  const dx = endX - startX
  const dy = endY - startY
  const dist = Math.sqrt(dx * dx + dy * dy)
  const offset = Math.min(dist * 0.15, 60) // Subtle curve, max 60px
  const ctrlX = midX + (-dy / dist) * offset
  const ctrlY = midY + (dx / dist) * offset

  const pathD = `M ${startX},${startY} Q ${ctrlX},${ctrlY} ${endX},${endY}`
  const gradientId = `line-grad-${hoveredItemId}`

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1500, width: '100vw', height: '100vh' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.5" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Animated dashed line */}
      <path
        d={pathD}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeDasharray="8 4"
        className="connection-line"
      />

      {/* Glowing endpoint dot */}
      <circle
        cx={endX}
        cy={endY}
        r="4"
        fill="#3b82f6"
        filter="url(#glow)"
        className="connection-endpoint"
      />
    </svg>
  )
}
