import { useState } from 'react'
import Modal from './Modal'
import EntryEditor from './EntryEditor'
import JournalImage from './JournalImage'

export default function BatchPhotoEditor({ photos, positions, onSave, onCreateTrip, trips, onClose }) {
  const [busy, setBusy] = useState(false)
  return <Modal title={`编辑 ${photos.length} 张照片`} onClose={onClose} busy={busy} className="j-entry-editor j-composer j-batch-editor">
    <div className="j-batch-preview">{photos.slice(0, 8).map(photo => <JournalImage key={photo.id} src={photo.url} alt="选中的照片" />)}{photos.length > 8 && <span>＋{photos.length - 8}</span>}</div>
    <EntryEditor embedded batchCount={photos.length} trips={trips} onSave={parts => onSave(photos.map(photo => photo.id), parts, positions)} onCreateTrip={onCreateTrip} onClose={onClose} onBusyChange={setBusy} />
  </Modal>
}
