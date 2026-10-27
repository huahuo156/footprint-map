import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { materializeJournal } from '../src/journal/components'
import { atlasPhotos, layoutAtlas, layoutScatter, settleAtlasPosition } from '../src/journal/atlasLayout'
import { cardBounds, intersects } from '../src/journal/model'
import PlaceAtlas from '../src/journal/PlaceAtlas'

afterEach(cleanup)
const photo = (id, place) => ({ id, url: '/' + id + '.jpg', components: place ? [{ type: 'place', value: place }] : [] })
const data = materializeJournal({ trips: [], entries: [{ id: 'entry', place_name: '旧地点', lat: 40, lng: 116, photos: [
  photo('located', { name: '湖边', lat: 30.25, lng: 120.15 }),
  photo('named', { name: '西湖', landmark_id: 5 }),
  photo('unknown', { name: '家门口的小店' }), photo('blank'),
  photo('abroad', { name: '巴黎', lat: 48.85, lng: 2.35 }),
] }] })
const landmarks = [{ id: 5, name: '西湖', lat: 30.25, lng: 120.15 }]

it('uses each photo’s place and separates missing, unresolved and overseas locations without inventing pins', () => {
  const result = atlasPhotos(data, landmarks)
  expect(result.located.map(item => item.photo.id)).toEqual(['located', 'named'])
  expect(result.unlocated.map(item => item.photo.id)).toEqual(['unknown', 'abroad'])
  expect(result.loose.map(item => item.photo.id)).toEqual(['blank'])
  expect(result.located[0].point).toEqual(result.located[1].point)
})

it('matches a place written with its province and refuses ambiguous names', () => {
  const entries = ['北京 · 故宫', '故宫', '西湖'].map((place_name, i) => ({ id: 'name' + i, place_name, photos: [photo('name' + i)] }))
  const result = atlasPhotos({ entries }, [
    { name: '故宫博物院', province: '北京', city: '故宫', lat: 39.9174, lng: 116.3908 },
    { name: '台北故宫博物院', province: '台湾', city: '台北故宫', lat: 25.10236, lng: 121.54849 },
    { name: '西湖甲', lat: 30, lng: 120 }, { name: '西湖乙', lat: 30, lng: 120 },
  ])
  expect(result.located.map(item => item.name)).toEqual(['北京 · 故宫', '故宫'])
  expect(result.unlocated.map(item => item.name)).toEqual(['西湖'])
})

it('locates city names without requiring a landmark and preserves precise photo coordinates', () => {
  const entries = ['武汉市', '武汉', '湖北省武汉市', '湖北武汉', '成都市', '不存在的城市'].map((place_name, i) => ({ id: 'city' + i, place_name, photos: [photo('city' + i)] }))
  entries.push({ id: 'gps', place_name: '武汉市', lat: 30.5, lng: 114.1, photos: [photo('gps')] })
  const result = atlasPhotos({ entries }, [{ id: 99, name: '城市公园', city: '武汉', lat: 30.6, lng: 114.5 }])
  expect(result.located.map(item => item.photo.id)).toEqual(['city0', 'city1', 'city2', 'city3', 'city4', 'gps'])
  for (const item of result.located.slice(0, 4)) {
    expect(item.point.x).toBeCloseTo(624.1497184)
    expect(item.point.y).toBeCloseTo(376.426386)
  }
  expect(result.located[0].locationHint).toBe('城市中心位置')
  expect(result.located[5].point.x).toBeCloseTo(622.72)
  expect(result.located[5].locationHint).toBe('')
  expect(result.unlocated.map(item => item.name)).toEqual(['不存在的城市'])
})

it('uses a stable province color for pins, including places resolved from coordinates', () => {
  const entries = [
    { id: 'wuhan', place_name: '武汉市', photos: [photo('wuhan')] },
    { id: 'hubei-gps', place_name: '湖边', lat: 30.5, lng: 114.1, photos: [photo('hubei-gps')] },
    { id: 'chengdu', place_name: '成都市', photos: [photo('chengdu')] },
  ]
  const result = atlasPhotos({ entries })
  expect(result.located[0].pinColor).toBe(result.located[1].pinColor)
  expect(result.located[0].pinColor).not.toBe(result.located[2].pinColor)
  render(<PlaceAtlas data={{ entries }} onOpen={() => {}} />)
  const pins = [...document.querySelectorAll('.j-atlas-pin')]
  expect(pins.map(pin => pin.style.getPropertyValue('--pin-color'))).toEqual(result.located.map(item => item.pinColor))
})

it('scatters photos with their proportions and rotation while reserving space between them', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ photo: photo('scatter' + i) }))
  const cards = layoutScatter(items, { scatter0: { width: 1200, height: 400 }, scatter1: { width: 400, height: 1200 } })
  expect(cards[0].width).toBeGreaterThan(cards[0].height)
  expect(cards[1].height).toBeGreaterThan(cards[1].width)
  expect(new Set(cards.map(card => card.rotation)).size).toBeGreaterThan(2)
  expect(new Set(cards.slice(0, 4).map(card => card.y)).size).toBeGreaterThan(2)
  for (let i = 0; i < cards.length; i++) for (const other of cards.slice(i + 1)) expect(intersects(cardBounds(cards[i], 12), cardBounds(other, 12))).toBe(false)
})

it('moves a photo near a requested point without colliding with a neighbour or the map', () => {
  const card = { x: 220, y: 90, width: 166, height: 172, rotation: 4 }
  const neighbour = { ...card, x: 440 }
  const position = settleAtlasPosition(card, [neighbour], { x: 440, y: 90 }, { width: 1100, height: 800 }, true)
  expect(intersects(cardBounds({ ...card, ...position }), cardBounds(neighbour))).toBe(false)
  expect(position).not.toEqual({ x: 440, y: 90 })
})

it('keeps every photo inside the board, outside the map and clear of every other photo', () => {
  const items = layoutAtlas(Array.from({ length: 12 }, (_, id) => ({ photo: photo(String(id)), point: { x: 550, y: 400 } })))
  expect(items).toHaveLength(12)
  for (const a of items) {
    expect(a.x - a.width / 2).toBeGreaterThanOrEqual(0)
    expect(a.x + a.width / 2).toBeLessThanOrEqual(1100)
    expect(a.y - a.height / 2).toBeGreaterThanOrEqual(0)
    expect(a.y + a.height / 2).toBeLessThanOrEqual(800)
    expect(Math.abs(a.x - 550) >= (a.width + 500) / 2 || Math.abs(a.y - 390) >= (a.height + 350) / 2).toBe(true)
    for (const b of items.filter(b => b !== a)) expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 12 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 12).toBe(true)
  }
})

it('opens the correct photo and exposes all photos when the ring fills up', () => {
  const onOpen = vi.fn()
  const entries = Array.from({ length: 14 }, (_, i) => ({ id: 'e' + i, place_name: '湖边', lat: 30, lng: 120, photos: [photo('p' + i)] }))
  render(<PlaceAtlas data={{ entries }} landmarks={[]} onOpen={onOpen} />)
  expect(document.querySelectorAll('.j-atlas-photo')).toHaveLength(12)
  fireEvent.click(screen.getByRole('button', { name: '打开照片：湖边 1' }))
  expect(onOpen).toHaveBeenCalledWith(entries[0], 'p0')
  fireEvent.click(screen.getByRole('button', { name: '下一组照片' }))
  expect(document.querySelectorAll('.j-atlas-photo')).toHaveLength(2)
  expect(screen.getByRole('button', { name: '打开照片：湖边 13' })).toBeInTheDocument()
})

it('jumps directly to a chosen zoom level and resets to fit', () => {
  render(<PlaceAtlas data={{ entries: [] }} onOpen={() => {}} />)
  const quickZoom = screen.getByRole('slider', { name: '快速缩放地点视图' })
  fireEvent.change(quickZoom, { target: { value: '175' } })
  expect(screen.getByText('175%')).toBeInTheDocument()
  expect(document.querySelector('.j-atlas-world').style.transform).toContain('scale(1.75)')
  fireEvent.click(screen.getByRole('button', { name: '适合窗口' }))
  expect(quickZoom).toHaveValue('100')
  expect(document.querySelector('.j-atlas-world').style.transform).toContain('scale(1)')
})

it('keeps photos at saved positions beyond the original board edges', () => {
  const items = [{ photo: photo('outside'), point: { x: 550, y: 400 } }]
  expect(layoutAtlas(items, { outside: { x: -1200, y: 1800 } })[0]).toMatchObject({ x: -1200, y: 1800 })
  expect(settleAtlasPosition({ width: 166, height: 172 }, [], { x: -2000, y: 3000 }, null, true)).toEqual({ x: -2000, y: 3000 })
})

it('zooms with the wheel over the map and keeps the page from scrolling', () => {
  render(<PlaceAtlas data={{ entries: [] }} onOpen={() => {}} />)
  const viewport = document.querySelector('.j-atlas-viewport')
  const zoomIn = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 300, clientY: 300 })
  fireEvent(viewport, zoomIn)
  expect(zoomIn.defaultPrevented).toBe(true)
  expect(screen.getByRole('slider', { name: '快速缩放地点视图' })).toHaveValue('110')
  fireEvent.wheel(viewport, { deltaY: 120, clientX: 300, clientY: 300 })
  expect(screen.getByText('100%')).toBeInTheDocument()
})

const explorationData = { entries: [
  { id: 'chengdu', place_name: '成都市', entry_date: '2026-10-02', photos: [photo('chengdu')] },
  ...Array.from({ length: 14 }, (_, i) => ({ id: `wuhan-${i}`, record_id: 'wuhan-record', place_name: '武汉市', entry_date: '2026-10-01', photos: [photo(`wuhan-${i}`)] })),
] }

it('focuses all photos at a pin across pages, dims other places, and restores the overview', () => {
  render(<PlaceAtlas data={explorationData} onOpen={() => {}} />)
  const pin = screen.getByRole('button', { name: '聚焦地点：武汉市 · 14 张照片' })
  fireEvent.click(pin)
  expect(document.querySelectorAll('.j-atlas-photo:not(.is-muted)')).toHaveLength(12)
  expect(document.querySelector('[data-atlas-photo="chengdu"]')).toHaveClass('is-muted')
  expect(screen.getByRole('complementary', { name: '武汉市的回忆' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一组照片' }))
  expect(document.querySelectorAll('.j-atlas-photo:not(.is-muted)')).toHaveLength(2)
  fireEvent.click(pin)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(document.querySelectorAll('.j-atlas-photo')).toHaveLength(12)
  expect(document.querySelectorAll('.j-atlas-photo.is-muted')).toHaveLength(0)
})

it('shows city counts when zoomed out and exposes photos when a city is selected', () => {
  render(<PlaceAtlas data={explorationData} onOpen={() => {}} />)
  fireEvent.change(screen.getByRole('slider', { name: '快速缩放地点视图' }), { target: { value: '60' } })
  expect(document.querySelectorAll('.j-atlas-photo')).toHaveLength(0)
  const city = screen.getByRole('button', { name: '聚焦城市：武汉市 · 14 张照片' })
  fireEvent.keyDown(city, { key: 'Enter' })
  expect(document.querySelectorAll('.j-atlas-photo:not(.is-muted)')).toHaveLength(12)
  expect(screen.getByText('100%')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回全景' }))
  expect(screen.getByText('60%')).toBeInTheDocument()
  expect(document.querySelectorAll('.j-atlas-photo')).toHaveLength(0)
})

it('lights visited provinces and opens their deduplicated visit statistics and photos', () => {
  const onOpen = vi.fn()
  render(<PlaceAtlas data={explorationData} onOpen={onOpen} />)
  const province = screen.getByRole('button', { name: '查看湖北省足迹，14 张照片' })
  expect(province).toHaveClass('is-visited')
  fireEvent.click(province)
  const panel = screen.getByRole('complementary', { name: '湖北省的回忆' })
  expect(within(panel).getByText('2026-10-01')).toBeInTheDocument()
  expect(within(panel).getByLabelText('到访次数')).toHaveTextContent('1')
  fireEvent.click(within(panel).getAllByRole('button', { name: /查看原片/ })[0])
  expect(onOpen).toHaveBeenCalledWith(explorationData.entries[1], 'wuhan-0')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('removes muted unlocated photos from keyboard navigation while a place is focused', () => {
  render(<PlaceAtlas data={{ entries: [...explorationData.entries, { id: 'loose', photos: [photo('loose')] }] }} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '聚焦地点：武汉市 · 14 张照片' }))
  expect(document.querySelector('.j-atlas-extras')).toHaveAttribute('inert')
  expect(screen.queryByRole('button', { name: '打开照片：旅行照片' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回全景' }))
  expect(screen.getByRole('button', { name: '打开照片：旅行照片' })).toBeInTheDocument()
})
