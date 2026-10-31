const tables = { photo: 'journal_photos', mark: 'journal_marks', entry: 'journal_entries' }

export async function readNotebookData(database, ownerId) {
  const [notebooks] = await database.query(
    'SELECT id,name,cover_url,cover_label,cover_text,cover_mode,cover_color,bookmark_page_id,last_read_page_id,canvas_x,canvas_y,rotation FROM journal_notebooks WHERE owner_id=? ORDER BY created_at,id', [ownerId]
  )
  const [notebook_pages] = await database.query(
    'SELECT p.* FROM journal_notebook_pages p JOIN journal_notebooks b ON b.id=p.notebook_id WHERE b.owner_id=? ORDER BY p.notebook_id,p.sort_order,p.id', [ownerId]
  )
  const notebook_items = []
  for (const kind of Object.keys(tables)) {
    const [rows] = await database.query(`SELECT i.* FROM journal_notebook_${kind}_items i JOIN journal_notebook_pages p ON p.id=i.page_id JOIN journal_notebooks b ON b.id=p.notebook_id JOIN ${tables[kind]} s ON s.id=i.id ${kind === 'photo' ? 'JOIN journal_entries e ON e.id=s.entry_id' : ''} WHERE b.owner_id=? AND ${kind === 'photo' ? 'e' : 's'}.owner_id=b.owner_id ORDER BY i.id`, [ownerId])
    notebook_items.push(...rows.map((r) => ({ ...r, kind })))
  }
  return { notebooks: notebooks.map(book => ({ ...book, cover_label: book.cover_label ?? 'MEMO', cover_text: book.cover_text ?? '', cover_mode: book.cover_mode ?? (book.cover_url ? 'photo' : 'solid'), cover_color: book.cover_color ?? '#e3e9dd' })), notebook_pages, notebook_items }
}
