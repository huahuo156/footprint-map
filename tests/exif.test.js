import { describe, it, expect } from 'vitest'
import { exifComponents, matchLandmark, readPhotoExif } from '../src/lib/exif'

// 组装一个最小的 JPEG：FFD8 + APP1(EXIF)。TIFF 为大端，含 ExifIFD 的拍摄日期和 GPS IFD。
import { buildExifJpeg } from './helpers/exifJpeg'

const file = (bytes, name, type) => new File([bytes], name, { type })

describe('photo exif autofill', () => {
  it('reads little-endian TIFF metadata used by phone cameras', async () => {
    const exif = await readPhotoExif(file(buildExifJpeg({ little: true }), 'phone.jpg', 'image/jpeg'))
    expect(exif).toEqual({ date: '2024-05-01', lat: 30.263889, lng: 120.15 })
  })
  it('finds EXIF after a JFIF segment, as in ordinary phone JPEGs', async () => {
    const jpeg = buildExifJpeg()
    const bytes = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xe0, 0, 4, 0x4a, 0x46, ...jpeg.slice(2)])
    expect((await readPhotoExif(file(bytes, 'jfif.jpg', 'image/jpeg')))?.date).toBe('2024-05-01')
  })

  it('discards impossible calendar dates and GPS with missing direction references', async () => {
    expect((await readPhotoExif(file(buildExifJpeg({ date: '2025:02:29 10:20:00', latRef: '', lngRef: '' }), 'bad.jpg', 'image/jpeg')))).toBeNull()
  })

  it('does not treat a zero GPS denominator as a valid coordinate', async () => {
    const exif = await readPhotoExif(file(buildExifJpeg({ latitude: [30, 0, 15, 1, 5000, 100] }), 'bad-gps.jpg', 'image/jpeg'))
    expect(exif).toEqual({ date: '2024-05-01', lat: null, lng: null })
  })
  it('reads the capture date and GPS coordinates from a JPEG', async () => {
    const exif = await readPhotoExif(file(buildExifJpeg(), 'lake.jpg', 'image/jpeg'))
    expect(exif.date).toBe('2024-05-01')
    expect(exif.lat).toBeCloseTo(30 + 15 / 60 + 50 / 3600, 5)
    expect(exif.lng).toBeCloseTo(120 + 9 / 60, 5)
  })

  it('negates southern and western coordinates and rejects invalid ones', async () => {
    const south = await readPhotoExif(file(buildExifJpeg({ latRef: 'S', lngRef: 'W' }), 'south.jpg', 'image/jpeg'))
    expect(south.lat).toBeLessThan(0)
    expect(south.lng).toBeLessThan(0)
    const gulf = await readPhotoExif(file(buildExifJpeg({ latitude: [0, 1, 0, 1, 0, 1], longitude: [0, 1, 0, 1, 0, 1] }), 'gulf.jpg', 'image/jpeg'))
    expect(gulf.lat).toBeNull()
    expect(gulf.lng).toBeNull()
  })

  it('returns nothing for PNG, WebP or JPEG without exif', async () => {
    expect(await readPhotoExif(file(new Uint8Array([137, 80, 78, 71]), 'photo.png', 'image/png'))).toBeNull()
    const plain = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02, 0x4A, 0x46])
    expect(await readPhotoExif(file(plain, 'plain.jpg', 'image/jpeg'))).toBeNull()
    expect(await readPhotoExif(null)).toBeNull()
  })

  it('matches nearby landmarks and builds date and place components', () => {
    const westLake = { id: 7, name: '西湖', lat: 30.2431, lng: 120.1514 }
    const far = { id: 8, name: '洱海', lat: 25.75, lng: 100.18 }
    expect(matchLandmark(30.25, 120.16, [far, westLake])).toBe(westLake)
    expect(matchLandmark(31.25, 121.16, [westLake])).toBeNull()
    const components = exifComponents({ date: '2024-05-01', lat: 30.25, lng: 120.16 }, [westLake])
    expect(components).toEqual([
      { type: 'date', value: '2024-05-01' },
      { type: 'place', value: { name: '西湖', landmark_id: 7, lat: 30.25, lng: 120.16, spot_key: '' } },
    ])
    expect(exifComponents(null)).toEqual([])
    expect(exifComponents({ date: null, lat: null, lng: null })).toEqual([])
  })
})
