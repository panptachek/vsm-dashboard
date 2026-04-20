/**
 * Блок «Возка песка/ЩПГС». Матрица участок × карьер × подрядчик.
 * Подрядчики группируем: own (ЖДС) / АЛМАЗ / прочие subcontractors.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Truck } from 'lucide-react'

interface Row {
  section_code: string
  material: 'SAND' | 'SHPGS' | string
  quarry_id: string | null
  quarry_name: string | null
  contractor_id: string | null
  contractor_name: string | null
  contractor_short: string | null
  contractor_kind: 'own' | 'subcontractor' | 'supplier'
  volume: number
  trips: number
}

type LaborBucket = 'own' | 'almaz' | 'other_hired'

const BUCKET_COLOR: Record<LaborBucket, string> = {
  own: '#1a1a1a',
  almaz: '#dc2626',
  other_hired: '#7f1d1d',
}
const BUCKET_LABEL: Record<LaborBucket, string> = {
  own: 'Свои силы',
  almaz: 'АЛМАЗ',
  other_hired: 'Прочие наёмники',
}

function bucketOf(r: Row): LaborBucket {
  if (r.contractor_kind === 'own') return 'own'
  if (r.contractor_short?.toUpperCase() === 'АЛМАЗ') return 'almaz'
  return 'other_hired'
}

function sectionLabel(code: string): string {
  if (code === 'UCH_31' || code === 'UCH_32') return 'Участок №3'
  const m = code.match(/UCH_(\d)/)
  return m ? `Участок №${m[1]}` : code
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function MaterialFlowBlock({
  from, to, view: _v,
}: { from: string; to: string; view: 'table'|'cards'|'timeline' }) {
  const { data, isLoading } = useQuery<{ rows: Row[] }>({
    queryKey: ['wip', 'material-flow', from, to],
    queryFn: () => fetch(`/api/wip/material-flow?from=${from}&to=${to}`).then(r => r.json()),
  })

  // Агрегаты
  const { matrix, totals, quarries } = useMemo(() => {
    const rows = data?.rows ?? []
    const matrix: Record<string, Record<string, Record<LaborBucket, number>>> = {}
    const quarryTotal: Record<string, number> = {}
    const totalsBySec: Record<string, number> = {}
    for (const r of rows) {
      const sec = sectionLabel(r.section_code)
      const q = r.quarry_name ?? '—'
      const b = bucketOf(r)
      matrix[sec] ??= {}
      matrix[sec][q] ??= { own: 0, almaz: 0, other_hired: 0 }
      matrix[sec][q][b] += r.volume
      quarryTotal[q] = (quarryTotal[q] || 0) + r.volume
      totalsBySec[sec] = (totalsBySec[sec] || 0) + r.volume
    }
    const quarries = Object.entries(quarryTotal)
      .sort((a,b) => b[1] - a[1])
      .map(([name]) => name)
    return { matrix, totals: totalsBySec, quarries }
  }, [data])

  if (isLoading || !data) return <div className="bg-bg-card border border-border rounded-xl p-5 h-40 animate-pulse" />

  const sections = Object.keys(matrix).sort()

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-5 h-5 text-accent-red" />
        <h2 className="font-heading font-bold text-lg">Возка песка и ЩПГС</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          {from} — {to}
        </span>
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {(['own','almaz','other_hired'] as LaborBucket[]).map(b => (
          <span key={b} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
            {BUCKET_LABEL[b]}
          </span>
        ))}
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-muted uppercase tracking-wider">
              <th className="text-left py-2 px-2 font-semibold">Участок</th>
              {quarries.map(q => <th key={q} className="text-right py-2 px-2 font-semibold">{q}</th>)}
              <th className="text-right py-2 px-2 font-semibold">Итого, м³</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(sec => (
              <tr key={sec} className="border-b border-border/60 hover:bg-bg-surface/40">
                <td className="py-2 px-2 font-medium">{sec}</td>
                {quarries.map(q => {
                  const cell = matrix[sec]?.[q]
                  const total = cell ? cell.own + cell.almaz + cell.other_hired : 0
                  if (total === 0) return <td key={q} className="py-2 px-2 text-right text-text-muted">—</td>
                  return (
                    <td key={q} className="py-1 px-2 text-right">
                      <StackedBar cell={cell!} total={total} />
                    </td>
                  )
                })}
                <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(totals[sec] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StackedBar({ cell, total }: {
  cell: Record<LaborBucket, number>; total: number
}) {
  return (
    <div className="inline-flex flex-col items-end min-w-[100px]">
      <div className="flex w-full h-2 rounded-full overflow-hidden bg-bg-surface">
        {(['own','almaz','other_hired'] as LaborBucket[]).map(b => (
          cell[b] > 0 && (
            <div key={b} style={{ width: `${cell[b]/total*100}%`, background: BUCKET_COLOR[b] }}
                 title={`${BUCKET_LABEL[b]}: ${fmt(cell[b])} м³`} />
          )
        ))}
      </div>
      <span className="font-mono text-text-primary mt-0.5">{fmt(total)}</span>
    </div>
  )
}
