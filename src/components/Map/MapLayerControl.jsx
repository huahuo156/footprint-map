import { useState } from 'react'
import { Layers, Map, Satellite, Mountain, Globe } from 'lucide-react'

// 高德地图瓦片样式配置
const MAP_STYLES = {
  // 标准路网图
  standard: {
    name: '标准路网',
    icon: Map,
    url: `https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7&key={key}`,
    description: '清晰的道路和行政边界',
  },
  // 卫星图
  satellite: {
    name: '卫星影像',
    icon: Satellite,
    url: `https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=6&key={key}`,
    description: '真实地貌卫星影像',
  },
  // 卫星路网混合
  hybrid: {
    name: '卫星路网',
    icon: Globe,
    url: `https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8&key={key}`,
    description: '卫星影像叠加路网标注',
  },
  // 地形图
  terrain: {
    name: '地形地貌',
    icon: Mountain,
    url: `https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=6&key={key}`,
    description: '地形起伏和地貌特征',
  },
}

export default function MapLayerControl({ currentStyle, onStyleChange, apiKey }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="absolute top-4 right-4 z-[1000]">
      {/* 切换按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white hover:bg-gray-50 shadow-lg rounded-lg p-2 flex items-center gap-2 text-sm font-medium text-gray-700 transition-all"
      >
        <Layers className="w-5 h-5" />
        <span className="hidden sm:inline">图层</span>
      </button>

      {/* 图层选择面板 */}
      {isOpen && (
        <div className="absolute top-12 right-0 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[200px]">
          <div className="text-xs text-gray-500 px-2 py-1 mb-1">地图样式</div>
          {Object.entries(MAP_STYLES).map(([key, style]) => {
            const Icon = style.icon
            const isActive = currentStyle === key
            return (
              <button
                key={key}
                onClick={() => {
                  onStyleChange(key)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                <div className="text-left">
                  <div>{style.name}</div>
                  <div className="text-xs text-gray-400 font-normal">{style.description}</div>
                </div>
                {isActive && (
                  <div className="ml-auto w-2 h-2 rounded-full bg-blue-600" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 获取瓦片URL
export function getTileUrl(style, apiKey) {
  const config = MAP_STYLES[style] || MAP_STYLES.standard
  return config.url.replace('{key}', apiKey)
}

// 导出样式配置供其他组件使用
export { MAP_STYLES }
