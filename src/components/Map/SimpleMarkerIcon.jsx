import L from 'leaflet'

/**
 * 创建简洁的景点标记图标（小圆点）
 * @param {string} category - 景点类别
 * @param {boolean} highlighted - 是否高亮
 * @returns {L.DivIcon}
 */
export function createSimpleLandmarkIcon(category, highlighted = false) {
  // 根据类别设置颜色
  const colors = {
    '历史古迹': '#f59e0b', // 琥珀色
    '自然风光': '#22c55e', // 绿色
    '现代建筑': '#3b82f6', // 蓝色
    '民俗文化': '#a855f7', // 紫色
    '宗教圣地': '#f43f5e', // 玫瑰色
  }
  
  const color = colors[category] || '#64748b' // 默认灰色
  const size = highlighted ? 12 : 8
  const shadow = highlighted
    ? `0 0 0 4px ${color}40, 0 2px 6px rgba(0,0,0,0.3)`
    : `0 1px 3px rgba(0,0,0,0.2)`

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        border: 2px solid white;
        box-shadow: ${shadow};
        cursor: pointer;
        transition: all 0.2s;
        ${highlighted ? 'animation: marker-pulse 1.5s ease-in-out infinite;' : ''}
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

/**
 * 创建简洁的打卡标记图标
 * @param {boolean} highlighted - 是否高亮
 * @returns {L.DivIcon}
 */
export function createSimpleCheckinIcon(highlighted = false) {
  const size = highlighted ? 12 : 8
  const shadow = highlighted
    ? '0 0 0 4px rgba(34,197,94,0.4), 0 2px 6px rgba(0,0,0,0.3)'
    : '0 1px 3px rgba(0,0,0,0.2)'

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: #22c55e;
        border: 2px solid white;
        box-shadow: ${shadow};
        cursor: pointer;
        transition: all 0.2s;
        ${highlighted ? 'animation: marker-pulse 1.5s ease-in-out infinite;' : ''}
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}
