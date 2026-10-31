import { provinceShapes } from './atlasGeography'

function activation(onActivate) {
  return {
    role: 'button', tabIndex: 0,
    onPointerDown: event => event.stopPropagation(),
    onClick: onActivate,
    onKeyDown: event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate() }
    },
  }
}

function cityLabels(groups, scale) {
  const placed = [], unit = 1 / Math.max(.2, scale)
  return groups.map(group => {
    const width = Math.max(86, group.name.length * 12 + 46) * unit, height = 34 * unit
    let point = group.point
    for (let step = 0; step < 160; step++) {
      const angle = step * 2.399963, radius = Math.sqrt(step) * 24 * unit
      point = { x: group.point.x + Math.cos(angle) * radius, y: group.point.y + Math.sin(angle) * radius }
      if (!placed.some(other => Math.abs(point.x - other.x) < (width + other.width) / 2 + 6 * unit && Math.abs(point.y - other.y) < height + 6 * unit)) break
    }
    placed.push({ ...point, width })
    return { ...group, labelPoint: point, labelWidth: width / unit, unit }
  })
}

export default function AtlasMapLayers({ insights, groups = [], selected, active, compact, scale, onSelect, children, layer = 'all', projectPoint = point => point }) {
  const visited = new Map(insights.provinces.map(province => [province.code, province]))
  const selectedIds = selected ? new Set(selected.items.map(item => item.photo.id)) : null
  const projectedGroups = groups.map(group => ({ ...group, point: projectPoint(group.point), source: group }))
  return <>
    {layer !== 'pins' && <g className="j-atlas-provinces">
      {provinceShapes.map(province => {
        const group = visited.get(province.code), chosen = selected?.kind === 'province' && selected.code === province.code
        return <path key={province.code} d={province.path} data-province={province.code} className={'j-atlas-province' + (group ? ' is-visited' : '') + (chosen ? ' is-selected' : '')} style={{ '--province-color': province.pinColor }}
          {...(group ? { ...activation(() => onSelect(group)), 'aria-label': `查看${province.name}足迹，${group.count} 张照片`, 'aria-pressed': chosen } : {})}>
          <title>{province.name}{group ? ` · ${group.count} 张照片 · ${group.visits} 次到访` : ' · 尚无照片'}</title>
        </path>
      })}
    </g>}
    {layer !== 'provinces' && children}
    {layer !== 'provinces' && (compact ? cityLabels(projectedGroups, scale).map(group => <g key={group.id} className="j-atlas-city-cluster">
      <path className="j-atlas-cluster-leader" d={`M${group.point.x},${group.point.y} L${group.labelPoint.x},${group.labelPoint.y}`} />
      <g {...activation(() => onSelect(group.source))} aria-label={`聚焦城市：${group.name} · ${group.count} 张照片`} aria-pressed={false} className="j-atlas-city-button" transform={`translate(${group.labelPoint.x},${group.labelPoint.y}) scale(${group.unit})`} style={{ '--pin-color': group.pinColor }}>
        <rect x={-group.labelWidth / 2} y="-15" width={group.labelWidth} height="30" rx="4" />
        <circle cx={-group.labelWidth / 2 + 16} r="9" />
        <text className="j-atlas-city-count" x={-group.labelWidth / 2 + 16} y="3.5">{group.count}</text>
        <text className="j-atlas-city-name" x={-group.labelWidth / 2 + 31} y="3.5">{group.name}</text>
      </g>
    </g>) : projectedGroups.map(group => {
      const chosen = selected?.id === group.id && selected?.kind === group.kind
      const highlighted = chosen || group.items.some(item => item.photo.id === active)
      const muted = selectedIds && !group.items.some(item => selectedIds.has(item.photo.id))
      return <g key={group.id} {...activation(() => onSelect(group.source))} aria-label={`聚焦地点：${group.name} · ${group.count} 张照片`} aria-pressed={chosen}
        className={'j-atlas-pin' + (highlighted ? ' is-active' : '') + (muted ? ' is-muted' : '')} style={{ '--pin-color': group.pinColor }} transform={`translate(${group.point.x},${group.point.y})`}>
        <title>{group.name} · {group.count} 张照片 · 点击聚焦，再次点击返回全景</title>
        <path d="M0 0 C-3 -5 -10 -10 -10 -17 A10 10 0 1 1 10 -17 C10 -10 3 -5 0 0Z" />
        {group.count > 1 ? <text className="j-atlas-pin-count" y="-13.5">{group.count}</text> : <circle cy="-17" r="3" />}
        <g className="j-atlas-pin-label"><rect x="15" y="-31" width={group.name.length * 11 + 16} height="24" rx="3" /><text x="23" y="-15">{group.name}</text></g>
      </g>
    }))}
  </>
}
