import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { sectionNumberToCodes } from '../../lib/sections'

interface SummaryResponse {
  period: string
  date: string
  sand: { plan: number; fact: number; fact_day: number; fact_night: number; percent: number }
  excavation: { plan: number; fact: number; fact_day: number; fact_night: number; percent: number }
  transport: { plan: number; fact: number; fact_day: number; fact_night: number; percent: number }
  prs: { plan: number; fact: number; fact_day: number; fact_night: number; percent: number }
}

interface TempRoadsBlockProps {
  selectedSections: Set<number>
  date: string
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

function planFactColor(pct: number): string {
  if (pct < 50) return '#ef4444'
  if (pct <= 80) return '#f59e0b'
  return '#22c55e'
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' as const },
  }),
}

interface KpiItem {
  label: string
  value: number
  day: number
  night: number
  plan: number
  percent: number
  unit: string
  tooltip: string
}

async function fetchSectionSummary(sectionNum: number, date: string): Promise<{ section: number; data: SummaryResponse } | null> {
  // For section 3, the API only takes a single code. Use first code (UCH_31).
  // The API actually accepts UCH_31 and returns data just for that sub-section.
  // We fetch both UCH_31 and UCH_32 separately and merge.
  const codes = sectionNumberToCodes(sectionNum)

  if (codes.length === 1) {
    try {
      const res = await fetch(`/api/dashboard/analytics/summary?section=${codes[0]}&date=${date}`)
      if (!res.ok) return null
      return { section: sectionNum, data: await res.json() as SummaryResponse }
    } catch {
      return null
    }
  }

  // Multiple codes (section 3): fetch each and merge
  const results = await Promise.all(
    codes.map(async (code) => {
      try {
        const res = await fetch(`/api/dashboard/analytics/summary?section=${code}&date=${date}`)
        if (!res.ok) return null
        return await res.json() as SummaryResponse
      } catch {
        return null
      }
    })
  )

  const validResults = results.filter(Boolean) as SummaryResponse[]
  if (validResults.length === 0) return null

  const merged: SummaryResponse = {
    period: validResults[0].period,
    date: validResults[0].date,
    sand: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
    excavation: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
    transport: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
    prs: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
  }

  for (const r of validResults) {
    for (const key of ['sand', 'excavation', 'transport', 'prs'] as const) {
      merged[key].plan += r[key].plan
      merged[key].fact += r[key].fact
      merged[key].fact_day += r[key].fact_day
      merged[key].fact_night += r[key].fact_night
    }
  }

  // Recompute percent
  for (const key of ['sand', 'excavation', 'transport', 'prs'] as const) {
    merged[key].percent = merged[key].plan > 0
      ? Math.round(merged[key].fact / merged[key].plan * 100 * 10) / 10
      : 0
  }

  return { section: sectionNum, data: merged }
}

export function TempRoadsBlock({ selectedSections, date }: TempRoadsBlockProps) {
  // Fetch per-section data for all 8 sections (used for chart + aggregation)
  const { data: perSectionData, isLoading } = useQuery({
    queryKey: ['analytics-summary-per-section', date],
    queryFn: async () => {
      const sections = [1, 2, 3, 4, 5, 6, 7, 8]
      const results = await Promise.all(
        sections.map((n) => fetchSectionSummary(n, date))
      )
      return results.filter(Boolean) as { section: number; data: SummaryResponse }[]
    },
    staleTime: 60_000,
  })

  // Aggregate summary: sum selected sections (or all if none selected)
  const summary = useMemo(() => {
    if (!perSectionData || perSectionData.length === 0) return null

    const filtered = selectedSections.size === 0
      ? perSectionData
      : perSectionData.filter((r) => selectedSections.has(r.section))

    if (filtered.length === 0) return null

    const agg: SummaryResponse = {
      period: 'day',
      date: date,
      sand: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
      excavation: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
      transport: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
      prs: { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 },
    }

    for (const r of filtered) {
      for (const key of ['sand', 'excavation', 'transport', 'prs'] as const) {
        agg[key].plan += r.data[key].plan
        agg[key].fact += r.data[key].fact
        agg[key].fact_day += r.data[key].fact_day
        agg[key].fact_night += r.data[key].fact_night
      }
    }

    for (const key of ['sand', 'excavation', 'transport', 'prs'] as const) {
      agg[key].percent = agg[key].plan > 0
        ? Math.round(agg[key].fact / agg[key].plan * 100 * 10) / 10
        : 0
    }

    return agg
  }, [perSectionData, selectedSections, date])

  const kpiItems: KpiItem[] = useMemo(() => {
    if (!summary) return []
    const s = summary
    return [
      {
        label: 'Песок',
        value: s.sand.fact, day: s.sand.fact_day, night: s.sand.fact_night,
        plan: s.sand.plan, percent: s.sand.percent, unit: '\u043C\u00B3',
        tooltip: 'Суммарный объём завезённого песка. Включает доставку из карьеров и накопителей.',
      },
      {
        label: 'Выемка',
        value: s.excavation.fact, day: s.excavation.fact_day, night: s.excavation.fact_night,
        plan: s.excavation.plan, percent: s.excavation.percent, unit: '\u043C\u00B3',
        tooltip: 'Объём разработанного грунта из выемки. Факт по данным геодезической съёмки.',
      },
      {
        label: 'Перевозка',
        value: s.transport.fact, day: s.transport.fact_day, night: s.transport.fact_night,
        plan: s.transport.plan, percent: s.transport.percent, unit: '\u043C\u00B3',
        tooltip: 'Суммарный объём перевезённого грунта. Все виды транспорта.',
      },
      {
        label: 'ПРС',
        value: s.prs.fact, day: s.prs.fact_day, night: s.prs.fact_night,
        plan: s.prs.plan, percent: s.prs.percent, unit: '\u043C\u00B3',
        tooltip: 'Устройство защитных слоёв: геотекстиль, обочины, откосы, кюветы.',
      },
    ]
  }, [summary])

  // Chart data: per-section breakdown (filtered)
  const chartData = useMemo(() => {
    if (!perSectionData) return []
    return perSectionData
      .filter((r) => selectedSections.size === 0 || selectedSections.has(r.section))
      .map((r) => ({
        section: `УЧ ${r.section}`,
        'Песок': Math.round(r.data.sand.fact),
        'Выемка': Math.round(r.data.excavation.fact),
        'Перевозка': Math.round(r.data.transport.fact),
        'ПРС': Math.round(r.data.prs.fact),
      }))
  }, [perSectionData, selectedSections])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Отсыпка временных АД
        </h2>
        <div className="animate-pulse grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card rounded-xl p-5 border border-border h-32" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Отсыпка временных АД
      </h2>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {kpiItems.map((item, i) => (
          <motion.div
            key={item.label}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            className="bg-bg-card rounded-xl p-5 border border-border shadow-sm
                       hover:border-accent-red/30 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-1 mb-3">
              <span className="text-sm text-text-muted">{item.label}</span>
              <span className="relative inline-flex items-center ml-1 cursor-help group">
                <Info className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-red transition-colors" />
                <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
                  w-64 bg-white border border-border rounded-lg shadow-lg
                  px-3 py-2 text-xs text-text-secondary leading-relaxed
                  pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.tooltip}
                </span>
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-text-primary">
              {fmt(item.value)}
              <span className="text-sm font-normal text-text-muted ml-1">{item.unit}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
              <span>
                День: <span className="font-mono font-medium text-text-primary">{fmt(item.day)}</span>
              </span>
              <span>
                Ночь: <span className="font-mono font-medium text-text-primary">{fmt(item.night)}</span>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(item.percent, 100)}%`,
                    backgroundColor: planFactColor(item.percent),
                  }}
                />
              </div>
              <span
                className="text-xs font-mono font-semibold"
                style={{ color: planFactColor(item.percent) }}
              >
                {item.percent.toFixed(0)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Stacked bar chart per section */}
      {chartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-bg-card rounded-xl p-5 border border-border shadow-sm"
        >
          <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
            Объёмы по участкам
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis
                dataKey="section"
                tick={{ fill: '#737373', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e5e5' }}
              />
              <YAxis
                tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e5e5' }}
                tickFormatter={(v: number) => fmt(v)}
              />
              <RechartsTooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Песок" stackId="a" fill="#f59e0b" />
              <Bar dataKey="Выемка" stackId="a" fill="#8b5cf6" />
              <Bar dataKey="Перевозка" stackId="a" fill="#3b82f6" />
              <Bar dataKey="ПРС" stackId="a" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </section>
  )
}
