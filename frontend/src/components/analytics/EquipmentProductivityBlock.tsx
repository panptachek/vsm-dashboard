import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
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

interface EquipmentProductivityBlockProps {
  from: string
  to: string
}

function kiColor(ki: number): string {
  if (ki < 0.5) return '#ef4444'
  if (ki <= 0.8) return '#f59e0b'
  return '#22c55e'
}

// Fixed order: Самосвалы → Экскаваторы → Бульдозеры → Прочие
const TYPE_ORDER = ['dump_truck', 'excavator', 'bulldozer']

function mergeEquipmentSections(sections: EquipmentSection[]): EquipmentSection[] {
  const byNum: Record<number, EquipmentSection> = {}

  for (const s of sections) {
    let num: number
    try {
      num = sectionCodeToNumber(s.section)
    } catch {
      continue
    }

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

  for (const entry of Object.values(byNum)) {
    const total = entry.fact_day + entry.fact_night
    const cap = Math.max(entry.plan_day + entry.plan_night, total) || total
    entry.ki = cap > 0 ? +(total / cap).toFixed(2) : 0
  }

  return [1, 2, 3, 4, 5, 6, 7, 8].map((n) => byNum[n] || {
    section: `УЧ ${n}`, plan_day: 0, fact_day: 0,
    plan_night: 0, fact_night: 0, ki: 0, hired: 0,
  })
}

function getTooltipContent(typeKey: string): string {
  if (typeKey === 'dump_truck') {
    return `Процент выполнения нормы.\n\nФормула: Фактическая выработка за сутки \u00F7 (Фактическое кол-во машин \u00D7 Норматив \u00D7 2 смены)\n\nНорматив: ${NORMS.dumpTruck.perTripM3} м\u00B3 за рейс \u00D7 плановое кол-во рейсов в смену\n\nПример: 2 620 м\u00B3 \u00F7 (13 машин \u00D7 16 \u00D7 6 \u00D7 2) = 10.5%`
  }
  if (typeKey === 'excavator') {
    return `Процент выполнения нормы.\n\nФормула: Фактическая выработка за сутки \u00F7 (Фактическое кол-во машин \u00D7 Норматив \u00D7 2 смены)\n\nНорматив: выемка ${NORMS.excavator.excavationM3PerShift} м\u00B3/смена, грунт ${NORMS.excavator.soilM3PerShift} м\u00B3/смена`
  }
  if (typeKey === 'bulldozer') {
    return `Процент выполнения нормы.\n\nФормула: Фактическая выработка за сутки \u00F7 (Фактическое кол-во машин \u00D7 Норматив \u00D7 2 смены)\n\nНорматив: выемка ${NORMS.bulldozer.excavationM3PerShift} м\u00B3/смена, грунт ${NORMS.bulldozer.soilM3PerShift} м\u00B3/смена`
  }
  return 'Ки = Факт / План'
}

export function EquipmentProductivityBlock({ from, to }: EquipmentProductivityBlockProps) {
  const { data: equipmentData, isLoading } = useQuery({
    queryKey: ['analytics-equipment-v2', from, to],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/equipment?date=${to}`)
      if (!res.ok) return null
      return await res.json() as EquipmentResponse
    },
  })

  const groups = useMemo(() => {
    if (!equipmentData?.types) return []
    const typeMap = new Map(equipmentData.types.map((t) => [t.type, t]))
    const ordered: (EquipmentType & { mergedSections: EquipmentSection[] })[] = []

    // Add in specified order first
    for (const key of TYPE_ORDER) {
      const t = typeMap.get(key)
      if (t) {
        ordered.push({ ...t, mergedSections: mergeEquipmentSections(t.by_section) })
        typeMap.delete(key)
      }
    }
    // Then all remaining as "Прочие"
    for (const [, t] of typeMap) {
      ordered.push({ ...t, mergedSections: mergeEquipmentSections(t.by_section) })
    }

    return ordered
  }, [equipmentData])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Выработка техники
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
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Выработка техники
      </h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {groups.map((group, gi) => {
          const tooltipContent = getTooltipContent(group.type)
          // Compute totals
          const totalHired = group.mergedSections.reduce((s, r) => s + r.hired, 0)

          return (
            <motion.div
              key={group.type}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.05 }}
              className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border bg-bg-surface flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-text-primary flex items-center gap-1.5">
                  {group.label}
                  <span className="relative inline-flex items-center cursor-help group">
                    <Info className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-red transition-colors" />
                    <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
                      w-80 bg-white border border-border rounded-lg shadow-lg
                      px-3 py-2 text-xs text-text-secondary leading-relaxed
                      pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-line">
                      {tooltipContent}
                    </span>
                  </span>
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

              {/* Matrix table: 8 sections + total */}
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
                    {/* Totals */}
                    <tr className="bg-bg-surface font-semibold border-t border-border">
                      <td className="px-4 py-2 text-text-primary text-xs">Всего</td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {group.mergedSections.reduce((s, r) => s + r.plan_day, 0) || <span className="text-text-muted">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {group.mergedSections.reduce((s, r) => s + r.fact_day, 0) || <span className="text-text-muted">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {group.mergedSections.reduce((s, r) => s + r.plan_night, 0) || <span className="text-text-muted">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {group.mergedSections.reduce((s, r) => s + r.fact_night, 0) || <span className="text-text-muted">&mdash;</span>}
                      </td>
                      <td
                        className="px-3 py-2 text-center font-mono text-xs font-semibold"
                        style={{ color: kiColor(group.ki_total) }}
                      >
                        {group.ki_total.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs">{totalHired || <span className="text-text-muted">&mdash;</span>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
