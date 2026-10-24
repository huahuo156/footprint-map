import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import NotebookCover from '../src/journal/NotebookCover.jsx'

afterEach(cleanup)
it('gives existing notebooks a MEMO label and renders cover contents inside one external button', () => {
  render(<button><NotebookCover book={{ name: '旧手帐', cover_url: '/journal-demo/lake.jpg', cover_text: '一路有风' }} pageCount={4} /></button>)
  expect(screen.getByText('MEMO')).toBeInTheDocument()
  expect(screen.getByText('一路有风')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '手帐封面' })).toHaveAttribute('src', '/journal-demo/lake.jpg')
  expect(screen.getByText('4 页')).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(1)
})
it('hides an explicitly cleared label while retaining custom wording and a plain cover', () => {
  const { rerender } = render(<NotebookCover book={{ name: '随笔', cover_label: '', cover_text: '寄语' }} />)
  expect(screen.queryByText('MEMO')).not.toBeInTheDocument()
  expect(screen.getByText('寄语')).toBeInTheDocument()
  rerender(<NotebookCover book={{ name: '随笔', cover_label: 'My story' }} />)
  expect(screen.getByText('My story')).toBeInTheDocument()
  expect(screen.queryByText('MEMO')).not.toBeInTheDocument()
})
