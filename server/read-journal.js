import { expandCanvasGroups } from '../shared/journal-groups.js'
import { readNotebookData } from './read-notebooks.js'
import { readLayoutSnapshot } from './layout-session.js'

export async function readJournal(database, ownerId, { versioned = false } = {}) {
  const [trips] = await database.query('SELECT id,name,region,color,canvas_x,canvas_y FROM journal_trips WHERE owner_id=? ORDER BY created_at,id', [ownerId])
  const [entries] = await database.query((versioned ? 'SELECT *, CAST(layout_version AS CHAR) AS layout_version' : 'SELECT *') + ", DATE_FORMAT(entry_date,'%Y-%m-%d') AS entry_date, DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_entries WHERE owner_id=? ORDER BY entry_date DESC,created_at DESC,id", [ownerId])
  const [photos] = await database.query((versioned ? 'SELECT *, CAST(layout_version AS CHAR) AS layout_version' : 'SELECT *') + ' FROM journal_photos WHERE EXISTS (SELECT 1 FROM journal_entries owner_entry WHERE owner_entry.id=journal_photos.entry_id AND owner_entry.owner_id=?) ORDER BY sort_order,id', [ownerId])
  const grouped = new Map()
  for (const photo of photos) {
    if (!grouped.has(photo.entry_id)) grouped.set(photo.entry_id, [])
    grouped.get(photo.entry_id).push(photo)
  }
  const [marks] = await database.query((versioned ? 'SELECT *, CAST(layout_version AS CHAR) AS layout_version' : 'SELECT *') + ", DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_marks WHERE owner_id=? ORDER BY created_at,id", [ownerId])
  const [canvasGroups] = await database.query('SELECT * FROM journal_canvas_groups WHERE owner_id=? ORDER BY created_at,id', [ownerId])
  const [members] = await database.query('SELECT photo_id,group_id FROM journal_canvas_group_photos WHERE EXISTS (SELECT 1 FROM journal_canvas_groups g WHERE g.id=journal_canvas_group_photos.group_id AND g.owner_id=? AND EXISTS (SELECT 1 FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE p.id=journal_canvas_group_photos.photo_id AND e.owner_id=g.owner_id)) ORDER BY photo_id', [ownerId])
  const [children] = await database.query('SELECT child_id,parent_id FROM journal_canvas_group_children WHERE EXISTS (SELECT 1 FROM journal_canvas_groups g WHERE g.id=journal_canvas_group_children.parent_id AND g.owner_id=? AND EXISTS (SELECT 1 FROM journal_canvas_groups c WHERE c.id=journal_canvas_group_children.child_id AND c.owner_id=g.owner_id))', [ownerId])
  const parents = new Map(children.map(child => [child.child_id, child.parent_id]))
  return { ...await readNotebookData(database, ownerId), trips, entries: entries.map(entry => ({ ...entry, photos: grouped.get(entry.id) || [] })), marks, canvas_groups: expandCanvasGroups(canvasGroups.map(group => ({ ...group, parent_id: parents.get(group.id), photo_ids: members.filter(member => member.group_id === group.id).map(member => member.photo_id) }))) }
}

export function readJournalSnapshot(database, ownerId) {
  return readLayoutSnapshot(database, ownerId, (connection, owner) => readJournal(connection, owner, { versioned: true }))
}
