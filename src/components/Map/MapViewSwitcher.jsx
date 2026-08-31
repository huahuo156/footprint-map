import { Camera, Mountain } from 'lucide-react'

const VIEW_MODES = {
  footprint: {
    name: '足迹视图',
    icon: Camera,
    description: '查看我的打卡足迹',
  },
  landmark: {
    name: '景点视图',
    icon: Mountain,
    description: '探索各地景点',
  },
}

// 视图切换器：定位由父容器负责，本组件只渲染控件本身
export default function MapViewSwitcher({ currentView, onViewChange }) {
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200 p-1.5 flex gap-1">
      {Object.entries(VIEW_MODES).map(([key, mode]) => {
        const Icon = mode.icon
        const isActive = currentView === key
        return (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            title={mode.description}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{mode.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export { VIEW_MODES }
