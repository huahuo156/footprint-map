import { projectPlace } from './atlasGeography'

function knownDate(value) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(day + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null
}

function summarize(group) {
  const visits = new Set(), dates = []
  for (const item of group.items) {
    const date = knownDate(item.entry.entry_date)
    if (date) dates.push(date)
    visits.add(item.entry.trip_id != null ? `trip:${item.entry.trip_id}` : date ? `day:${date}` : `record:${item.entry.record_id || item.entry.id}`)
  }
  return { ...group, count: group.items.length, visits: visits.size, firstVisited: dates.sort()[0] || null }
}

export function atlasInsights(items) {
  const places = new Map(), cities = new Map(), provinces = new Map()
  function add(map, key, group, item) {
    if (!map.has(key)) map.set(key, { ...group, id: key, items: [] })
    map.get(key).items.push(item)
  }
  for (const item of items) {
    const common = { pinColor: item.pinColor, point: item.point }
    add(places, item.placeKey, { ...common, kind: 'place', name: item.name || '照片地点' }, item)
    const city = item.city
    const cityKey = city ? `city:${city.code}` : `place:${item.placeKey}`
    add(cities, cityKey, { ...common, kind: 'city', name: city?.name || item.name || '照片地点', point: city ? projectPlace(...city.center) : item.point }, item)
    if (item.province) {
      const province = item.province
      add(provinces, String(province.code), { kind: 'province', name: province.name, code: province.code, pinColor: province.pinColor, point: projectPlace(...province.center) }, item)
    }
  }
  return { places: [...places.values()].map(summarize), cities: [...cities.values()].map(summarize), provinces: [...provinces.values()].map(summarize) }
}
