import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BarChart3, HardHat, FileText, Truck } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts'

import type { Picket, Section } from '../types/geo'
import { MiniMap } from '../components/MiniMap'

interface SectionSummary {
  code: string
  name: string
  map_color: string
  pk_range: string
  progress_percent: number
  planned_volume: number
  completed_volume: number
  last_report_date: string | null
}

interface DashboardSummary {
  sections: SectionSummary[]
  totals: {
    overall_percent: number
    active_sections: number
    total_objects: number
    reports_this_week: number
  }
}

interface TimelinePoint {
  date: string
  volume: number
  reports: number
}

// ---------------------------------------------------------------------------
// Recharts custom tooltip
// ---------------------------------------------------------------------------

function TimelineTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <div className="text-text-muted text-xs mb-1">{label}</div>
      <div className="font-mono font-semibold text-text-primary">
        {payload[0].value.toLocaleString('ru-RU')} м&sup3;
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progressColor(pct: number): string {
  if (pct >= 70) return '#22c55e'
  if (pct >= 30) return '#f59e0b'
  return '#ef4444'
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-bg-card rounded-xl p-5 border border-border shadow-sm
                 hover:border-accent-red/30 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-text-muted text-sm">{label}</span>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-2xl font-bold font-mono text-text-primary">{value}</div>
      {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
    </motion.div>
  )
}

function SectionCard({ section }: { section: SectionSummary }) {
  const pct = section.progress_percent
  return (
    <Link to={`/sections/${section.code}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-card rounded-xl p-5 border border-border shadow-sm
                   hover:border-accent-red/30 hover:shadow-md transition-all cursor-pointer"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: section.map_color }} />
          <span className="font-heading text-sm font-semibold text-text-primary">{section.name}</span>
          <span className="text-xs font-mono text-text-muted ml-auto">{section.pk_range}</span>
        </div>
        <div className="w-full h-2 bg-bg-surface rounded-full overflow-hidden mb-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(pct, 100)}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ backgroundColor: progressColor(pct) }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">
            {section.completed_volume.toLocaleString('ru-RU')} / {section.planned_volume.toLocaleString('ru-RU')} м3
          </span>
          <span className="font-mono font-semibold" style={{ color: progressColor(pct) }}>
            {pct.toFixed(1)}%
          </span>
        </div>
        {section.last_report_date && (
          <div className="text-[10px] text-text-muted mt-2">
            Последний отчёт: {section.last_report_date}
          </div>
        )}
      </motion.div>
    </Link>
  )
}

export function Dashboard() {
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => fetch('/api/dashboard/summary').then(r => r.json()),
  })

  const { data: timeline = [] } = useQuery<TimelinePoint[]>({
    queryKey: ['dashboard-timeline'],
    queryFn: () => fetch('/api/dashboard/timeline').then(r => r.json()),
  })

  const { data: pickets = [] } = useQuery<Picket[]>({
    queryKey: ['geo-pickets'],
    queryFn: () => fetch('/api/geo/pickets').then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  const { data: geoSections = [] } = useQuery<Section[]>({
    queryKey: ['geo-sections'],
    queryFn: () => fetch('/api/geo/sections').then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  // Format timeline dates for display
  const timelineData = useMemo(
    () =>
      timeline.map((t) => ({
        ...t,
        label: new Date(t.date).toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
        }),
      })),
    [timeline]
  )

  // Build progress bars data from summary sections
  const progressData = useMemo(
    () =>
      (data?.sections ?? []).map((sec) => ({
        name: sec.name,
        progress: sec.progress_percent,
        color: sec.map_color,
      })),
    [data]
  )

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-bg-card rounded-xl p-5 border border-border shadow-sm animate-pulse h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-bg-card rounded-xl p-5 border border-border shadow-sm animate-pulse h-36" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 lg:pb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-heading font-bold text-text-primary">
          ВСМ СПб — Москва
        </h1>
        <span className="text-xs font-mono text-text-muted">3 этап</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={BarChart3} label="Общий прогресс"
          value={`${data.totals.overall_percent.toFixed(1)}%`}
          color="text-accent-red"
        />
        <KpiCard
          icon={HardHat} label="Участков активно"
          value={`${data.totals.active_sections} из 8`}
          color="text-text-secondary"
        />
        <KpiCard
          icon={FileText} label="Отчётов за неделю"
          value={String(data.totals.reports_this_week)}
          color="text-text-secondary"
        />
        <KpiCard
          icon={Truck} label="Объектов"
          value={String(data.totals.total_objects)}
          color="text-text-secondary"
        />
      </div>

      {/* Section cards */}
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Участки
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {data.sections.map((sec, i) => (
          <motion.div
            key={sec.code}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <SectionCard section={sec} />
          </motion.div>
        ))}
      </div>

      {/* Charts + Map row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-8">
        {/* Timeline Area Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="xl:col-span-2 bg-bg-card rounded-xl p-5 border border-border shadow-sm"
        >
          <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
            Динамика работ
          </h3>
          {timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#737373', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e5e5' }}
                />
                <YAxis
                  tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e5e5' }}
                  tickFormatter={(v: number) => v.toLocaleString('ru-RU')}
                />
                <RechartsTooltip content={<TimelineTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#dc2626"
                  strokeWidth={2}
                  fill="url(#volumeGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#dc2626', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-text-muted text-sm">
              Нет данных
            </div>
          )}
        </motion.div>

        {/* Mini Map */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-bg-card rounded-xl p-5 border border-border shadow-sm"
        >
          <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
            Трасса
          </h3>
          {pickets.length >= 2 ? (
            <MiniMap pickets={pickets} sections={geoSections} />
          ) : (
            <div className="h-[250px] flex items-center justify-center text-text-muted text-sm">
              Загрузка карты...
            </div>
          )}
        </motion.div>
      </div>

      {/* Progress Horizontal Bar Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="mt-4 bg-bg-card rounded-xl p-5 border border-border shadow-sm"
      >
        <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
          Прогресс по участкам
        </h3>
        {progressData.length > 0 ? (
          <ResponsiveContainer width="100%" height={progressData.length * 44 + 20}>
            <BarChart
              data={progressData}
              layout="vertical"
              margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
            >
              <CartesianGrid horizontal={false} stroke="#e5e5e5" />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e5e5' }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#171717', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={160}
              />
              <RechartsTooltip
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as { name: string; progress: number; color: string }
                  return (
                    <div className="bg-white border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
                      <div className="text-text-muted text-xs mb-1">{d.name}</div>
                      <div className="font-mono font-semibold" style={{ color: d.color }}>
                        {d.progress.toFixed(1)}%
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="progress" radius={[0, 4, 4, 0]} barSize={20}>
                {progressData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">
            Нет данных
          </div>
        )}
      </motion.div>
    </div>
  )
}
