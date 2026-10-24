import { describe, it, expect } from 'vitest'
import { legacyComponents, materializeJournal } from '../src/journal/components'
import { buildCanvas } from '../src/journal/model'

describe('independent photo components', () => {
  const record = { id: 'record', trip_id: 'trip', entry_date: '2026-10-15', captured_on: '2026-10-15', caption: '旧描述', mood: '平静' }
  it('keeps a bare photo free of inferred trip, description and mood', () => {
    const { entries } = materializeJournal({ trips: [], entries: [{ ...record, photos: [{ id: 'p', components: [] }] }] })
    expect(entries[0]).toMatchObject({ trip_id: null, caption: '', mood: null, components: [], entry_date: '2026-10-15' })
    expect(buildCanvas({ trips: [], entries }).items).toHaveLength(1)
  })
  it('respects each photo’s component values and order without leaking to its neighbor', () => {
    const first = [{ type: 'mood', value: '开心' }, { type: 'description', value: '只属于第一张' }, { type: 'date', value: '2026-05-01' }]
    const second = [{ type: 'place', value: { name: '西湖', spot_key: 'bridge' } }, { type: 'trip', value: 'trip' }]
    const { entries } = materializeJournal({ trips: [{ id: 'trip' }], entries: [{ ...record, photos: [{ id: 'a', components: first }, { id: 'b', components: second }] }] })
    expect(entries[0].components.map(part => part.type)).toEqual(['mood', 'description', 'date'])
    expect(entries[0]).toMatchObject({ caption: '只属于第一张', entry_date: '2026-05-01', trip_id: null })
    expect(entries[1]).toMatchObject({ caption: '', place_name: '西湖', mood: null, entry_date: '2026-10-15', trip_id: 'trip' })
    expect(entries.every(entry => entry.record_id === 'record')).toBe(true)
  })
  it('leaves existing records intact and can infer their components for editing', () => {
    const legacy = { ...record, photos: [{ id: 'old', components: null }] }
    expect(materializeJournal({ trips: [], entries: [legacy] }).entries[0]).toEqual(legacy)
    expect(legacyComponents(legacy).find(part => part.type === 'description')?.value).toBe('旧描述')
  })
})
