import { expect, it } from 'vitest'
import { atlasPhotos } from '../src/journal/atlasLayout'
import { containsPosition, provinceShapes, regionForPlace } from '../src/journal/atlasGeography'
import { atlasInsights } from '../src/journal/atlasInsights'

const entry = (id, name, date, extra = {}) => ({ id, place_name: name, entry_date: date, photos: [{ id: `photo-${id}`, url: '/photo.jpg' }], ...extra })

it('assigns a true province from GPS even when the place label names another province', () => {
  expect(provinceShapes).toHaveLength(34)
  expect(regionForPlace({ lng: 114.30, lat: 30.59 })).toMatchObject({ province: { code: 420000, name: '湖北省' }, city: { name: '武汉市' } })
  const item = atlasPhotos({ entries: [entry('gps', '武汉市', '', { lng: 104.07, lat: 30.66 })] }).located[0]
  expect(item.province.code).toBe(510000)
  expect(regionForPlace({ lng: 2.35, lat: 48.85 }).province).toBeNull()
})

it('excludes holes while including separate islands of a province', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
    [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
  ] }
  expect(containsPosition(geometry, { lng: 5, lat: 5 })).toBe(false)
  expect(containsPosition(geometry, { lng: 1, lat: 1 })).toBe(true)
  expect(containsPosition(geometry, { lng: 21, lat: 21 })).toBe(true)
})

it('groups every photo by place and city without losing photos beyond one page', () => {
  const entries = Array.from({ length: 14 }, (_, i) => entry(i, '武汉市', '2026-10-01'))
  entries.push(entry('other', '成都市', '2026-10-02'))
  const insights = atlasInsights(atlasPhotos({ entries }).located)
  expect(insights.places.find(place => place.name === '武汉市').items).toHaveLength(14)
  expect(insights.cities.find(city => city.name === '武汉市').count).toBe(14)
  expect(insights.provinces).toHaveLength(2)
})

it('shares a selectable pin for aliases and landmark IDs at coincident coordinates', () => {
  const entries = [entry('short', '武汉', ''), entry('full', '武汉市', '')]
  entries.push(entry('id', '江边', '', { lat: 30.584355, lng: 114.298572, landmark_id: 88 }))
  const groups = atlasInsights(atlasPhotos({ entries }).located)
  expect(groups.places).toHaveLength(1)
  expect(groups.places[0].count).toBe(3)
})

it('deduplicates trips, dates and original records and finds the earliest valid visit date', () => {
  const entries = [
    entry('a', '武汉市', '2026-10-05', { trip_id: 'one' }),
    entry('b', '武汉市', '2026-10-06', { trip_id: 'one' }),
    entry('c', '武汉市', '2026-09-01'),
    entry('d', '武汉市', '2026-09-01'),
    entry('e', '武汉市', '', { record_id: 'undated' }),
    entry('f', '武汉市', '', { record_id: 'undated' }),
    entry('invalid', '武汉市', '2026-02-31'),
  ]
  const province = atlasInsights(atlasPhotos({ entries }).located).provinces[0]
  expect(province).toMatchObject({ name: '湖北省', count: 7, visits: 4, firstVisited: '2026-09-01' })
  expect(atlasInsights(atlasPhotos({ entries: [entry('missing', '武汉市', '')] }).located).provinces[0].firstVisited).toBeNull()
})
