/**
 * Блок «Производительность техники». Тултип на hover — прозрачная
 * методика расчёта с подставленными числами (formula_human из API).
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Wrench, Info } from 'lucide-react'

interface EquipRow {
  section_code: string
  equipment_type: string
  units: number
  trips: number
  fact_volume: number
  avg_trip_volume: number
  norm_per_unit: number
  norm_total: number
  days: number
  shifts: number
  percent: number
  formula_human: string
}

const TYPE_LABEL: Record<string, string> = {
  dump_truck: 'Самосвалы',
  excavator:  'Экскаваторы',
  bulldozer:  'Бульдозеры',
  loader:     'Погрузчики',
  grader:     'Грейдеры',
  roller:     'Катки',
  crane:      'Краны',
  pile_driver:'Копры',
}

function pctColor(p: number): string {
  if (p >= 85) return '#16a34a'
  if (p >= 60) return '#f59e0b'
  return '#dc2626'
}

function sectionLabel(code: string): string {
  if (code === 'UCH_31' || code === 'UCH_32') return 'Участок №3'
  const m = code.match(/UCH_(\d)/)
  return m ? `Участок №${m[1]}` : code
}

export function EquipmentBlock({ from, to }: { from: string; to: string; view: string }) {
  const { data, isLoading } = useQuery<{ rows: EquipRow[] }>({
    queryKey: ['wip', 'equipment', from, to],
    queryFn: () => fetch(`/api/wip/equipment-productivity?from=${from}&to=${to}`).then(r => r.json()),
  })

  const grouped = useMemo(() => {
    const g: Record<string, EquipRow[]> = {}
    for (const r of data?.rows ?? []) {
      const k = r.equipment_type
      ;(g[k] ??= []).push(r)
    }
    // Порядок как в плане: самосвалы → экскаваторы → бульдозеры → остальное
    const order = ['dump_truck','excavator','bulldozer']
    const keys = Object.keys(g).sort((a,b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    return { keys, g }
  }, [data])

  if (isLoading || !data) {
    return <div className="bg-bg-card border border-border rounded-xl p-5 h-40 animate-pulse" />
  }

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Wrench className="w-5 h-5 text-accent-red" />
        <h2 className="font-heading font-bold text-lg">Производительность техники</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          {data.rows[0]?.days ?? 0} дн. × 2 смены
        </span>
      </div>

      <div className="space-y-5">
        {grouped.keys.map(k => (
          <EquipGroup key={k} type={k} rows={grouped.g[k]} />
        ))}
        {grouped.keys.length === 0 && (
          <div className="text-sm text-text-muted py-8 text-center">
            Нет данных за выбранный период.
          </div>
        )}
      </div>
    </section>
  )
}

function EquipGroup({ type, rows }: { type: string; rows: EquipRow[] }) {
  const totalFact = rows.reduce((s,r) => s + r.fact_volume, 0)
  const totalNorm = rows.reduce((s,r) => s + r.norm_total, 0)
  const pct = totalNorm > 0 ? (totalFact / totalNorm * 100) : 0

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-heading font-semibold text-sm uppercase tracking-wider">
          {TYPE_LABEL[type] ?? type}
        </h3>
        <span className="ml-auto font-mono text-sm font-bold" style={{ color: pctColor(pct) }}>
          {pct.toFixed(1)}%
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {rows.sort((a,b) => a.section_code.localeCompare(b.section_code)).map(r => (
          <SectionTile key={r.section_code} row={r} />
        ))}
      </div>
    </div>
  )
}

function SectionTile({ row }: { row: EquipRow }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative border border-border rounded-lg p-3 bg-white hover:border-accent-red/40 transition cursor-default"
         onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold">{sectionLabel(row.section_code)}</span>
        <Info className="w-3 h-3 text-text-muted" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-bold" style={{ color: pctColor(row.percent) }}>
          {row.percent.toFixed(1)}%
        </span>
        <span className="text-[10px] text-text-muted">от нормы</span>
      </div>
      <div className="mt-1 text-[10px] font-mono text-text-muted">
        {row.units} ед. · {Math.round(row.fact_volume).toLocaleString('ru-RU')} м³
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 p-3 bg-[#1a1a1a] text-white rounded-lg shadow-xl text-[11px] leading-snug">
          <div className="font-semibold mb-1 text-accent-red uppercase tracking-wider">Методика</div>
          <div className="text-neutral-300 mb-2">
            Факт ÷ (ед. × норма × дни × смены)
          </div>
          <div className="font-mono text-white">{row.formula_human}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-neutral-400">
            <span>Рейсов:</span><span className="text-white text-right">{row.trips}</span>
            <span>Ср. рейс:</span><span className="text-white text-right">{row.avg_trip_volume.toFixed(1)} м³</span>
            <span>Норма/ед:</span><span className="text-white text-right">{row.norm_per_unit}</span>
            <span>Норма итого:</span><span className="text-white text-right">{Math.round(row.norm_total).toLocaleString('ru-RU')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
