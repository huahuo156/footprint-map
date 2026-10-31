import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CanvasOverviewMembers from '../src/journal/images/CanvasOverviewMembers.jsx'

beforeEach(() => {
  // jsdom does not implement the native dialog lifecycle.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)
it('lets every one of 2000 members be chosen through bounded image-free pages', () => {
  const members = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, label: `照片 ${i + 1}` }))
  const onChoose = vi.fn()
  render(<CanvasOverviewMembers members={members} onChoose={onChoose} onClose={() => {}} />)
  expect(document.querySelectorAll('[data-member-id]')).toHaveLength(50)
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('button', { name: '上一页' }).disabled).toBe(true)
  for (let page = 0; page < 40; page++) {
    const buttons = Array.from(document.querySelectorAll('[data-member-id]'))
    expect(buttons).toHaveLength(50)
    buttons.forEach((button, offset) => {
      expect(button.getAttribute('aria-label')).toBe(`打开：照片 ${page * 50 + offset + 1}`)
      fireEvent.click(button)
    })
    if (page < 39) fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  }
  expect(onChoose.mock.calls.map(([id]) => id)).toEqual(members.map(member => member.id))
  expect(screen.getByRole('button', { name: '下一页' }).disabled).toBe(true)
})

it('labels selection actions and closes using the existing modal', () => {
  const onChoose = vi.fn(), onClose = vi.fn()
  render(<CanvasOverviewMembers members={[{ id: 'a', label: '杭州' }]} selecting onChoose={onChoose} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: '选择：杭州' }))
  expect(onChoose).toHaveBeenCalledWith('a')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(onClose).toHaveBeenCalledOnce()
})
