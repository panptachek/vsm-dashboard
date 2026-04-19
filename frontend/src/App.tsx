import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { MapPage } from './pages/MapPage'
import { SectionDetail } from './pages/SectionDetail'
import { ReportsPage } from './pages/ReportsPage'
import { ReportUpload } from './pages/ReportUpload'
import { ReportReview } from './pages/ReportReview'
import { Analytics } from './pages/Analytics'
import { DailyQuarryReport } from './pages/DailyQuarryReport'
import { lazy, Suspense } from 'react'

const WipOverview = lazy(() => import('./pages-wip/overview.jsx'))
const WipAnalytics = lazy(() => import('./pages-wip/analytics.jsx'))
const WipDailyRoads = lazy(() => import('./pages-wip/daily_roads.jsx'))
const WipMap = lazy(() => import('./pages-wip/map_drawer.jsx'))
const WipSecondary = lazy(() => import('./pages-wip/secondary.jsx'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function WipFallback() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#6b6b6b' }}>Загрузка...</div>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Analytics />} />
            <Route path="/overview" element={<Dashboard />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/sections/:code" element={<SectionDetail />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/daily-quarry-report" element={<DailyQuarryReport />} />
            <Route path="/reports/upload" element={<ReportUpload />} />
            <Route path="/reports/:id/review" element={<ReportReview />} />
            <Route path="/wip/overview" element={<Suspense fallback={<WipFallback />}><WipOverview /></Suspense>} />
            <Route path="/wip/analytics" element={<Suspense fallback={<WipFallback />}><WipAnalytics /></Suspense>} />
            <Route path="/wip/daily-roads" element={<Suspense fallback={<WipFallback />}><WipDailyRoads /></Suspense>} />
            <Route path="/wip/map" element={<Suspense fallback={<WipFallback />}><WipMap /></Suspense>} />
            <Route path="/wip/secondary" element={<Suspense fallback={<WipFallback />}><WipSecondary /></Suspense>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
