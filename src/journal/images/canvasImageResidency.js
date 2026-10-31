const compareIds = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const intersects = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

/**
 * Pure residency recommendation, never a replacement for the full editable model.
 * Coordinates are centers; rotation is degrees; width/height (or w/h) are unrotated.
 * Groups accept the layout model's photo_ids, parent_id and child_group_ids.
 * Hidden/collapsed ancestors suppress descendant photos; cover proxies must be
 * supplied separately as kind:'photo' items by a future integration.
 * Overview bounds are world coordinates; zoomTarget is a complete camera.
 * selectedIds deliberately grants no residency privilege.
 */
export function planImageResidency({ items, groups = [], camera, viewport, profile = 'desktop', previousIds = [], focusId, dragIds = [], selectedIds: _selectedIds = [] }) {
  const conservative = profile !== 'desktop';
  const limits = conservative ? { images: 24, details: 60, prefetch: 4 } : { images: 48, details: 120, prefetch: 8 };
  const scale = camera.scale;
  if (!(scale > 0) || !Number.isFinite(scale) || !(viewport.width > 0) || !(viewport.height > 0)) {
    return { displayIds: [], detailIds: [], prefetchIds: [], overview: [], visibleIds: [] };
  }
  const previous = new Set(previousIds);
  const dragging = new Set(dragIds);
  const blockedGroups = new Set(groups.filter(g => g.hidden || g.collapsed).map(g => g.id));
  // Fixed-point traversal also terminates for malformed cyclic group graphs.
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (blockedGroups.has(group.parent_id) && !blockedGroups.has(group.id)) { blockedGroups.add(group.id); changed = true; }
      if (blockedGroups.has(group.id)) for (const id of group.child_group_ids || []) {
        if (!blockedGroups.has(id)) { blockedGroups.add(id); changed = true; }
      }
    }
  }
  const blockedPhotos = new Set(groups.filter(g => blockedGroups.has(g.id)).flatMap(g => g.photo_ids || []));
  const view = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  // Screen-space hysteresis and prefetch band; does not grow with zoom-out.
  const nearView = { left: -160, top: -160, right: viewport.width + 160, bottom: viewport.height + 160 };
  const candidates = [];
  const seen = new Set();
  for (const item of items) {
    if (item.hidden || blockedPhotos.has(item.id) || (item.kind && item.kind !== 'photo') || seen.has(item.id)) continue;
    seen.add(item.id);
    const w = item.width ?? item.w ?? 212;
    const h = item.height ?? item.h ?? 236;
    if (![item.x, item.y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const angle = (item.rotation || 0) * Math.PI / 180;
    const hw = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
    const hh = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2;
    const sx = viewport.width / 2 + (camera.x || 0) + item.x * scale;
    const sy = viewport.height / 2 + (camera.y || 0) + item.y * scale;
    const screen = { left: sx - hw * scale, right: sx + hw * scale, top: sy - hh * scale, bottom: sy + hh * scale };
    const visible = intersects(screen, view);
    const near = intersects(screen, nearView);
    const interactive = item.id === focusId || dragging.has(item.id);
    const retained = interactive && previous.has(item.id);
    if (!near && !retained) continue;
    candidates.push({ id: item.id, hasImage: item.hasImage !== false, priority: Number.isFinite(item.priority) ? item.priority : 0, visible, near, interactive, retained, tiny: Math.min(w, h) * scale < 36, sx, sy,
      bounds: { left: item.x - hw, right: item.x + hw, top: item.y - hh, bottom: item.y + hh },
      distance: (sx - viewport.width / 2) ** 2 + (sy - viewport.height / 2) ** 2 });
  }
  candidates.sort((a, b) => Number(b.interactive) - Number(a.interactive) || b.priority - a.priority || Number(b.visible) - Number(a.visible) || Number(previous.has(b.id)) - Number(previous.has(a.id)) || a.distance - b.distance || compareIds(a.id, b.id));
  const detailed = candidates.filter(c => (c.visible || c.retained || (c.interactive && c.near)) && (!c.tiny || c.interactive)).slice(0, limits.details);
  const detailIds = detailed.map(c => c.id);
  const detailSet = new Set(detailIds);
  const displayIds = detailed.filter(c => c.hasImage).slice(0, limits.images).map(c => c.id);
  const prefetchIds = candidates.filter(c => c.hasImage && !c.visible && !c.tiny && !detailSet.has(c.id) && c.near).slice(0, limits.prefetch).map(c => c.id);
  const cells = new Map();
  for (const c of candidates.filter(c => c.visible && !detailSet.has(c.id)).sort((a, b) => compareIds(a.id, b.id))) {
    const column = Math.floor(c.sx / 160), row = Math.floor(c.sy / 160);
    const id = `overview:${column}:${row}`;
    let cell = cells.get(id);
    if (!cell) { cell = { id, column, row, ids: [], count: 0, bounds: { ...c.bounds } }; cells.set(id, cell); }
    cell.ids.push(c.id); cell.count++;
    cell.bounds.left = Math.min(cell.bounds.left, c.bounds.left);
    cell.bounds.top = Math.min(cell.bounds.top, c.bounds.top);
    cell.bounds.right = Math.max(cell.bounds.right, c.bounds.right);
    cell.bounds.bottom = Math.max(cell.bounds.bottom, c.bounds.bottom);
  }
  const overview = [...cells.values()].sort((a, b) => a.row - b.row || a.column - b.column).map(cell => {
    const b = cell.bounds;
    const targetScale = Math.max(scale * 2, Math.min(viewport.width / (b.right - b.left), viewport.height / (b.bottom - b.top)) * 0.8);
    return { ...cell, zoomTarget: { x: -(b.left + b.right) / 2 * targetScale, y: -(b.top + b.bottom) / 2 * targetScale, scale: targetScale } };
  });
  return { displayIds, detailIds, prefetchIds, overview, visibleIds: candidates.filter(c => c.visible).map(c => c.id).sort(compareIds) };
}
