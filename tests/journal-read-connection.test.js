import { expect, it, vi } from 'vitest'
import { readJournal, readJournalSnapshot } from '../server/read-journal.js'

function reader() {
  return vi.fn(async (sql, args) => {
    expect(args).toEqual(['owner'])
    expect(sql).toContain('owner_id')
    if (sql.includes('FROM journal_trips')) return [[{ id: 'trip' }]]
    if (sql.includes('FROM journal_entries WHERE')) return [[{ id: 'entry', layout_version: '9007199254740993' }]]
    if (sql.includes('FROM journal_photos WHERE')) return [[{ id: 'photo', entry_id: 'entry', layout_version: '9007199254740994' }]]
    if (sql.includes('FROM journal_marks WHERE')) return [[{ id: 'mark', layout_version: '0' }]]
    if (sql.includes('FROM journal_canvas_groups WHERE')) return [[{ id: 'inner' }, { id: 'outer' }]]
    if (sql.includes('FROM journal_canvas_group_photos')) return [[{ photo_id: 'photo', group_id: 'inner' }]]
    if (sql.includes('FROM journal_canvas_group_children')) return [[{ child_id: 'inner', parent_id: 'outer' }]]
    if (sql.includes('FROM journal_notebooks WHERE')) return [[{ id: 'book', cover_url: null }]]
    if (sql.includes('FROM journal_notebook_pages')) return [[{ id: 'page', notebook_id: 'book' }]]
    if (sql.includes('FROM journal_notebook_photo_items')) return [[{ id: 'photo', page_id: 'page' }]]
    return [[]]
  })
}

it('reads all journal and notebook parts through the supplied owner-scoped connection', async () => {
  const query = reader(), data = await readJournal({ query }, 'owner')
  expect(query).toHaveBeenCalledTimes(12)
  expect(data.entries[0].photos[0].id).toBe('photo')
  expect(data.canvas_groups.find(group => group.id === 'outer').photo_ids).toEqual(['photo'])
  expect(data.canvas_groups.find(group => group.id === 'inner').parent_id).toBe('outer')
  expect(data.notebooks[0]).toMatchObject({ id: 'book', cover_label: 'MEMO', cover_mode: 'solid' })
  expect(data.notebook_items).toEqual([{ id: 'photo', page_id: 'page', kind: 'photo' }])
  expect(query.mock.calls.some(([sql]) => sql.includes('CAST(layout_version'))).toBe(false)
})

it('uses a single read-only transaction for the entire versioned journal', async () => {
  const query = reader()
  const connection = { query: vi.fn(async (...args) => args[0].startsWith('SELECT') ? query(...args) : []), execute: vi.fn(async () => [[{ structure_version: '9007199254740995' }]]), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  const database = { getConnection: vi.fn(async () => connection), query: () => { throw new Error('global pool forbidden') } }
  const data = await readJournalSnapshot(database, 'owner')
  expect(query).toHaveBeenCalledTimes(12)
  expect(query.mock.calls.filter(([sql]) => sql.includes('CAST(layout_version AS CHAR) AS layout_version'))).toHaveLength(3)
  expect(data.structure_version).toBe('9007199254740995')
  expect(data.entries[0].layout_version).toBe('9007199254740993')
  expect(connection.commit).toHaveBeenCalledOnce()
  expect(connection.release).toHaveBeenCalledOnce()
})

it('does not return partial journal data if a nested notebook read fails', async () => {
  const query = reader()
  await expect(readJournal({ query: (sql, args) => {
    if (sql.includes('FROM journal_notebook_mark_items')) throw new Error('notebook unavailable')
    return query(sql, args)
  } }, 'owner')).rejects.toThrow('notebook unavailable')
})
