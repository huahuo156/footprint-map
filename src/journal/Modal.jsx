import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function Modal({ children, title, onClose, className = '', busy = false }) {
  const ref = useRef(null), closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(<dialog ref={ref} className={'journal-modal ' + className} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) closeRef.current() }} onClick={event => { if (event.target === event.currentTarget && !busy) closeRef.current() }}>
    <div className="journal-modal-surface">
      <header className="journal-modal-heading"><h2>{title}</h2><button type="button" className="j-icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button></header>
      {children}
    </div>
  </dialog>, document.body)
}
