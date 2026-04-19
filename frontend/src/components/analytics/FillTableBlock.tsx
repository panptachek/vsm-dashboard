import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'

interface FillTableBlockProps {
  from: string
  to: string
}

interface RoadStatus {
  code: string
  sections: string[]
  totalLen: number
  lengths: Record<string, number>
}

const STATUS_LABELS: Record<string, string> = {
  shpgs_done: 'ЗП готово',
  ready_for_shpgs: 'Под ЩПГС',
  subgrade_not_to_grade: 'ЗП в работе',
  pioneer_fill: 'Пионерка',
  no_work: 'Не в работе',
}

const ORDERED = ['pioneer_fill', 'subgrade_not_to_grade', 'ready_for_shpgs', 'shpgs_done', 'no_work']

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function FillTableBlock({ to }: FillTableBlockProps) {
  const [tab, setTab] = useState<'day' | 'cumulative'>('cumulative')

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['temp-roads-fill-table', to],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/temp-roads?date=${to}`)
      if (res.ok) return await res.json()
      return null
    },
    staleTime: 60_000,
  })

  const roads: RoadStatus[] = statusData?.roads ?? []

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Таблица отсыпки
        </h2>
        <div className="animate-pulse bg-bg-card rounded-xl border border-border h-48" />
      </section>
    )
  }

  if (roads.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Таблица отсыпки
        </h2>
        <div className="bg-bg-card rounded-xl border border-border p-6 text-center text-text-muted text-sm">
          Нет данных
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-heading font-semibold text-text-primary">
          Таблица отсыпки
        </h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('cumulative')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'cumulative'
                ? 'bg-accent-red text-white shadow-sm'
                : 'bg-bg-surface text-text-muted hover:bg-border'
            }`}
          >
            За всё время
          </button>
          <button
            onClick={() => setTab('day')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'day'
                ? 'bg-accent-red text-white shadow-sm'
                : 'bg-bg-surface text-text-muted hover:bg-border'
            }`}
          >
            За день
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface">
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted">АД</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-text-muted">Длина, м</th>
                {ORDERED.map((st) => (
                  <th key={st} className="px-3 py-3 text-center text-xs font-medium text-text-muted">
                    {STATUS_LABELS[st]}
                  </th>
                ))}
                <th className="px-3 py-3 text-center text-xs font-semibold text-text-primary">%</th>
              </tr>
            </thead>
            <tbody>
              {roads.map((road) => {
                const total = road.totalLen || 1
                const worked = ORDERED.slice(0, 4).reduce((s, st) => s + (road.lengths[st] || 0), 0)
                const pct = total > 0 ? Math.round(worked / total * 100) : 0
                return (
                  <tr key={road.code} className="border-b border-border/50">
                    <td className="px-4 py-2 font-medium text-text-primary text-xs whitespace-nowrap">
                      {road.code}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">{fmt(total)}</td>
                    {ORDERED.map((st) => (
                      <td key={st} className="px-3 py-2 text-center font-mono text-xs">
                        {(road.lengths[st] || 0) === 0
                          ? <span className="text-text-muted">&mdash;</span>
                          : fmt(road.lengths[st] || 0)
                        }
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-mono text-xs font-semibold bg-bg-surface">
                      {pct}%
                    </td>
                  </tr>
                )
              })}
              {/* Total row */}
              <tr className="bg-bg-surface font-semibold border-t border-border">
                <td className="px-4 py-2 text-text-primary text-xs">Итого</td>
                <td className="px-3 py-2 text-center font-mono text-xs">
                  {fmt(roads.reduce((s, r) => s + (r.totalLen || 0), 0))}
                </td>
                {ORDERED.map((st) => (
                  <td key={st} className="px-3 py-2 text-center font-mono text-xs">
                    {fmt(roads.reduce((s, r) => s + (r.lengths[st] || 0), 0))}
                  </td>
                ))}
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold">
                  {(() => {
                    const total = roads.reduce((s, r) => s + (r.totalLen || 0), 0)
                    const worked = roads.reduce((s, r) => {
                      return s + ORDERED.slice(0, 4).reduce((ss, st) => ss + (r.lengths[st] || 0), 0)
                    }, 0)
                    return total > 0 ? Math.round(worked / total * 100) : 0
                  })()}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </motion.div>
    </section>
  )
}
