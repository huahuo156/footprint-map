import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './components/Auth/AuthProvider'
import LoginForm from './components/Auth/LoginForm'
import Navbar from './components/Navbar'
import ChinaMap from './components/Map/ChinaMap'
import ProvinceView from './components/Map/ProvinceView'
import Sidebar from './components/Sidebar/Sidebar'
import GuideEditor from './components/Guide/GuideEditor'
import GuideDetail from './components/Guide/GuideDetail'
import ConnectionLineOverlay from './components/Map/ConnectionLineOverlay'
import { MapProvider } from './contexts/MapContext'
import { Loader2 } from 'lucide-react'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )
}

function MapLayout() {
  return (
    <MapProvider>
      <div className="h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            <ChinaMap />
          </div>
          <Sidebar />
        </div>
      </div>
      <ConnectionLineOverlay />
    </MapProvider>
  )
}

function ProvinceLayout() {
  return (
    <MapProvider>
      <div className="h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            <ProvinceView />
          </div>
          <Sidebar />
        </div>
      </div>
      <ConnectionLineOverlay />
    </MapProvider>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <LoginForm />

  return (
    <Routes>
      <Route path="/" element={<MapLayout />} />
      <Route path="/province/:name" element={<ProvinceLayout />} />
      <Route path="/guide/new" element={<GuideEditor />} />
      <Route path="/guide/:id" element={<GuideDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
