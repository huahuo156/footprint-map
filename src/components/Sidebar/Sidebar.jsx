import { useState } from 'react'
import { useParams } from 'react-router-dom'
import CheckinList from './CheckinList'
import GuideList from './GuideList'
import LandmarkList from './LandmarkList'
import SearchPanel from './SearchPanel'
import { Camera, BookOpen, Search, MapPin, PanelRight, X } from 'lucide-react'

const BASE_TABS = [
  { key: 'checkins', label: '打卡', icon: Camera },
  { key: 'guides', label: '攻略', icon: BookOpen },
  { key: 'search', label: '搜索', icon: Search },
]

const LANDMARK_TAB = { key: 'landmarks', label: '景点', icon: MapPin }

export default function Sidebar() {
  const { name: provinceName } = useParams()
  const [activeTab, setActiveTab] = useState('checkins')
  const [isOpen, setIsOpen] = useState(false)

  const tabs = provinceName ? [...BASE_TABS, LANDMARK_TAB] : BASE_TABS

  // If on province page and still on a tab that doesn't exist, reset to checkins
  const effectiveTab = tabs.find(t => t.key === activeTab) ? activeTab : 'checkins'

  return (
    <>
      {/* 切换按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-4 right-16 z-[1000] bg-white hover:bg-gray-50 shadow-lg rounded-lg p-2 flex items-center gap-2 text-sm font-medium text-gray-700 transition-all"
      >
        <PanelRight className="w-5 h-5" />
        <span className="hidden sm:inline">内容</span>
      </button>

      {/* 悬浮面板 */}
      <div
        className={`absolute top-0 right-0 h-full z-[999] transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <aside className="w-80 h-full bg-white shadow-2xl flex flex-col border-l border-gray-200">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">内容面板</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* 标签页 */}
          <div className="flex border-b border-gray-200">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
                  effectiveTab === tab.key
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* 内容 */}
          <div className="flex-1 overflow-y-auto sidebar-scroll">
            {effectiveTab === 'checkins' && <CheckinList />}
            {effectiveTab === 'guides' && <GuideList />}
            {effectiveTab === 'search' && <SearchPanel />}
            {effectiveTab === 'landmarks' && <LandmarkList />}
          </div>
        </aside>
      </div>

      {/* 遮罩层（点击关闭） */}
      {isOpen && (
        <div
          className="absolute inset-0 z-[998] bg-black/20"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
