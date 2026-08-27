import { useState } from 'react'
import CheckinList from './CheckinList'
import GuideList from './GuideList'
import SearchPanel from './SearchPanel'
import { Camera, BookOpen, Search } from 'lucide-react'

const TABS = [
  { key: 'checkins', label: '打卡', icon: Camera },
  { key: 'guides', label: '攻略', icon: BookOpen },
  { key: 'search', label: '搜索', icon: Search },
]

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState('checkins')

  return (
    <aside className="w-80 border-l border-gray-200 bg-white flex flex-col shrink-0">
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
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
        {activeTab === 'checkins' && <CheckinList />}
        {activeTab === 'guides' && <GuideList />}
        {activeTab === 'search' && <SearchPanel />}
      </div>
    </aside>
  )
}
