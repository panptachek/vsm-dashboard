import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './components/Layout'
import { lazy, Suspense } from 'react'

const OverviewFinal = lazy(() => import('./pages-wip-v2/OverviewFinal'))
const AnalyticsFinal = lazy(() => import('./pages-wip-v2/AnalyticsFinal'))
const MapV3 = lazy(() => import('./pages-wip-v2/MapV3'))
// Старая упрощённая карта сохранена как fallback:
// const MapFinalOld = lazy(() => import('./pages-wip-v2/MapFinal'))
const MechanizationPage = lazy(() => import('./pages-wip-v2/MechanizationPage'))
const ReportsPage = lazy(() => import('./pages-wip-v2/ReportsPage'))
const SettingsPage = lazy(() => import('./pages-wip-v2/SettingsPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function Fallback() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#6b6b6b' }}>Загрузка...</div>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Suspense fallback={<Fallback />}><OverviewFinal /></Suspense>} />
            <Route path="/map" element={<Suspense fallback={<Fallback />}><MapV3 /></Suspense>} />
            <Route path="/analytics" element={<Suspense fallback={<Fallback />}><AnalyticsFinal /></Suspense>} />
            <Route path="/mechanization" element={<Suspense fallback={<Fallback />}><MechanizationPage /></Suspense>} />
            <Route path="/reports" element={<Suspense fallback={<Fallback />}><ReportsPage /></Suspense>} />
            <Route path="/settings" element={<Suspense fallback={<Fallback />}><SettingsPage /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
