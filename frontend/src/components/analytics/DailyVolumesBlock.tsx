import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Info } from 'lucide-react'

interface DailyVolumesBlockProps {
  from: string
  to: string
}

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

interface PilesResponse {
  total_driven: number
  by_length: Record<string, number>
  by_section: Record<string, number>
  test_piles: number
  welding: number
  platforms: number
  dynamic_tests: number
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
  [key: string]: SummaryCategory | string
}

const SECTION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8']

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

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

interface TooltipProps {
  source: string
  formula: string
}

function MetricTooltip({ source, formula }: TooltipProps) {
  return (
    <span className="relative inline-flex items-center ml-1 cursor-help group">
      <Info className="w-3 h-3 text-text-muted group-hover:text-accent-red transition-colors" />
      <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
        w-72 bg-white border border-border rounded-lg shadow-lg
        px-3 py-2 text-xs text-text-secondary leading-relaxed
        pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-line">
        <strong>Источник:</strong> {source}{'\n'}
        <strong>Формула:</strong> {formula}
      </span>
    </span>
  )
}

interface TableRow {
  label: string
  values: number[]
  total: number
  isSubRow?: boolean
  tooltip?: TooltipProps
}

export function DailyVolumesBlock({ from, to }: DailyVolumesBlockProps) {
  // Fetch materials (sand + shpgs with sub-rows)
  const { data: materialsData, isLoading: loadingMaterials } = useQuery({
    queryKey: ['analytics-materials-daily', from, to],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/materials?date=${to}&period=day`)
      if (!res.ok) return null
      return await res.json() as { rows: MaterialsRow[] }
    },
  })

  // Fetch per-section summary for excavation, PRS
  const { data: summaryData, isLoading: loadingSummary } = useQuery({
    queryKey: ['analytics-summary-daily', from, to],
    queryFn: async () => {
      const sections = ['UCH_1', 'UCH_2', 'UCH_31', 'UCH_32', 'UCH_4', 'UCH_5', 'UCH_6', 'UCH_7', 'UCH_8']
      const results = await Promise.all(
        sections.map(async (code) => {
          try {
            const res = await fetch(`/api/dashboard/analytics/summary?section=${code}&date=${to}`)
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
  })

  // Fetch piles
  const { data: pilesData, isLoading: loadingPiles } = useQuery({
    queryKey: ['analytics-piles-daily', from, to],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/piles?date=${to}`)
      if (!res.ok) return null
      return await res.json() as PilesResponse
    },
  })

  // Build per-section excavation / PRS values
  const excavationBySection = useMemo(() => {
    const vals = new Array(8).fill(0)
    if (!summaryData) return vals
    for (const item of summaryData) {
      let idx: number
      if (item.code === 'UCH_31' || item.code === 'UCH_32') {
        idx = 2
      } else {
        const m = item.code.match(/UCH_(\d)/)
        if (!m) continue
        idx = parseInt(m[1], 10) - 1
      }
      vals[idx] += (item.data.excavation?.fact ?? 0)
    }
    return vals
  }, [summaryData])

  const prsBySection = useMemo(() => {
    const vals = new Array(8).fill(0)
    if (!summaryData) return vals
    for (const item of summaryData) {
      let idx: number
      if (item.code === 'UCH_31' || item.code === 'UCH_32') {
        idx = 2
      } else {
        const m = item.code.match(/UCH_(\d)/)
        if (!m) continue
        idx = parseInt(m[1], 10) - 1
      }
      vals[idx] += (item.data.prs?.fact ?? 0)
    }
    return vals
  }, [summaryData])

  // Build all table rows
  const tableRows = useMemo(() => {
    const rows: TableRow[] = []

    // Sand rows from materials
    const sandRow = materialsData?.rows?.find(r => r.type === 'sand')
    if (sandRow) {
      const vals = mergeSection3(sandRow.by_section)
      rows.push({
        label: 'Завоз песка',
        values: vals,
        total: vals.reduce((a, b) => a + b, 0),
        tooltip: { source: 'material_movements (SAND)', formula: 'SUM(volume) WHERE material=SAND' },
      })
      for (const sub of sandRow.sub_rows ?? []) {
        const subLabel = sub.label === 'день' ? 'Свои (день)' :
          sub.label === 'ночь' ? 'Свои (ночь)' :
          sub.label === 'наёмники' ? 'Наёмники' :
          sub.label === 'в накопитель' ? 'В накопитель' :
          sub.label === 'из накопителя' ? 'Из накопителя' : sub.label
        const subVals = mergeSection3(sub.by_section)
        rows.push({
          label: subLabel,
          values: subVals,
          total: subVals.reduce((a, b) => a + b, 0),
          isSubRow: true,
        })
      }
    }

    // SHPGS rows
    const shpgsRow = materialsData?.rows?.find(r => r.type === 'shps')
    if (shpgsRow) {
      const vals = mergeSection3(shpgsRow.by_section)
      rows.push({
        label: 'Завоз ЩПГС',
        values: vals,
        total: vals.reduce((a, b) => a + b, 0),
        tooltip: { source: 'material_movements (SHPGS)', formula: 'SUM(volume) WHERE material=SHPGS' },
      })
      for (const sub of shpgsRow.sub_rows ?? []) {
        const subLabel = sub.label === 'наёмники' ? 'Наёмники' : sub.label
        const subVals = mergeSection3(sub.by_section)
        rows.push({
          label: subLabel,
          values: subVals,
          total: subVals.reduce((a, b) => a + b, 0),
          isSubRow: true,
        })
      }
    }

    // Excavation
    rows.push({
      label: 'Устройство выемки',
      values: excavationBySection,
      total: excavationBySection.reduce((a, b) => a + b, 0),
      tooltip: { source: 'daily_work_items (EARTH_EXCAVATION)', formula: 'SUM(volume) WHERE wt=EARTH_EXCAVATION' },
    })

    // PRS
    rows.push({
      label: 'Снятие ПРС',
      values: prsBySection,
      total: prsBySection.reduce((a, b) => a + b, 0),
      tooltip: { source: 'daily_work_items (PRS/*)', formula: 'SUM(volume) WHERE category=prs' },
    })

    // Piles
    if (pilesData) {
      const pileVals = mergeSection3(pilesData.by_section)
      rows.push({
        label: 'Основные сваи',
        values: pileVals,
        total: pilesData.total_driven,
        tooltip: { source: 'daily_work_items (PILE_FIELD)', formula: 'SUM(volume) WHERE constructive=PILE_FIELD' },
      })
      // By length sub-rows
      for (const [len, count] of Object.entries(pilesData.by_length)) {
        if (count > 0) {
          rows.push({
            label: `${len}м`,
            values: new Array(8).fill(0), // per-section not available by length
            total: count,
            isSubRow: true,
          })
        }
      }
      rows.push({
        label: 'Пробные сваи',
        values: new Array(8).fill(0),
        total: pilesData.test_piles,
        tooltip: { source: 'pile_fields (field_type=test)', formula: 'SUM(pile_count)' },
      })
      rows.push({
        label: 'Испытания',
        values: new Array(8).fill(0),
        total: pilesData.dynamic_tests,
        tooltip: { source: 'pile_fields.dynamic_test_count', formula: 'SUM(dynamic_test_count)' },
      })
    }

    return rows
  }, [materialsData, excavationBySection, prsBySection, pilesData])

  const isLoading = loadingMaterials || loadingSummary || loadingPiles

  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
          Основные объёмы за день
        </h2>
        <div className="animate-pulse bg-bg-card rounded-xl border border-border h-64" />
      </section>
    )
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Основные объёмы за день
      </h2>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface">
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted whitespace-nowrap min-w-[180px]">
                  Показатель
                </th>
                {SECTION_LABELS.map((s) => (
                  <th key={s} className="px-3 py-3 text-center text-xs font-medium text-text-muted min-w-[70px]">
                    УЧ {s}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-text-primary min-w-[80px]">
                  Всего
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, idx) => (
                <tr
                  key={`${row.label}-${idx}`}
                  className={`border-b ${row.isSubRow ? 'border-border/30' : 'border-border/50'}`}
                >
                  <td className={`px-4 py-2 whitespace-nowrap text-xs ${
                    row.isSubRow
                      ? 'pl-8 text-text-muted font-normal'
                      : 'font-medium text-text-primary'
                  }`}>
                    <span className="flex items-center gap-0.5">
                      {row.label}
                      {row.tooltip && (
                        <MetricTooltip source={row.tooltip.source} formula={row.tooltip.formula} />
                      )}
                    </span>
                  </td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`px-3 py-2 text-center font-mono text-xs ${
                      row.isSubRow ? 'text-text-muted' : ''
                    }`}>
                      {v === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(v)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-center font-mono text-xs font-semibold bg-bg-surface">
                    {row.total === 0 ? <span className="text-text-muted">&mdash;</span> : fmt(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </section>
  )
}
