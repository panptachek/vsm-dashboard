import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

interface PilesResponse {
  total_driven: number
  by_length: Record<string, number>
  by_section: Record<string, number>
  test_piles: number
  welding: number
  platforms: number
  dynamic_tests: number
}

interface PilesBlockProps {
  selectedSections: Set<number>
  date: string
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

const DONUT_COLORS = ['#dc2626', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6']
const SECTION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8']

/** Merge UCH_31+UCH_32 into section 3 */
function mergeSection3(bySection: Record<string, number>): number[] {
  const result: number[] = []
  for (let n = 1; n <= 8; n++) {
    if (n === 3) {
      result.push((bySection['UCH_31'] || 0) + (bySection['UCH_32'] || 0) + (bySection['UCH_3'] || 0))
    } else {
      result.push(bySection[`UCH_${n}`] || 0)
    }
  }
  return result
}

export function PilesBlock({ selectedSections, date }: PilesBlockProps) {
  // Fetch all sections, filter client-side via visibleSections + mergeSection3
  const { data: pilesData, isLoading } = useQuery({
    queryKey: ['analytics-piles', date],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/piles?date=${date}`)
      if (!res.ok) return null
      return await res.json() as PilesResponse
    },
  })

  const sectionValues = useMemo(() => {
    if (!pilesData) return []
    return mergeSection3(pilesData.by_section)
  }, [pilesData])

  const visibleSections = useMemo(() => {
    if (selectedSections.size === 0) return [0, 1, 2, 3, 4, 5, 6, 7]
    return Array.from(selectedSections).map((n) => n - 1).sort((a, b) => a - b)
  }, [selectedSections])

  // Donut data from by_length
  const donutData = useMemo(() => {
    if (!pilesData) return []
    return Object.entries(pilesData.by_length)
      .filter(([, v]) => v > 0)
      .map(([k, v], i) => ({
        name: `${k}м`,
        value: v,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
  }, [pilesData])

  // Bar chart data per section
  const barData = useMemo(() => {
    if (!pilesData) return []
    const vals = mergeSection3(pilesData.by_section)
    return visibleSections.map((i) => ({
      section: `УЧ ${SECTION_LABELS[i]}`,
      fact: vals[i],
    }))
  }, [pilesData, visibleSections])

  // Table rows
  const tableRows = useMemo(() => {
    if (!pilesData) return []
    return [
      { metric: 'Всего забито', values: sectionValues, total: pilesData.total_driven },
      ...Object.entries(pilesData.by_length).map(([k, v]) => {
        // We don't have per-section breakdown by length from API, so show total only
        return { metric: `Сваи ${k}м`, values: null as number[] | null, total: v }
      }),
      { metric: 'Пробные сваи', values: null, total: pilesData.test_piles },
      { metric: 'Сварка', values: null, total: pilesData.welding },
      { metric: 'Площадки', values: null, total: pilesData.platforms },
      { metric: 'Динамические испытания', values: null, total: pilesData.dynamic_tests },
    ]
  }, [pilesData, sectionValues])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Забивка свай
        </h2>
        <div className="animate-pulse bg-bg-card rounded-xl border border-border h-48" />
      </section>
    )
  }

  if (!pilesData) return null

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4 flex items-center gap-2">
        Забивка свай
        <span className="relative inline-flex items-center ml-1 cursor-help group">
          <Info className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-red transition-colors" />
          <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
            w-64 bg-white border border-border rounded-lg shadow-lg
            px-3 py-2 text-xs text-text-secondary leading-relaxed
            pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
            Источник: daily_work_items + pile_fields / Погружение свай, испытания, сварка
          </span>
        </span>
      </h2>

      {/* Summary table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface">
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted whitespace-nowrap">
                  Показатель
                </th>
                {tableRows[0]?.values && visibleSections.map((i) => (
                  <th key={i} className="px-3 py-3 text-center text-xs font-medium text-text-muted">
                    УЧ {SECTION_LABELS[i]}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-text-primary">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.metric} className="border-b border-border/50">
                  <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap text-xs">
                    {row.metric}
                  </td>
                  {row.values && visibleSections.map((i) => (
                    <td key={i} className="px-3 py-2.5 text-center font-mono text-xs">
                      {row.values![i] === 0
                        ? <span className="text-text-muted">&mdash;</span>
                        : fmt(row.values![i])
                      }
                    </td>
                  ))}
                  {!row.values && tableRows[0]?.values && visibleSections.map((i) => (
                    <td key={i} className="px-3 py-2.5 text-center font-mono text-xs text-text-muted">
                      &mdash;
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center font-mono text-xs font-semibold bg-bg-surface">
                    {fmt(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Donut chart */}
        {donutData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-bg-card rounded-xl p-5 border border-border shadow-sm"
          >
            <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
              Распределение по длине свай
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={2}
                  stroke="none"
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{
                    background: '#ffffff', border: '1px solid #e5e5e5',
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {/* Bar chart: per-section piles */}
        {barData.length > 0 && barData.some((d) => d.fact > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-bg-card rounded-xl p-5 border border-border shadow-sm"
          >
            <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
              Забито свай по участкам
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: '#737373', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e5e5' }}
                />
                <YAxis
                  type="category"
                  dataKey="section"
                  tick={{ fill: '#171717', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: '#ffffff', border: '1px solid #e5e5e5',
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Bar dataKey="fact" name="Факт" fill="#dc2626" radius={[0, 2, 2, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {/* If no donut and no bar, show a summary card instead */}
        {donutData.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-bg-card rounded-xl p-5 border border-border shadow-sm col-span-full"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-text-muted mb-1">Всего забито</div>
                <div className="text-xl font-bold font-mono text-text-primary">{fmt(pilesData.total_driven)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Пробные сваи</div>
                <div className="text-xl font-bold font-mono text-text-primary">{fmt(pilesData.test_piles)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Динамические испытания</div>
                <div className="text-xl font-bold font-mono text-text-primary">{fmt(pilesData.dynamic_tests)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Сварка / Площадки</div>
                <div className="text-xl font-bold font-mono text-text-primary">
                  {fmt(pilesData.welding)} / {fmt(pilesData.platforms)}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  )
}
