import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface PeriodVolumesBlockProps {
  from: string
  to: string
}

interface SummaryCategory {
  plan: number
  fact: number
  fact_day: number
  fact_night: number
  percent: number
}

interface SummaryResponse {
  period: string
  date: string
  sand: SummaryCategory
  excavation: SummaryCategory
  transport: SummaryCategory
  prs: SummaryCategory
}

const SECTION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8']
const SECTION_CODES = ['UCH_1', 'UCH_2', 'UCH_31', 'UCH_32', 'UCH_4', 'UCH_5', 'UCH_6', 'UCH_7', 'UCH_8']

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

type PeriodKey = 'week' | 'month' | 'total'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'week', label: 'За неделю' },
  { key: 'month', label: 'За месяц' },
  { key: 'total', label: 'Накопительно (с начала)' },
]

const METRICS: { key: keyof Pick<SummaryResponse, 'sand' | 'excavation' | 'prs' | 'transport'>; label: string }[] = [
  { key: 'sand', label: 'Песок' },
  { key: 'excavation', label: 'Выемка' },
  { key: 'prs', label: 'ПРС' },
  { key: 'transport', label: 'Перевозка' },
]

function mergeSectionData(items: { code: string; data: SummaryResponse }[]): Record<string, SummaryCategory>[] {
  // Merge into 8-section array
  const result: Record<string, SummaryCategory>[] = []

  for (let n = 1; n <= 8; n++) {
    const merged: Record<string, SummaryCategory> = {}
    for (const m of METRICS) {
      merged[m.key] = { plan: 0, fact: 0, fact_day: 0, fact_night: 0, percent: 0 }
    }

    const relevant = items.filter((item) => {
      if (n === 3) return item.code === 'UCH_31' || item.code === 'UCH_32'
      return item.code === `UCH_${n}`
    })

    for (const item of relevant) {
      for (const m of METRICS) {
        const cat = item.data[m.key] as SummaryCategory | undefined
        if (cat) {
          merged[m.key].plan += cat.plan
          merged[m.key].fact += cat.fact
          merged[m.key].fact_day += cat.fact_day
          merged[m.key].fact_night += cat.fact_night
        }
      }
    }
    result.push(merged)
  }
  return result
}

function PeriodTable({ periodKey, date }: { periodKey: PeriodKey; date: string }) {
  const { data: sectionData, isLoading } = useQuery({
    queryKey: ['analytics-period-volumes', periodKey, date],
    queryFn: async () => {
      const results = await Promise.all(
        SECTION_CODES.map(async (code) => {
          try {
            const res = await fetch(`/api/dashboard/analytics/summary?section=${code}&date=${date}&period=${periodKey}`)
            if (!res.ok) return null
            const data = await res.json() as SummaryResponse
            return { code, data }
          } catch {
            return null
          }
        })
      )
      return results.filter(Boolean) as { code: string; data: SummaryResponse }[]
    },
    staleTime: 60_000,
  })

  const merged = useMemo(() => {
    if (!sectionData) return null
    return mergeSectionData(sectionData)
  }, [sectionData])

  if (isLoading) {
    return <div className="animate-pulse bg-bg-surface rounded h-32" />
  }

  if (!merged) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-surface">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted min-w-[140px]">Показатель</th>
            {SECTION_LABELS.map((s) => (
              <th key={s} className="px-3 py-2.5 text-center text-xs font-medium text-text-muted min-w-[70px]">
                УЧ {s}
              </th>
            ))}
            <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-primary min-w-[80px]">Всего</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const vals = merged.map((sec) => sec[m.key].fact)
            const total = vals.reduce((a, b) => a + b, 0)
            return (
              <tr key={m.key} className="border-b border-border/50">
                <td className="px-4 py-2 font-medium text-text-primary text-xs">{m.label}</td>
                {vals.map((v, i) => (
                  <td key={i} className="px-3 py-2 text-center font-mono text-xs">
                    {v === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(v)}
                  </td>
                ))}
                <td className="px-4 py-2 text-center font-mono text-xs font-semibold bg-bg-surface">
                  {total === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PeriodVolumesBlock({ to }: PeriodVolumesBlockProps) {
  const [open, setOpen] = useState<Record<PeriodKey, boolean>>({
    week: false,
    month: false,
    total: false,
  })

  const toggle = (key: PeriodKey) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Объёмы за неделю / месяц / накопительно
      </h2>

      <div className="space-y-2">
        {PERIODS.map(({ key, label }) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
          >
            <button
              onClick={() => toggle(key)}
              className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-bg-surface/50 transition-colors"
            >
              {open[key]
                ? <ChevronDown className="w-4 h-4 text-text-muted" />
                : <ChevronRight className="w-4 h-4 text-text-muted" />
              }
              <span className="text-sm font-heading font-semibold text-text-primary">{label}</span>
            </button>
            {open[key] && (
              <div className="border-t border-border">
                <PeriodTable periodKey={key} date={to} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  )
}
