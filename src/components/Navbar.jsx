import { useAuth } from './Auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { LogOut, Plus, Map, User } from 'lucide-react'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-2">
        <Map className="w-6 h-6 text-blue-600" />
        <span className="font-bold text-lg text-gray-900 cursor-pointer" onClick={() => navigate('/')}>
          足迹山河
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/guide/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          写攻略
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition-colors"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
            ) : (
              <User className="w-5 h-5 text-gray-400" />
            )}
            <span className="text-sm text-gray-600">{profile?.nickname || '用户'}</span>
          </button>
          <button onClick={signOut} className="p-1.5 text-gray-400 hover:text-gray-600 rounded" title="退出登录">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
