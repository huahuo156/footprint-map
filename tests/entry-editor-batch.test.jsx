import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EntryEditor from '../src/journal/EntryEditor'
import { readPhotoExif } from '../src/lib/exif'

vi.mock('../src/journal/Modal', () => ({ default: ({ children }) => <div role="dialog">{children}</div> }))
vi.mock('../src/journal/JournalImage', () => ({ default: ({ src, alt }) => <img src={src} alt={alt} /> }))
vi.mock('../src/lib/api', () => ({ fetchLandmarks: vi.fn(async () => []) }))
vi.mock('../src/lib/exif', async importOriginal => ({ ...(await importOriginal()), readPhotoExif: vi.fn(async () => null) }))

beforeEach(() => {
  readPhotoExif.mockReset().mockResolvedValue(null)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:photo-' + crypto.randomUUID() }
    static revokeObjectURL() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const upload = count => fireEvent.change(screen.getByLabelText('选择旅行照片'), { target: { files: Array.from({ length: count }, (_, i) => new File(['photo'], `photo-${i}.png`, { type: 'image/png' })) } })
function setup(entry) {
  const onSave = vi.fn(async () => {}), onCreateTrip = vi.fn(async () => ({ id: 'shared-trip' }))
  render(<EntryEditor entry={entry} trips={[]} onClose={vi.fn()} onSave={onSave} onCreateTrip={onCreateTrip} />)
  return { onSave, onCreateTrip }
}
async function save(onSave, editing = false) {
  await waitFor(() => expect(screen.getByRole('button', { name: editing ? '保存修改' : '留下', exact: true })).toBeEnabled())
  click(editing ? '保存修改' : '留下')
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  return JSON.parse(onSave.mock.calls[0][1].get('data'))
}

describe('upload batch metadata synchronization', () => {
  it('keeps each photo capture date and GPS when another component is edited or reordered', async () => {
    readPhotoExif.mockResolvedValueOnce({ date: '2024-05-01', lat: 30, lng: 120 })
      .mockResolvedValueOnce({ date: '2024-05-02', lat: 31, lng: 121 })
      .mockResolvedValueOnce({ date: '2024-05-03', lat: 32, lng: 122 })
    const { onSave } = setup()
    upload(2)
    await waitFor(() => expect(screen.getByLabelText('发生在')).toHaveValue('2024-05-01'))
    click('添加描述'); fill('想记住的事情', '共同描述')
    click('描述上移')
    click('选择第 2 张照片')
    expect(screen.getByLabelText('发生在')).toHaveValue('2024-05-02')
    upload(1)
    await waitFor(() => expect(screen.getByLabelText('发生在')).toHaveValue('2024-05-03'))
    const data = await save(onSave)
    expect(data.photos.map(p => p.components.find(c => c.type === 'date').value)).toEqual(['2024-05-01', '2024-05-02', '2024-05-03'])
    expect(data.photos.map(p => p.components.find(c => c.type === 'place').value.lat)).toEqual([30, 31, 32])
    expect(data.photos.every(p => p.components.some(c => c.type === 'description' && c.value === '共同描述'))).toBe(true)
  })
  it('inherits text before upload and synchronizes changes, order, removal and appended photos', async () => {
    const { onSave, onCreateTrip } = setup()
    click('添加描述'); fill('想记住的事情', '上传前的描述')
    upload(2)
    expect(screen.getByText('给这 2 张照片添点内容')).toBeInTheDocument()
    click('选择第 2 张照片')
    expect(screen.getByLabelText('想记住的事情')).toHaveValue('上传前的描述')
    fill('想记住的事情', '这一组共同的记忆')
    click('添加日期'); fill('发生在', '2026-05-01')
    click('添加地点'); fill('旅行地点', '西湖')
    click('添加旅程'); fill('放进哪段旅程', '__new__'); fill('旅程名称', '一起走过的旅程')
    click('添加心情'); click('☀ 开心'); click('心情上移')
    click('添加标题'); fill('手帐标题', '待移除')
    click('选择第 1 张照片')
    expect(screen.getByLabelText('手帐标题')).toHaveValue('待移除')
    expect(screen.getByLabelText('想记住的事情')).toHaveValue('这一组共同的记忆')
    click('移除标题')
    upload(1)
    expect(screen.getByLabelText('发生在')).toHaveValue('2026-05-01')
    expect(screen.queryByLabelText('手帐标题')).not.toBeInTheDocument()
    fill('想记住的事情', '追加后也同步')
    fireEvent.click(screen.getByText('调整照片')); click('黑白')
    const data = await save(onSave)
    expect(data.photos).toHaveLength(3)
    for (const photo of data.photos) expect(photo.components).toEqual([
      { type: 'description', value: '追加后也同步' },
      { type: 'date', value: '2026-05-01' },
      { type: 'place', value: { name: '西湖', landmark_id: null, lat: null, lng: null, spot_key: '' } },
      { type: 'mood', value: '开心' },
      { type: 'trip', value: 'shared-trip' },
    ])
    expect(onCreateTrip).toHaveBeenCalledTimes(1)
    expect(data.photos.map(photo => photo.image_filter)).toEqual(['original', 'original', 'mono'])
  })

  it('synchronizes new uploads without overwriting photos already saved', async () => {
    const original = [{ type: 'description', value: '原有照片内容' }]
    const { onSave } = setup({ id: 'record', entry_date: '2026-05-01', components: [], photos: [
      { id: 'old-one', url: '/one.png', components: original },
      { id: 'old-two', url: '/two.png', components: [] },
    ] })
    upload(2)
    fill('想记住的事情', '只同步这次新上传的两张')
    click('添加心情'); click('☀ 开心')
    const data = await save(onSave, true)
    expect(data.photos[0].components).toEqual(original)
    expect(data.photos[1].components).toEqual([])
    expect(data.photos[2].components).toEqual(data.photos[3].components)
    expect(data.photos[2].components).toEqual([{ type: 'description', value: '只同步这次新上传的两张' }, { type: 'mood', value: '开心' }])
  })
})
