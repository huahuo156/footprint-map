import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { timeAgo, formatCount, truncate, getPublicUrl, randomFilename } from '../src/lib/utils'

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns "刚刚" for less than 60 seconds', () => {
    expect(timeAgo('2026-08-27T11:59:30Z')).toBe('刚刚')
  })

  it('returns minutes for < 60 minutes', () => {
    expect(timeAgo('2026-08-27T11:55:00Z')).toBe('5分钟前')
  })

  it('returns hours for < 24 hours', () => {
    expect(timeAgo('2026-08-27T09:00:00Z')).toBe('3小时前')
  })

  it('returns days for < 30 days', () => {
    expect(timeAgo('2026-08-24T12:00:00Z')).toBe('3天前')
  })
})

describe('formatCount', () => {
  it('returns plain number for < 1000', () => {
    expect(formatCount(42)).toBe('42')
  })

  it('returns k format for >= 1000', () => {
    expect(formatCount(1200)).toBe('1.2k')
  })

  it('returns 万 format for >= 10000', () => {
    expect(formatCount(15000)).toBe('1.5万')
  })
})

describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates and adds ellipsis if over limit', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
  })

  it('returns undefined/null as-is', () => {
    expect(truncate(null)).toBeNull()
    expect(truncate(undefined)).toBeUndefined()
  })
})

describe('getPublicUrl', () => {
  it('constructs local upload URL', () => {
    const url = getPublicUrl('checkin-images', 'abc/photo.jpg')
    expect(url).toBe('/uploads/abc/photo.jpg')
  })
  it('preserves API image paths', () => {
    expect(getPublicUrl('checkin-images', '/uploads/photo.jpg')).toBe('/uploads/photo.jpg')
  })
})

describe('randomFilename', () => {
  it('preserves file extension', () => {
    const result = randomFilename('photo.jpg')
    expect(result).toMatch(/\.jpg$/)
  })

  it('generates unique names', () => {
    const a = randomFilename('test.png')
    const b = randomFilename('test.png')
    expect(a).not.toBe(b)
  })
})
