import boundaries from '../data/china-provinces.json'
import regions from '../data/china-places.json'

export const projectPlace = (lng, lat) => ({ x: 550 + (lng - 104) * 7.2, y: 360 + (33 - lat) * 6.8 })
const palette = ['#e7b95e', '#df866f', '#8dc8bc', '#b7a1d6', '#82b6e1', '#d997b7', '#c5c779', '#eda873', '#91c6a0', '#c0a9eb', '#e1a28e', '#93becb']
const polygonsOf = geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]

function insideRing({ lng, lat }, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function containsPosition(geometry, position) {
  return polygonsOf(geometry).some(polygon => insideRing(position, polygon[0]) && !polygon.slice(1).some(hole => insideRing(position, hole)))
}

export const provinceShapes = boundaries.features.filter(feature => feature.properties.name && feature.properties.level === 'province').map((feature, index) => {
  const polygons = polygonsOf(feature.geometry), coordinates = polygons.flat(2)
  const lngs = coordinates.map(point => point[0]), lats = coordinates.map(point => point[1])
  return {
    code: Number(feature.properties.adcode), name: feature.properties.name,
    center: feature.properties.centroid || feature.properties.center, geometry: feature.geometry,
    pinColor: palette[index % palette.length],
    bounds: { west: Math.min(...lngs), east: Math.max(...lngs), south: Math.min(...lats), north: Math.max(...lats) },
    path: polygons.map(polygon => polygon.map(ring => ring.map(([lng, lat], i) => {
      const point = projectPlace(lng, lat)
      return `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    }).join(' ') + ' Z').join(' ')).join(' '),
  }
})

const citiesByProvince = new Map(provinceShapes.map(province => [province.code, regions.filter(region => region.parent === province.name)]))

export function regionForPlace(position) {
  const province = provinceShapes.find(shape => {
    const b = shape.bounds
    return position.lng >= b.west && position.lng <= b.east && position.lat >= b.south && position.lat <= b.north && containsPosition(shape.geometry, position)
  }) || null
  if (!province) return { province: null, city: null }
  // City centers label geographic clusters; province membership uses polygon containment.
  const candidates = citiesByProvince.get(province.code)
  const city = candidates.reduce((nearest, region) => {
    const distance = Math.hypot((region.center[0] - position.lng) * Math.cos(position.lat * Math.PI / 180), region.center[1] - position.lat)
    return distance < nearest.distance ? { city: region, distance } : nearest
  }, { city: { code: province.code, name: province.name, center: province.center }, distance: Infinity }).city
  return { province, city }
}
