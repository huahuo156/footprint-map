export function legacyComponents(entry) {
  const list = []
  if (entry.title) list.push({ type: 'title', value: entry.title })
  if (entry.entry_date) list.push({ type: 'date', value: entry.entry_date })
  if (entry.place_name || entry.lat != null) list.push({ type: 'place', value: { name: entry.place_name || '', lat: entry.lat ?? null, lng: entry.lng ?? null, landmark_id: entry.landmark_id ?? null, spot_key: entry.spot_key || '' } })
  if (entry.trip_id) list.push({ type: 'trip', value: entry.trip_id })
  if (entry.caption) list.push({ type: 'description', value: entry.caption })
  if (entry.mood) list.push({ type: 'mood', value: entry.mood })
  return list
}
export function hasComponentContent(component) {
  return component.type === 'place' ? !!(component.value?.name || component.value?.lat != null) : !!component.value
}
export function patchComponents(original, updates) {
  const types = new Set(updates.map(part => part.type)), replacements = new Map(updates.filter(hasComponentContent).map(part => [part.type, part]))
  const result = original.flatMap(part => {
    if (!types.has(part.type)) return [part]
    const replacement = replacements.get(part.type)
    replacements.delete(part.type)
    return replacement ? [replacement] : []
  })
  return [...result, ...replacements.values()]
}
