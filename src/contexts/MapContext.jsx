import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { wgs84ToGcj02 } from '../lib/coordTransform'

const MapContext = createContext(null)

export function useMapContext() {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMapContext must be used within MapProvider')
  return ctx
}

export function MapProvider({ children }) {
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const [hoveredItemId, setHoveredItemId] = useState(null)
  const [hoveredItemType, setHoveredItemType] = useState(null)
  const [hoveredItemRect, setHoveredItemRect] = useState(null)
  const [hoveredItemLat, setHoveredItemLat] = useState(null)
  const [hoveredItemLng, setHoveredItemLng] = useState(null)
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [mapVersion, setMapVersion] = useState(0)

  const setHoveredItem = useCallback((id, type, rect, lat, lng) => {
    setHoveredItemId(id)
    setHoveredItemType(type)
    setHoveredItemRect(rect)
    setHoveredItemLat(lat)
    setHoveredItemLng(lng)
  }, [])

  const clearHoveredItem = useCallback(() => {
    setHoveredItemId(null)
    setHoveredItemType(null)
    setHoveredItemRect(null)
    setHoveredItemLat(null)
    setHoveredItemLng(null)
  }, [])

  const selectItem = useCallback((id) => {
    setSelectedItemId(id)
  }, [])

  const flyToLocation = useCallback((lat, lng, zoom = 8) => {
    if (mapRef.current) {
      const [gcjLng, gcjLat] = wgs84ToGcj02(lng, lat)
      mapRef.current.flyTo([gcjLat, gcjLng], zoom, { duration: 1.2 })
    }
  }, [])

  const value = {
    hoveredItemId,
    hoveredItemType,
    hoveredItemRect,
    hoveredItemLat,
    hoveredItemLng,
    selectedItemId,
    mapRef,
    mapContainerRef,
    mapVersion,
    setMapVersion,
    setHoveredItem,
    clearHoveredItem,
    selectItem,
    flyToLocation,
  }

  return (
    <MapContext.Provider value={value}>
      {children}
    </MapContext.Provider>
  )
}

export function MapBridge() {
  const map = useMap()
  const { mapRef, mapContainerRef, setMapVersion } = useContext(MapContext)

  useEffect(() => {
    mapRef.current = map
    // Store the map container DOM element
    mapContainerRef.current = map.getContainer()
  }, [map, mapRef, mapContainerRef])

  useEffect(() => {
    const onMoveEnd = () => setMapVersion(v => v + 1)
    const onZoomEnd = () => setMapVersion(v => v + 1)

    map.on('moveend', onMoveEnd)
    map.on('zoomend', onZoomEnd)

    return () => {
      map.off('moveend', onMoveEnd)
      map.off('zoomend', onZoomEnd)
    }
  }, [map, setMapVersion])

  return null
}
