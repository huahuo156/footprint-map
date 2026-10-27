import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlaceSearch from '../src/journal/PlaceSearch'
import EntryEditor from '../src/journal/EntryEditor'
import { searchPlaces } from '../src/lib/api'
vi.mock('../src/lib/api', () => ({ searchPlaces: vi.fn(), fetchLandmarks: vi.fn(async () => []) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('offers addresses and selects coordinates without submitting its parent form', async () => {
  searchPlaces.mockResolvedValue({ places: [{ id: 'school', name: '中南民族大学', address: '武汉市洪山区民族大道182号', lat: 30.49, lng: 114.39 }] })
  const onChange = vi.fn(), submit = vi.fn(event => event.preventDefault())
  render(<form onSubmit={submit}><PlaceSearch value={{ name: '' }} landmarks={[]} onChange={onChange} /></form>)
  fireEvent.change(screen.getByLabelText('旅行地点'), { target: { value: '中南民族' } })
  expect(await screen.findByText('武汉市洪山区民族大道182号')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByLabelText('旅行地点'), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByLabelText('旅行地点'), { key: 'Enter' })
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: '中南民族大学', lat: 30.49, lng: 114.39, address: '武汉市洪山区民族大道182号', poi_id: 'school', provider: 'amap' }))
  expect(submit).not.toHaveBeenCalled()
})
it('allows manual text and local places when remote search fails', async () => {
  searchPlaces.mockRejectedValue(new Error('在线地点搜索暂时不可用'))
  const onChange = vi.fn()
  render(<PlaceSearch value={{ name: '' }} landmarks={[{ id: 7, name: '西湖', lat: 30.25, lng: 120.15 }]} onChange={onChange} />)
  fireEvent.change(screen.getByLabelText('旅行地点'), { target: { value: '西湖' } })
  await waitFor(() => expect(screen.getByText(/在线地点搜索暂时不可用/)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('option', { name: /西湖/ }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ landmark_id: 7, lat: 30.25, lng: 120.15 }))
})

it('saves the selected place on the edited photo while preserving its neighbour', async () => {
  searchPlaces.mockResolvedValue({ places: [{ id: 'school', name: '中南民族大学', address: '武汉市洪山区民族大道182号', lat: 30.49, lng: 114.39 }] })
  const onSave = vi.fn(async () => {})
  const other = { type: 'place', value: { name: '旧地点', lat: 39, lng: 116 } }
  render(<EntryEditor embedded entry={{ id: 'record', entry_date: '2026-10-26', photos: [{ id: 'a', url: '/a.jpg', components: [{ type: 'place', value: { name: '' } }] }, { id: 'b', url: '/b.jpg', components: [other] }] }} trips={[]} onSave={onSave} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('旅行地点'), { target: { value: '中南民族' } })
  fireEvent.click(await screen.findByRole('option', { name: /中南民族大学/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存修改', exact: true }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  const data = JSON.parse(onSave.mock.calls[0][1].get('data'))
  expect(data.photos[0].components[0].value).toMatchObject({ name: '中南民族大学', lat: 30.49, lng: 114.39, address: '武汉市洪山区民族大道182号' })
  expect(data.photos[1].components).toEqual([other])
})
