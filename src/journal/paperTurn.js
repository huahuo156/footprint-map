// Deform snapshots of the actual shared page DOM; the turn never owns or edits content.
export function createPaperTurn(host, frontSource, backSource, direction, softness = 1.1) {
  const width = host.clientWidth / 2, height = host.clientHeight
  const columns = 24, rows = 10, dx = width / columns, dy = height / rows
  const leaf = document.createElement('div')
  leaf.className = 'nb-turn-leaf'; leaf.setAttribute('aria-hidden', 'true'); leaf.inert = true
  const cells = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const cell = document.createElement('div'); cell.className = 'nb-turn-cell'
    cell.style.width = dx + 1.4 + 'px'; cell.style.height = dy + 1.4 + 'px'
    const shades = []
    for (const [side, source, offset] of [['front', frontSource, i], ['back', backSource, columns - i - 1]]) {
      const face = document.createElement('div'); face.className = 'nb-turn-face ' + side
      const copy = source.cloneNode(true); copy.className = 'nb-turn-copy nb-paper'
      copy.removeAttribute('data-notebook-page'); copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
      copy.style.width = width + 'px'; copy.style.height = height + 'px'
      copy.style.left = -offset * dx + 'px'; copy.style.top = -j * dy + 'px'
      const shade = document.createElement('div'); shade.className = 'nb-turn-shade'; shades.push(shade)
      face.append(copy, shade); cell.append(face)
    }
    leaf.append(cell); cells.push({ cell, i, j, shades })
  }
  host.append(leaf)
  function update(progress) {
    const t = direction > 0 ? progress : 1 - progress, flex = Math.sin(Math.PI * t), grid = []
    for (let j = 0; j <= rows; j++) {
      const v = j / rows, local = t + .22 * flex * (v - .5), row = []
      let x = 0, z = 0
      for (let i = 0; i <= columns; i++) {
        const u = i / columns
        row.push([x, j * dy + flex * width * .055 * Math.sin(Math.PI * u) * (v - .5), z])
        const angle = -Math.PI * local + softness * flex * (.28 + v * .45) * Math.sin(Math.PI * (i + .5) / columns)
        x += Math.cos(angle) * dx; z -= Math.sin(angle) * dx
      }
      grid.push(row)
    }
    for (const { cell, i, j, shades } of cells) {
      const origin = grid[j][i], right = grid[j][i + 1], down = grid[j + 1][i]
      const u = right.map((n, k) => (n - origin[k]) / dx), v = down.map((n, k) => (n - origin[k]) / dy)
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...normal) || 1
      cell.style.transform = `matrix3d(${[...u, 0, ...v, 0, ...normal.map(n => n / length), 0, ...origin, 1].join(',')})`
      shades.forEach(shade => { shade.style.opacity = (1 - Math.abs(normal[2] / length)) * .42 + flex * .08 })
    }
  }
  update(0)
  return { update, remove: () => leaf.remove() }
}
