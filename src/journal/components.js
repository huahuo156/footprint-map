import { legacyComponents } from '../../shared/journal-components.js'
export { legacyComponents, hasComponentContent } from '../../shared/journal-components.js'
export const COMPONENT_TYPES = ['date', 'place', 'trip', 'description', 'mood', 'title']
export const COMPONENT_LABELS = { date: '日期', place: '地点', trip: '旅程', description: '描述', mood: '心情', title: '标题' }
export const componentValue = (components, type) => components?.find(component => component.type === type)?.value
export const photoComponents = (photo, entry) => structuredClone(photo?.components ?? entry?.components ?? (entry ? legacyComponents(entry) : []))
function composedEntry(record, components, photo) {
  const place = componentValue(components, 'place')
  return { ...record, id: photo ? record.id + ':' + photo.id : record.id, record_id: record.id, components, trip_id: componentValue(components, 'trip') || null, entry_date: componentValue(components, 'date') || record.captured_on || record.entry_date, date_visible: !!componentValue(components, 'date'), title: componentValue(components, 'title') || '', caption: componentValue(components, 'description') || '', place_name: place?.name || '', landmark_id: place?.landmark_id ?? null, lat: place?.lat ?? null, lng: place?.lng ?? null, spot_key: place?.spot_key || '', mood: componentValue(components, 'mood') || null, photos: photo ? [photo] : [] }
}
export function materializeJournal(data) {
  const entries = []
  for (const record of data.entries) {
    if (!record.photos.length) { entries.push(record.components == null ? record : composedEntry(record, record.components)); continue }
    const legacy = record.photos.filter(photo => photo.components == null)
    if (legacy.length) entries.push({ ...record, photos: legacy })
    for (const photo of record.photos.filter(photo => photo.components != null)) entries.push(composedEntry(record, photo.components, photo))
  }
  for (const mark of data.marks || []) entries.push({ id: mark.id, mark, entry_date: mark.captured_on, trip_id: null, photos: [], caption: mark.text || '', place_name: '' })
  return { ...data, entries }
}
