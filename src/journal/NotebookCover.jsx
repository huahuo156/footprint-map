import JournalImage from './JournalImage'
import './notebook.css'

export default function NotebookCover({ book, pageCount }) {
  const label = book.cover_label ?? 'MEMO'
  const mode = book.cover_mode || (book.cover_url ? 'photo' : 'solid')
  const color = /^#[\da-f]{6}$/i.test(book.cover_color || '') ? book.cover_color : '#e3e9dd'
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  const dark = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 145
  return <span className="nb-cover-art" data-mode={mode} style={mode === 'solid' ? { backgroundColor: color, color: dark ? '#f6f4e9' : '#293a35' } : undefined}>
    {label && <small className="nb-cover-label">{label}</small>}
    {mode === 'photo' && book.cover_url && <JournalImage className="nb-cover-photo" src={book.cover_url} alt="手帐封面" />}
    <strong className="nb-cover-name">{book.name}</strong>
    {book.cover_text && <p className="nb-cover-text">{book.cover_text}</p>}
    {pageCount != null && <small className="nb-cover-pages">{pageCount} 页</small>}
  </span>
}
