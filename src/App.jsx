import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AccountGate } from './auth/Account'

// 景点场景和旧攻略页面分别按需加载。
const JournalPage = lazy(() => import('./journal/JournalPage'))

function LoadingScreen() {
  return <div className="journal-loading" role="status">正在展开你的手帐…</div>
}

// 首页以自由画布和手机内容流呈现旅行手帐。
function HomeLayout() {
  return <AccountGate>{user => <JournalPage key={user.id} userId={user.id} />}</AccountGate>
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<HomeLayout />} />
        {/* 省份放大视图已舍弃，旧入口统一回首页 */}
        <Route path="/province/*" element={<Navigate to="/" replace />} />
        <Route path="/landmarks" element={<Navigate to="/" replace />} />
        <Route path="/guide/new" element={<Navigate to="/" replace />} />
        <Route path="/guide/:id" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
