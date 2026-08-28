import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './components/Auth/AuthProvider'
import LoginForm from './components/Auth/LoginForm'
import Navbar from './components/Navbar'
import { MapProvider } from './contexts/MapContext'
import { Loader2 } from 'lucide-react'

// 懒加载地图和攻略组件
const ChinaMap = lazy(() => import('./components/Map/ChinaMap'))
const ProvinceView = lazy(() => import('./components/Map/ProvinceView'))
const Sidebar = lazy(() => import('./components/Sidebar/Sidebar'))
const GuideEditor = lazy(() => import('./components/Guide/GuideEditor'))
const GuideDetail = lazy(() => import('./components/Guide/GuideDetail'))
const ConnectionLineOverlay = lazy(() => import('./components/Map/ConnectionLineOverlay'))
const ProfileEditor = lazy(() => import('./components/Profile/ProfileEditor'))

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )
}

// 地图加载的 fallback 组件
function MapLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500">加载地图中...</p>
      </div>
    </div>
  )
}

function MapLayout() {
  return (
    <MapProvider>
      <div className="h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 relative overflow-hidden">
          <Suspense fallback={<MapLoading />}>
            <ChinaMap />
          </Suspense>
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={null}>
        <ConnectionLineOverlay />
      </Suspense>
    </MapProvider>
  )
}

function ProvinceLayout() {
  return (
    <MapProvider>
      <div className="h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 relative overflow-hidden">
          <Suspense fallback={<MapLoading />}>
            <ProvinceView />
          </Suspense>
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={null}>
        <ConnectionLineOverlay />
      </Suspense>
    </MapProvider>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <LoginForm />

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<MapLayout />} />
        <Route path="/province/:name" element={<ProvinceLayout />} />
        <Route path="/guide/new" element={<GuideEditor />} />
        <Route path="/guide/:id" element={<GuideDetail />} />
        <Route path="/profile" element={<ProfileEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
