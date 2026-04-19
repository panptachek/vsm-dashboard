import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import { QUARRIES_BY_SECTION } from '../../constants/quarries'

interface MaterialsRow {
  type: string
  label: string
  total: number
  by_section: Record<string, number>
  sub_rows: {
    label: string
    total: number
    by_section: Record<string, number>
  }[]
}

interface MaterialsResponse {
  rows: MaterialsRow[]
}

interface SandTransportBlockProps {
  selectedSections: Set<number>
  date: string
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

function heatmapColor(value: number, max: number): string {
  if (value === 0) return '#e5e5e5'
  if (max === 0) return '#ffffff'
  const ratio = Math.min(value / max, 1)
  if (ratio < 0.5) {
    const t = ratio / 0.5
    const r = Math.round(255 - (255 - 245) * t)
    const g = Math.round(255 - (255 - 158) * t)
    const b = Math.round(255 - (255 - 11) * t)
    return `rgb(${r},${g},${b})`
  }
  const t = (ratio - 0.5) / 0.5
  const r = Math.round(245 - (245 - 34) * t)
  const g = Math.round(158 + (197 - 158) * t)
  const b = Math.round(11 + (94 - 11) * t)
  return `rgb(${r},${g},${b})`
}

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

const SECTION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8']

export function SandTransportBlock({ selectedSections, date }: SandTransportBlockProps) {
  // Always fetch all sections; column filtering is done client-side via visibleSections
  const { data: materialsData, isLoading } = useQuery({
    queryKey: ['analytics-materials', date],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/materials?date=${date}`)
      if (!res.ok) return null
      return await res.json() as MaterialsResponse
    },
  })

  const rows = useMemo(() => {
    if (!materialsData?.rows) return []
    return materialsData.rows.filter((r) => r.type === 'sand' || r.type === 'shps')
  }, [materialsData])

  const globalMax = useMemo(() => {
    let mx = 0
    for (const row of rows) {
      const vals = mergeSection3(row.by_section)
      for (const v of vals) if (v > mx) mx = v
    }
    return mx
  }, [rows])

  const visibleSections = useMemo(() => {
    if (selectedSections.size === 0) return [0, 1, 2, 3, 4, 5, 6, 7]
    return Array.from(selectedSections).map((n) => n - 1).sort((a, b) => a - b)
  }, [selectedSections])

  const quarries = useMemo(() => {
    const sectionNums = selectedSections.size === 0
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : Array.from(selectedSections).sort((a, b) => a - b)
    const result: { name: string; armKm: number; section: number }[] = []
    for (const n of sectionNums) {
      const q = QUARRIES_BY_SECTION[n]
      if (q) {
        for (const entry of q) {
          result.push({ ...entry, section: n })
        }
      }
    }
    return result
  }, [selectedSections])

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Возка песка и ЩПГС
        </h2>
        <div className="animate-pulse bg-bg-card rounded-xl border border-border h-48" />
      </section>
    )
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4 flex items-center gap-2">
        Возка песка и ЩПГС
        <span className="relative inline-flex items-center ml-1 cursor-help group">
          <Info className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-red transition-colors" />
          <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
            w-64 bg-white border border-border rounded-lg shadow-lg
            px-3 py-2 text-xs text-text-secondary leading-relaxed
            pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
            Источник: material_movements / Каналы: Свои / Алмаз / Наёмники
          </span>
        </span>
      </h2>

      {/* Materials heatmap table */}
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
                  Материал
                </th>
                {visibleSections.map((i) => (
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
              {rows.map((row) => {
                const vals = mergeSection3(row.by_section)
                return (
                  <React.Fragment key={row.type}>
                    <tr className="border-b border-border/50">
                      <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">
                        {row.label}
                      </td>
                      {visibleSections.map((i) => (
                        <td
                          key={i}
                          className="px-3 py-2.5 text-center font-mono text-xs"
                          style={{ backgroundColor: heatmapColor(vals[i], globalMax) }}
                        >
                          {vals[i] === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(vals[i])}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-center font-mono text-xs font-semibold bg-bg-surface">
                        {fmt(visibleSections.reduce((acc, i) => acc + vals[i], 0))}
                      </td>
                    </tr>
                    {(row.sub_rows || []).map((sub) => {
                      const subVals = mergeSection3(sub.by_section)
                      return (
                        <tr key={`${row.type}-${sub.label}`} className="border-b border-border/30">
                          <td className="px-4 py-2 pl-8 text-text-muted text-xs whitespace-nowrap">
                            {sub.label}
                          </td>
                          {visibleSections.map((i) => (
                            <td
                              key={i}
                              className="px-3 py-2 text-center font-mono text-xs"
                              style={{ backgroundColor: heatmapColor(subVals[i], globalMax) }}
                            >
                              {subVals[i] === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(subVals[i])}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-center font-mono text-xs bg-bg-surface">
                            {fmt(visibleSections.reduce((acc, i) => acc + subVals[i], 0))}
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Quarry reference cards */}
      {quarries.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h3 className="text-sm font-heading font-semibold text-text-primary mb-3">
            Карьеры (плечо подвоза)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
            {quarries.map((q) => (
              <div
                key={`${q.section}-${q.name}`}
                className="bg-bg-card rounded-lg p-3 border border-border shadow-sm text-xs"
              >
                <div className="font-medium text-text-primary truncate">{q.name}</div>
                <div className="text-text-muted mt-1">
                  УЧ {q.section} &middot; {q.armKm} км
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </section>
  )
}
