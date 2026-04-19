import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { sectionCodeToNumber } from '../../lib/sections'
import { NORMS } from '../../constants/productivity-norms'

interface EquipmentSection {
  section: string
  plan_day: number
  fact_day: number
  plan_night: number
  fact_night: number
  ki: number
  hired: number
}

interface EquipmentType {
  type: string
  label: string
  ki_total: number
  by_section: EquipmentSection[]
  quarries: { name: string; distance_km: number; trips_per_unit: number }[]
}

interface EquipmentResponse {
  types: EquipmentType[]
}

interface EquipmentBlockProps {
  selectedSections: Set<number>
  date: string
}


function kiColor(ki: number): string {
  if (ki < 0.5) return '#ef4444'
  if (ki <= 0.8) return '#f59e0b'
  return '#22c55e'
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' as const },
  }),
}

/** Merge UCH_31+UCH_32 rows into a single "section 3" row */
function mergeEquipmentSections(
  sections: EquipmentSection[],
  filter: Set<number>,
): EquipmentSection[] {
  const byNum: Record<number, EquipmentSection> = {}

  for (const s of sections) {
    let num: number
    try {
      num = sectionCodeToNumber(s.section)
    } catch {
      continue
    }

    if (filter.size > 0 && !filter.has(num)) continue

    if (!byNum[num]) {
      byNum[num] = {
        section: `УЧ ${num}`,
        plan_day: 0, fact_day: 0,
        plan_night: 0, fact_night: 0,
        ki: 0, hired: 0,
      }
    }
    byNum[num].plan_day += s.plan_day
    byNum[num].fact_day += s.fact_day
    byNum[num].plan_night += s.plan_night
    byNum[num].fact_night += s.fact_night
    byNum[num].hired += s.hired
  }

  // Recompute ki
  for (const entry of Object.values(byNum)) {
    const total = entry.fact_day + entry.fact_night
    const cap = Math.max(entry.plan_day + entry.plan_night, total) || total
    entry.ki = cap > 0 ? +(total / cap).toFixed(2) : 0
  }

  const nums = filter.size > 0 ? Array.from(filter).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7, 8]
  return nums.map((n) => byNum[n] || {
    section: `УЧ ${n}`, plan_day: 0, fact_day: 0,
    plan_night: 0, fact_night: 0, ki: 0, hired: 0,
  })
}

function getNormDescription(typeKey: string): string {
  if (typeKey === 'dump_truck' || typeKey.includes('самосвал')) {
    return `Норма: ${NORMS.dumpTruck.perTripM3} м\u00B3/рейс. % = Факт / (Кол-во x 16 x План_рейсов x 2)`
  }
  if (typeKey === 'excavator' || typeKey.includes('экскаватор')) {
    return `Норма: ${NORMS.excavator.excavationM3PerShift}/${NORMS.excavator.soilM3PerShift} м\u00B3/смена. % = Факт / (Кол-во x Норма x 2)`
  }
  if (typeKey === 'bulldozer' || typeKey.includes('бульдозер')) {
    return `Норма: ${NORMS.bulldozer.excavationM3PerShift}/${NORMS.bulldozer.soilM3PerShift} м\u00B3/смена. % = Факт / (Кол-во x Норма x 2)`
  }
  return 'Ки = Факт / План'
}

export function EquipmentBlock({ selectedSections, date }: EquipmentBlockProps) {
  // Fetch all sections, filter client-side via mergeEquipmentSections
  const { data: equipmentData, isLoading } = useQuery({
    queryKey: ['analytics-equipment', date],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/equipment?date=${date}`)
      if (!res.ok) return null
      return await res.json() as EquipmentResponse
    },
  })

  const groups = useMemo(() => {
    if (!equipmentData?.types) return []
    return equipmentData.types.map((t) => ({
      ...t,
      mergedSections: mergeEquipmentSections(t.by_section, selectedSections),
    }))
  }, [equipmentData, selectedSections])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Производительность техники
        </h2>
        <div className="animate-pulse grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-bg-card rounded-xl border border-border h-64" />
          <div className="bg-bg-card rounded-xl border border-border h-64" />
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4 flex items-center gap-2">
        Производительность техники
        <span className="relative inline-flex items-center ml-1 cursor-help group">
          <Info className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-red transition-colors" />
          <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
            w-64 bg-white border border-border rounded-lg shadow-lg
            px-3 py-2 text-xs text-text-secondary leading-relaxed
            pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
            {"Источник: report_equipment_units / Ки = Факт / План. Норма \u2265 0.8, критично менее 0.5"}
          </span>
        </span>
      </h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {groups.map((group, gi) => {
          const chartData = group.mergedSections.map((s) => ({
            section: s.section,
            plan: s.plan_day + s.plan_night,
            fact: s.fact_day + s.fact_night,
          }))

          return (
            <motion.div
              key={group.type}
              custom={gi}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border bg-bg-surface flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-text-primary">
                  {group.label}
                </h3>
                <span
                  className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                  style={{
                    color: kiColor(group.ki_total),
                    backgroundColor: `${kiColor(group.ki_total)}15`,
                  }}
                >
                  Ки {group.ki_total.toFixed(2)}
                </span>
              </div>

              {/* Norm description */}
              <div className="px-4 py-1.5 text-xs text-text-muted border-b border-border/30">
                {getNormDescription(group.type)}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-xs text-text-muted">
                      <th className="text-left px-4 py-2">Участок</th>
                      <th className="px-3 py-2 text-center">План Д</th>
                      <th className="px-3 py-2 text-center">Факт Д</th>
                      <th className="px-3 py-2 text-center">План Н</th>
                      <th className="px-3 py-2 text-center">Факт Н</th>
                      <th className="px-3 py-2 text-center">Ки</th>
                      <th className="px-3 py-2 text-center">Наём</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.mergedSections.map((row) => {
                      const lowKi = row.ki > 0 && row.ki < 0.5
                      return (
                        <tr
                          key={row.section}
                          className="border-b border-border/30"
                          style={lowKi ? { backgroundColor: 'rgba(239,68,68,0.06)' } : undefined}
                        >
                          <td className="px-4 py-2 font-medium text-text-primary">{row.section}</td>
                          <td className="px-3 py-2 text-center font-mono text-xs">{row.plan_day || <span className="text-text-muted">&mdash;</span>}</td>
                          <td className="px-3 py-2 text-center font-mono text-xs">{row.fact_day || <span className="text-text-muted">&mdash;</span>}</td>
                          <td className="px-3 py-2 text-center font-mono text-xs">{row.plan_night || <span className="text-text-muted">&mdash;</span>}</td>
                          <td className="px-3 py-2 text-center font-mono text-xs">{row.fact_night || <span className="text-text-muted">&mdash;</span>}</td>
                          <td
                            className="px-3 py-2 text-center font-mono text-xs font-semibold"
                            style={{ color: row.ki > 0 ? kiColor(row.ki) : '#737373' }}
                          >
                            {row.ki > 0 ? row.ki.toFixed(2) : <span className="text-text-muted">&mdash;</span>}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-xs">{row.hired || <span className="text-text-muted">&mdash;</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Grouped bar chart */}
              {chartData.some((d) => d.fact > 0 || d.plan > 0) && (
                <div className="p-4 pt-2">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis
                        dataKey="section"
                        tick={{ fill: '#737373', fontSize: 10 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e5e5' }}
                      />
                      <YAxis
                        tick={{ fill: '#737373', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e5e5' }}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: '#ffffff', border: '1px solid #e5e5e5',
                          borderRadius: 8, fontSize: 12,
                        }}
                      />
                      <Bar dataKey="plan" name="План" fill="#d4d4d4" radius={[2, 2, 0, 0]} barSize={16} />
                      <Bar dataKey="fact" name="Факт" fill="#dc2626" radius={[2, 2, 0, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
