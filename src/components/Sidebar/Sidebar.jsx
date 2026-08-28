import { useState } from 'react'
import { useParams } from 'react-router-dom'
import CheckinList from './CheckinList'
import GuideList from './GuideList'
import LandmarkList from './LandmarkList'
import SearchPanel from './SearchPanel'
import { Camera, BookOpen, Search, MapPin } from 'lucide-react'

const BASE_TABS = [
  { key: 'checkins', label: '打卡', icon: Camera },
  { key: 'guides', label: '攻略', icon: BookOpen },
  { key: 'search', label: '搜索', icon: Search },
]

const LANDMARK_TAB = { key: 'landmarks', label: '景点', icon: MapPin }

export default function Sidebar() {
  const { name: provinceName } = useParams()
  const [activeTab, setActiveTab] = useState('checkins')

  const tabs = provinceName ? [...BASE_TABS, LANDMARK_TAB] : BASE_TABS

  // If on province page and still on a tab that doesn't exist, reset to checkins
  const effectiveTab = tabs.find(t => t.key === activeTab) ? activeTab : 'checkins'

  return (
    <aside className="w-80 border-l border-gray-200 bg-white flex flex-col shrink-0">
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
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {effectiveTab === 'checkins' && <CheckinList />}
        {effectiveTab === 'guides' && <GuideList />}
        {effectiveTab === 'search' && <SearchPanel />}
        {effectiveTab === 'landmarks' && <LandmarkList />}
      </div>
    </aside>
  )
}
