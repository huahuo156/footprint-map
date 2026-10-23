import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotebookSettings from '../src/journal/NotebookSettings.jsx'
import { NOTEBOOK_COVERS } from '../shared/notebook-covers.js'
import { uploadNotebookCover, discardNotebookCover } from '../src/lib/api'
vi.mock('../src/lib/api', () => ({ uploadNotebookCover: vi.fn(async () => ({ url:'/uploads/cover-custom.jpg' })), discardNotebookCover: vi.fn(async () => ({})) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:cover'); static revokeObjectURL = vi.fn() })
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const data = { entries: [{ photos: [{ url: '/journal-demo/lake.jpg' }] }] }

it('creates a notebook with MEMO by default and preserves cover image with custom text', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<NotebookSettings data={data} position={{ x: 10, y: 20 }} onSave={onSave} onClose={() => {}} />)
  expect(screen.getByLabelText('封面字样')).toHaveValue('MEMO')
  fireEvent.change(screen.getByLabelText('手札名称'), { target: { value: ' 湖边 ' } })
  fireEvent.change(screen.getByLabelText('封面字样'), { target: { value: ' My memories ' } })
  fireEvent.change(screen.getByLabelText('封面寄语'), { target: { value: ' 留住那阵风 ' } })
  expect(screen.queryByRole('button', { name: '选择照片作为封面' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: NOTEBOOK_COVERS[0].name }))
  const preview = screen.getByLabelText('封面预览')
  expect(preview).toHaveTextContent('My memories')
  expect(preview).toHaveTextContent('留住那阵风')
  expect(preview.querySelector('img')).toHaveAttribute('src', NOTEBOOK_COVERS[0].url)
  fireEvent.click(screen.getByRole('button', { name: '保存手札' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(undefined, expect.objectContaining({ name: '湖边', cover_url: NOTEBOOK_COVERS[0].url, cover_mode:'photo', cover_label: 'My memories', cover_text: '留住那阵风', canvas_x: 10, canvas_y: 20 })))
})

it('can save a text-only cover without images from the existing user journal', async () => {
  const onSave=vi.fn(async()=>{})
  render(<NotebookSettings data={data} position={{x:0,y:0}} onSave={onSave} onClose={()=>{}} />)
  fireEvent.change(screen.getByLabelText('手札名称'),{target:{value:'碎碎念'}})
  fireEvent.click(screen.getByRole('tab',{name:'纯文字'}))
  expect(screen.getByLabelText('封面预览').querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'保存手札'}))
  await waitFor(()=>expect(onSave).toHaveBeenCalledWith(undefined,expect.objectContaining({cover_mode:'text',cover_url:null})))
})

it('lets presets be edited and blank labels saved without reintroducing MEMO', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<NotebookSettings book={{ id: 'b', name: '旧手札', cover_label: '', cover_text: '寄语' }} data={data} onSave={onSave} onClose={() => {}} />)
  expect(screen.getByLabelText('封面字样')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'JOURNAL', exact: true }))
  expect(screen.getByLabelText('封面字样')).toHaveValue('JOURNAL')
  fireEvent.change(screen.getByLabelText('封面字样'), { target: { value: '' } })
  expect(screen.getByLabelText('封面预览')).not.toHaveTextContent('MEMO')
  fireEvent.click(screen.getByRole('button', { name: '保存手札' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('b', expect.objectContaining({ cover_label: '', cover_text: '寄语' })))
})

it('uploads a custom cover on save and persists the server URL rather than its preview URL', async () => {
  const onSave = vi.fn(async () => {})
  render(<NotebookSettings book={{id:'b',name:'随笔'}} onSave={onSave} onClose={()=>{}} />)
  fireEvent.click(screen.getByRole('tab',{name:'自定义上传'}))
  const file = new File(['photo'], 'cover.jpg', {type:'image/jpeg'})
  fireEvent.change(screen.getByLabelText('上传封面图片'),{target:{files:[file]}})
  expect(uploadNotebookCover).not.toHaveBeenCalled()
  await waitFor(()=>expect(screen.getByLabelText('封面预览').querySelector('img')).toHaveAttribute('src','blob:cover'))
  fireEvent.click(screen.getByRole('button',{name:'保存手札'}))
  await waitFor(()=>expect(onSave).toHaveBeenCalledWith('b',expect.objectContaining({cover_mode:'photo',cover_url:'/uploads/cover-custom.jpg'})))
  expect(uploadNotebookCover).toHaveBeenCalledWith(file)
  expect(discardNotebookCover).not.toHaveBeenCalled()
})

it('discards a newly uploaded file when saving notebook metadata fails', async () => {
  render(<NotebookSettings book={{id:'b',name:'随笔'}} onSave={vi.fn(async()=>{throw new Error('保存失败')})} onClose={()=>{}} />)
  fireEvent.click(screen.getByRole('tab',{name:'自定义上传'}))
  fireEvent.change(screen.getByLabelText('上传封面图片'),{target:{files:[new File(['photo'],'cover.png',{type:'image/png'})]}})
  fireEvent.click(screen.getByRole('button',{name:'保存手札'}))
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('保存失败'))
  expect(discardNotebookCover).toHaveBeenCalledWith('/uploads/cover-custom.jpg')
})

it('retains an existing uploaded cover after visiting the built-in library', async () => {
  render(<NotebookSettings book={{id:'b',name:'随笔',cover_mode:'photo',cover_url:'/uploads/original.jpg'}} onClose={()=>{}} />)
  fireEvent.click(screen.getByRole('tab',{name:'内置摄影'}))
  fireEvent.click(screen.getByRole('tab',{name:'自定义上传'}))
  expect(screen.getByLabelText('封面预览').querySelector('img')).toHaveAttribute('src','/uploads/original.jpg')
})
