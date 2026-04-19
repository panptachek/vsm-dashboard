import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Calendar, FileText } from 'lucide-react'
import { QUARRIES_BY_SECTION } from '../constants/quarries'
import { QuarryReportTable } from '../components/quarry-report/QuarryReportTable'
import { GroupTotalRow } from '../components/quarry-report/GroupTotalRow'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuarryReportRow {
  category: string
  quarry: string
  armKm: number
  planTrips: number
  techDay: number
  techNight: number
  outputDay: number
  outputNight: number
  outputTotal: number
}

export interface SectionReport {
  sectionNumber: number
  rows: QuarryReportRow[]
}

// Row categories per spec
const ROW_CATEGORIES = [
  'в накопитель',
  'в земполотно с накопителя',
  'песок из выемки в земполотно',
  'песок из выемки в накопитель',
  'завоз песка наёмным транспортом',
  'ЩПГС в накопитель (наёмный транспорт)',
  'ЩПГС в конструктив',
  'Перевозка',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${yyyy}-${mm}-${dd}`
}

function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU')
}

function sumField(rows: QuarryReportRow[], field: keyof QuarryReportRow): number {
  return rows.reduce((acc, r) => acc + (typeof r[field] === 'number' ? (r[field] as number) : 0), 0)
}

// ---------------------------------------------------------------------------
// Build mock data from quarries constant (used when API returns no data)
// ---------------------------------------------------------------------------

function buildMockSections(): SectionReport[] {
  const sections: SectionReport[] = []
  for (let n = 1; n <= 8; n++) {
    const quarries = QUARRIES_BY_SECTION[n] ?? []
    const rows: QuarryReportRow[] = []
    for (const cat of ROW_CATEGORIES) {
      const q = quarries.length > 0 ? quarries[rows.length % quarries.length] : { name: '\u2014', armKm: 0 }
      rows.push({
        category: cat,
        quarry: q.name,
        armKm: q.armKm,
        planTrips: 0,
        techDay: 0,
        techNight: 0,
        outputDay: 0,
        outputNight: 0,
        outputTotal: 0,
      })
    }
    sections.push({ sectionNumber: n, rows })
  }
  return sections
}

// ---------------------------------------------------------------------------
// API data transformation
// ---------------------------------------------------------------------------

function transformApiData(apiData: Record<string, unknown>[] | null, sectionNumber: number): QuarryReportRow[] {
  if (!apiData || !Array.isArray(apiData) || apiData.length === 0) return []

  const quarries = QUARRIES_BY_SECTION[sectionNumber] ?? []
  const rows: QuarryReportRow[] = []

  for (const cat of ROW_CATEGORIES) {
    const q = quarries.length > 0 ? quarries[rows.length % quarries.length] : { name: '\u2014', armKm: 0 }
    const match = apiData.find((d: Record<string, unknown>) => d.category === cat)
    if (match) {
      rows.push({
        category: cat,
        quarry: (match.quarry as string) || q.name,
        armKm: (match.arm_km as number) || q.armKm,
        planTrips: (match.plan_trips as number) || 0,
        techDay: (match.tech_day as number) || 0,
        techNight: (match.tech_night as number) || 0,
        outputDay: (match.output_day as number) || 0,
        outputNight: (match.output_night as number) || 0,
        outputTotal: (match.output_total as number) || 0,
      })
    } else {
      rows.push({
        category: cat,
        quarry: q.name,
        armKm: q.armKm,
        planTrips: 0,
        techDay: 0,
        techNight: 0,
        outputDay: 0,
        outputNight: 0,
        outputTotal: 0,
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Section codes mapping
// ---------------------------------------------------------------------------

function sectionNumberToApiCodes(n: number): string[] {
  if (n === 3) return ['UCH_31', 'UCH_32']
  return [`UCH_${n}`]
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DailyQuarryReport() {
  const [searchParams, setSearchParams] = useSearchParams()

  const yesterday = formatDate(new Date(Date.now() - 86400000))
  const dateParam = searchParams.get('date') ?? yesterday

  const setDate = (d: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('date', d)
      return next
    })
  }

  // Fetch data for all sections
  const { data: apiSections, isLoading } = useQuery({
    queryKey: ['quarry-report', dateParam],
    queryFn: async () => {
      const results: SectionReport[] = []
      for (let n = 1; n <= 8; n++) {
        const codes = sectionNumberToApiCodes(n)
        try {
          const res = await fetch(
            `/api/dashboard/analytics/quarries?date=${dateParam}&section=${codes.join(',')}`
          )
          if (res.ok) {
            const json = await res.json()
            const apiRows = json.quarries || json.data || json
            const rows = transformApiData(
              Array.isArray(apiRows) ? apiRows : null,
              n
            )
            results.push({ sectionNumber: n, rows })
          } else {
            results.push({ sectionNumber: n, rows: [] })
          }
        } catch {
          results.push({ sectionNumber: n, rows: [] })
        }
      }
      return results
    },
    staleTime: 60_000,
  })

  // Fall back to mock structure when API returns empty
  const sections = useMemo(() => {
    if (!apiSections) return buildMockSections()
    return apiSections.map((s) => ({
      ...s,
      rows: s.rows.length > 0 ? s.rows : buildMockSections().find((m) => m.sectionNumber === s.sectionNumber)!.rows,
    }))
  }, [apiSections])

  // Group totals: pairs (1+2), (3+4), (5+6), (7+8)
  const groupPairs: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8]]

  const groupTotals = useMemo(() => {
    return groupPairs.map(([a, b]) => {
      const sa = sections.find((s) => s.sectionNumber === a)
      const sb = sections.find((s) => s.sectionNumber === b)
      const allRows = [...(sa?.rows ?? []), ...(sb?.rows ?? [])]
      return {
        label: `Итого по ${a} и ${b} участкам`,
        outputDay: sumField(allRows, 'outputDay'),
        outputNight: sumField(allRows, 'outputNight'),
        outputTotal: sumField(allRows, 'outputTotal'),
        techDay: sumField(allRows, 'techDay'),
        techNight: sumField(allRows, 'techNight'),
      }
    })
  }, [sections])

  // Grand total
  const grandTotal = useMemo(() => {
    const allRows = sections.flatMap((s) => s.rows)
    return {
      outputDay: sumField(allRows, 'outputDay'),
      outputNight: sumField(allRows, 'outputNight'),
      outputTotal: sumField(allRows, 'outputTotal'),
      techDay: sumField(allRows, 'techDay'),
      techNight: sumField(allRows, 'techNight'),
    }
  }, [sections])

  const [pdfLoading, setPdfLoading] = useState(false)

  const handleCreatePdf = async () => {
    setPdfLoading(true)
    try {
      const res = await fetch('/api/pdf/quarry-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateParam }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `VSM_Суточный_${dateParam}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Ошибка генерации PDF: ${e}`)
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header bar */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-border px-4 sm:px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-heading font-bold text-text-primary">
            Информация по производительности автосамосвалов
          </h1>

          <div className="flex items-center gap-2 ml-auto">
            <Calendar className="w-4 h-4 text-text-muted" />
            <input
              type="date"
              value={dateParam}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-mono border border-border
                         bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-burg"
            />
            <span className="text-sm text-text-muted font-mono">
              ({displayDate(dateParam)})
            </span>
          </div>

          <button
            onClick={handleCreatePdf}
            disabled={pdfLoading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                       bg-accent-red text-white hover:bg-accent-dark flex items-center gap-2 shadow-sm
                       disabled:opacity-50 disabled:cursor-wait"
          >
            <FileText className="w-4 h-4" />
            {pdfLoading ? 'Генерируем...' : 'Создать PDF'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 pb-24 lg:pb-6 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-accent-red border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {sections.map((section, sIdx) => {
          const pairIndex = groupPairs.findIndex(
            ([, b]) => section.sectionNumber === b
          )

          return (
            <div key={section.sectionNumber}>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: sIdx * 0.04, duration: 0.3 }}
              >
                <QuarryReportTable
                  sectionNumber={section.sectionNumber}
                  rows={section.rows}
                  fmt={fmt}
                />
              </motion.div>

              {/* Group total after second section in each pair */}
              {pairIndex >= 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: (sIdx + 1) * 0.04 }}
                  className="mt-2"
                >
                  <GroupTotalRow
                    label={groupTotals[pairIndex].label}
                    techDay={groupTotals[pairIndex].techDay}
                    techNight={groupTotals[pairIndex].techNight}
                    outputDay={groupTotals[pairIndex].outputDay}
                    outputNight={groupTotals[pairIndex].outputNight}
                    outputTotal={groupTotals[pairIndex].outputTotal}
                    fmt={fmt}
                  />
                </motion.div>
              )}
            </div>
          )
        })}

        {/* Grand total */}
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <GroupTotalRow
              label={'\u0418\u0422\u041E\u0413\u041E \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u0440\u0430\u0431\u043E\u0442 (\u0441\u0432\u043E\u0438\u043C\u0438 \u0441\u0438\u043B\u0430\u043C\u0438)'}
              techDay={grandTotal.techDay}
              techNight={grandTotal.techNight}
              outputDay={grandTotal.outputDay}
              outputNight={grandTotal.outputNight}
              outputTotal={grandTotal.outputTotal}
              fmt={fmt}
              isGrand
            />
          </motion.div>
        )}
      </div>
    </div>
  )
}
