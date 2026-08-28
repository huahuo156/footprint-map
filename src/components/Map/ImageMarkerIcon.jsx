import L from 'leaflet'

/**
 * 创建带图片的景点标记图标
 * @param {string} imageUrl - 图片URL
 * @param {string} name - 景点名称
 * @param {boolean} highlighted - 是否高亮
 * @returns {L.DivIcon}
 */
export function createLandmarkImageIcon(imageUrl, name, highlighted = false) {
  const size = highlighted ? 56 : 48
  const borderWidth = highlighted ? 3 : 2
  const shadow = highlighted
    ? '0 0 0 4px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)'
    : '0 2px 8px rgba(0,0,0,0.2)'

  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: ${size}px;
        height: ${size + 20}px;
        cursor: pointer;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        transition: transform 0.2s;
      ">
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 12px;
          overflow: hidden;
          border: ${borderWidth}px solid white;
          box-shadow: ${shadow};
          ${highlighted ? 'animation: marker-pulse 1.5s ease-in-out infinite;' : ''}
        ">
          <img
            src="${imageUrl}"
            alt="${name}"
            style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            "
            onerror="this.src='https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=200&h=200&fit=crop'"
          />
        </div>
        <div style="
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.7);
          color: white;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
          max-width: 80px;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;
        ">${name}</div>
      </div>
    `,
    iconSize: [size, size + 20],
    iconAnchor: [size / 2, size + 20],
    popupAnchor: [0, -(size + 10)],
  })
}

/**
 * 创建带图片的打卡标记图标
 * @param {string} imageUrl - 打卡图片URL
 * @param {boolean} highlighted - 是否高亮
 * @returns {L.DivIcon}
 */
export function createCheckinImageIcon(imageUrl, highlighted = false) {
  const size = highlighted ? 44 : 36
  const borderWidth = highlighted ? 3 : 2
  const shadow = highlighted
    ? '0 0 0 4px rgba(34,197,94,0.4), 0 4px 12px rgba(0,0,0,0.3)'
    : '0 2px 8px rgba(0,0,0,0.2)'

  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: ${size}px;
        height: ${size}px;
        cursor: pointer;
        transition: transform 0.2s;
      ">
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          overflow: hidden;
          border: ${borderWidth}px solid white;
          box-shadow: ${shadow};
          ${highlighted ? 'animation: marker-pulse 1.5s ease-in-out infinite;' : ''}
        ">
          <img
            src="${imageUrl}"
            alt="打卡照片"
            style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            "
            onerror="this.src='https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=200&h=200&fit=crop'"
          />
        </div>
        <div style="
          position: absolute;
          bottom: -2px;
          right: -2px;
          background: #22c55e;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}
