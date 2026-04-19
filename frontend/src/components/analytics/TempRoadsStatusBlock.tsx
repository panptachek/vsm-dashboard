import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'

interface TempRoadsStatusBlockProps {
  from: string
  to: string
}

const STATUS_COLORS: Record<string, string> = {
  shpgs_done: '#16a34a',
  ready_for_shpgs: '#2563eb',
  subgrade_not_to_grade: '#d97706',
  pioneer_fill: '#7c3aed',
  no_work: '#9ca3af',
}

const STATUS_BG: Record<string, string> = {
  shpgs_done: '#D9EAD3',
  ready_for_shpgs: '#D9EAF7',
  subgrade_not_to_grade: '#FCE5CD',
  pioneer_fill: '#E8DDF5',
  no_work: '#E5E7EB',
}

const STATUS_LABELS: Record<string, string> = {
  shpgs_done: 'ЗП готово',
  ready_for_shpgs: 'Под ЩПГС',
  subgrade_not_to_grade: 'ЗП в работе',
  pioneer_fill: 'Пионерка',
  no_work: 'Не в работе',
}

const ORDERED_STATUSES = ['shpgs_done', 'ready_for_shpgs', 'subgrade_not_to_grade', 'pioneer_fill']

// Section assignment rules per road
const ROAD_SECTIONS: Record<string, string[]> = {
  'АД9': ['1'], 'АД6': ['1'], 'АД5': ['1'], 'АД13': ['1'],
  'АД14': ['2'],
  'АД7': ['3'], 'АД15': ['3'], 'АД1': ['3'],
  'АД8 №1': ['3', '4'],
  'АД3': ['4'],
  'АД8 №2': ['5'], 'АД11': ['5'],
  'АД12': ['6'], 'АД2 №6': ['6'],
  'АД2 №7': ['7'], 'АД4 №7': ['7'],
  'АД4 №8': ['7', '8'],
  'АД4 №8.1': ['8'], 'АД4 №9': ['8'],
}

interface BarData {
  code: string
  sections: string[]
  totalLen: number
  lengths: Record<string, number>
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function TempRoadsStatusBlock({ to }: TempRoadsStatusBlockProps) {
  // Fetch temp road status data from backend
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['temp-roads-status-for-analytics', to],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/analytics/temp-roads?date=${to}`)
      if (r.ok) return await r.json()
      return null
    },
    staleTime: 60_000,
  })

  const bars = useMemo((): BarData[] => {
    if (!statusData?.roads) return []
    return (statusData.roads as BarData[]).map((r: BarData) => ({
      code: r.code,
      sections: ROAD_SECTIONS[r.code] || ['?'],
      totalLen: r.totalLen,
      lengths: r.lengths,
    }))
  }, [statusData])

  // Group roads by section
  const groupedBySec = useMemo(() => {
    const groups: Record<string, BarData[]> = {}
    for (let s = 1; s <= 8; s++) {
      groups[String(s)] = []
    }
    for (const bar of bars) {
      const secs = ROAD_SECTIONS[bar.code] || ['?']
      for (const sec of secs) {
        if (groups[sec] && !groups[sec].some(b => b.code === bar.code)) {
          groups[sec].push(bar)
        }
      }
    }
    return groups
  }, [bars])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Отсыпка автодорог
        </h2>
        <div className="animate-pulse bg-bg-card rounded-xl border border-border h-48" />
      </section>
    )
  }

  if (bars.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Отсыпка автодорог
        </h2>
        <div className="bg-bg-card rounded-xl border border-border p-6 text-center text-text-muted text-sm">
          Нет данных по статусам автодорог
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Отсыпка автодорог
      </h2>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {[...ORDERED_STATUSES, 'no_work'].map((st) => (
          <div key={st} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm border"
              style={{ backgroundColor: STATUS_BG[st], borderColor: STATUS_COLORS[st] }}
            />
            <span className="text-xs text-text-muted">{STATUS_LABELS[st]}</span>
          </div>
        ))}
      </div>

      {/* Bars grouped by section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {Object.entries(groupedBySec).map(([secNum, secBars]) => {
          if (secBars.length === 0) return null
          return (
            <motion.div
              key={secNum}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-bg-card rounded-xl border border-border shadow-sm p-4"
            >
              <h3 className="text-sm font-heading font-semibold text-text-primary mb-3">
                Участок {secNum}
              </h3>
              <div className="space-y-2">
                {secBars.map((bar) => {
                  const total = bar.totalLen || 1
                  const allStatuses = [...ORDERED_STATUSES, 'no_work']
                  const worked = ORDERED_STATUSES.reduce((s, st) => s + (bar.lengths[st] || 0), 0)
                  const pct = total > 0 ? Math.round(worked / total * 100) : 0
                  return (
                    <div key={bar.code}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text-primary">{bar.code}</span>
                        <span className="text-[10px] font-mono text-text-muted">
                          {(total / 1000).toFixed(2)} км &middot; {pct}%
                        </span>
                      </div>
                      <div className="flex h-4 rounded-sm overflow-hidden">
                        {allStatuses.map((st) => {
                          const len = bar.lengths[st] || 0
                          if (len <= 0) return null
                          const w = (len / total) * 100
                          return (
                            <div
                              key={st}
                              style={{
                                width: `${w}%`,
                                backgroundColor: STATUS_BG[st],
                                borderRight: '1px solid white',
                              }}
                              title={`${STATUS_LABELS[st]}: ${fmt(len)}м (${Math.round(w)}%)`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
