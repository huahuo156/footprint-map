// photo_ids includes descendants; direct_photo_ids records unique photo ownership.
export function expandCanvasGroups(groups) {
  const byId = new Map(groups.map(group => [group.id, { ...group, direct_photo_ids: group.direct_photo_ids || group.photo_ids || [], child_group_ids: [] }]))
  for (const group of byId.values()) {
    group.parent_id = byId.has(group.parent_id) ? group.parent_id : null
    if (group.parent_id) byId.get(group.parent_id).child_group_ids.push(group.id)
  }
  const visiting = new Set(), done = new Set()
  function visit(group) {
    if (done.has(group.id)) return
    if (visiting.has(group.id)) throw new Error('色块分组存在循环')
    visiting.add(group.id)
    const photos = new Set(group.direct_photo_ids)
    for (const childId of group.child_group_ids) {
      const child = byId.get(childId)
      visit(child)
      for (const id of child.photo_ids) photos.add(id)
    }
    group.photo_ids = [...photos]
    visiting.delete(group.id); done.add(group.id)
  }
  for (const group of byId.values()) visit(group)
  for (const group of byId.values()) {
    let parent = byId.get(group.parent_id), depth = 0
    while (parent) { depth++; parent = byId.get(parent.parent_id) }
    group.depth = depth
  }
  return [...byId.values()]
}

function selectionUnit(id, groups) {
  return groups.find(group => !group.parent_id && group.photo_ids.includes(id))?.photo_ids || [id]
}
export function expandGroupSelection(ids, groups, limit = 500) {
  const selected = new Set()
  for (const id of ids) {
    if (selected.has(id)) continue
    const unit = selectionUnit(id, groups)
    if (selected.size + unit.filter(item => !selected.has(item)).length > limit) continue
    for (const item of unit) selected.add(item)
  }
  return selected
}
export function toggleGroupSelection(selected, id, groups, limit = 500) {
  const unit = selectionUnit(id, groups), next = new Set(selected)
  if (unit.every(item => next.has(item))) for (const item of unit) next.delete(item)
  else if (next.size + unit.filter(item => !next.has(item)).length <= limit) for (const item of unit) next.add(item)
  return next
}
