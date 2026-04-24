/**
 * Блок «Производительность техники» (на вкладке Аналитика).
 * Для каждого типа техники — строка с заголовком + горизонтальная сетка
 * 8 карточек (№1..№8). В тултипе — детализация по видам работ / материалам.
 *
 * Нормы и расчёт — см. WORK_TYPE_NORMS / DUMP_TRUCK_NORMS в wip_routes.py.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { sectionCodeToNumber } from '../../lib/sections'

interface WorkTypeDetail {
  wt_code: string
  wt_name: string
  norm_code: string
  norm_per_shift: number
  norm_unit: string
  fact_volume: number
  days: number
  shifts: number
  avg_units: number
  expected: number
  percent: number | null
}

interface MaterialDetail {
  material: string
  quarry: string | null
  norm_per_shift: number | null
  norm_formula: string | null
  include_pit_to_stockpile: boolean | null
  fact_in_norm: number
  fact_off_norm: number
  trips_in_norm: number
  trips_off_norm: number
  days: number
  shifts: number
  avg_units: number
  expected: number
  percent: number | null
}

interface EquipRow {
  section_code: string
  equipment_type: string
  percent: number | null
  avg_units: number
  work_days_total: number
  work_shifts_total: number
  fact_volume_total_m3: number
  fact_volume_total_m2: number
  by_work_type?: WorkTypeDetail[]
  by_material?: MaterialDetail[]
}

const ORDER = ['самосвал', 'экскаватор', 'бульдозер', 'автогрейдер', 'каток'] as const
type EquipKey = typeof ORDER[number]

const LABEL: Record<EquipKey, string> = {
  'самосвал':    'Самосвал',
  'экскаватор':  'Экскаватор',
  'бульдозер':   'Бульдозер',
  'автогрейдер': 'Автогрейдер',
  'каток':       'Каток',
}

// Иконки техники — используем те же SVG, что и на карте (/public/icons/).
const ICON_SRC: Record<EquipKey, string> = {
  'самосвал':    '/icons/dump_truck.svg',
  'экскаватор':  '/icons/excavator.svg',
  'бульдозер':   '/icons/bulldozer.svg',
  'автогрейдер': '/icons/motor_grader.svg',
  'каток':       '/icons/road_roller.svg',
}

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))
const fmtN = (n: number, d = 1) => nf.format(Number(n.toFixed(d)))

function pctColor(p: number | null): string {
  if (p == null) return '#737373'
  if (p >= 95) return '#16a34a'
  if (p >= 75) return '#f59e0b'
  return '#dc2626'
}

export function EquipmentBlock({ from, to }: { from: string; to: string; view: string }) {
  const { data, isLoading } = useQuery<{ rows: EquipRow[] }>({
    queryKey: ['wip', 'mechanization-aggregates', from, to],
    queryFn: () => fetch(`/api/wip/mechanization/aggregates?from=${from}&to=${to}&bucket=own`).then(r => r.json()),
  })

  const grouped = useMemo(() => {
    const g: Record<string, Record<number, EquipRow>> = {}
    for (const r of data?.rows ?? []) {
      const t = r.equipment_type.toLowerCase()
      g[t] ??= {}
      let n: number
      try { n = sectionCodeToNumber(r.section_code) } catch { continue }
      g[t][n] = r
    }
    return g
  }, [data])

  if (isLoading || !data) {
    return <div className="bg-white border border-border rounded-xl p-5 h-40 animate-pulse" />
  }

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-5">
        <Truck className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading tracking-wide uppercase">
          Производительность техники
        </h2>
        <span className="text-xs text-text-muted">
          факт per-смена · нормы по видам работ · учитываем только смены с фактом и работающей техникой
        </span>
      </div>

      <div className="space-y-6">
        {ORDER.map(key => (
          <EquipRowRow key={key} eqKey={key} bySection={grouped[key] ?? {}} />
        ))}
      </div>
    </section>
  )
}

function EquipRowRow({ eqKey, bySection }: { eqKey: EquipKey; bySection: Record<number, EquipRow> }) {
  const iconSrc = ICON_SRC[eqKey]
  const nums = [1, 2, 3, 4, 5, 6, 7, 8]
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2">
        {iconSrc ? (
          <img src={iconSrc} alt="" className="w-6 h-6 self-center" />
        ) : (
          <Truck className="w-5 h-5 text-text-primary self-center" strokeWidth={2} />
        )}
        <h3 className="font-heading font-semibold text-[12px] uppercase tracking-wider text-text-primary">
          {LABEL[eqKey]}
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {nums.map(n => <SectionCard key={n} num={n} row={bySection[n]} />)}
      </div>
    </div>
  )
}

function SectionCard({ num, row }: { num: number; row: EquipRow | undefined }) {
  const [hover, setHover] = useState(false)
  // Для карточек в правой половине сетки (№5..№8) якорим тултип справа,
  // чтобы не уезжал за границу экрана.
  const anchorRight = num >= 5
  if (!row) {
    return (
      <div className="border border-border rounded-lg p-3 bg-white min-h-[88px] flex flex-col">
        <div className="text-[11px] font-semibold text-text-muted">№{num}</div>
        <div className="mt-auto text-text-muted text-sm">—</div>
      </div>
    )
  }
  const factLabel = row.fact_volume_total_m3 > 0 && row.fact_volume_total_m2 > 0
    ? `${fmt(row.fact_volume_total_m3)} м³ + ${fmt(row.fact_volume_total_m2)} м²`
    : row.fact_volume_total_m3 > 0
      ? `${fmt(row.fact_volume_total_m3)} м³`
      : row.fact_volume_total_m2 > 0
        ? `${fmt(row.fact_volume_total_m2)} м²`
        : '—'

  return (
    <div
      className="relative border border-border rounded-lg p-3 bg-white min-h-[88px] flex flex-col"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="text-[11px] font-semibold text-text-muted">№{num}</div>
      <div
        className="font-heading font-bold leading-none mt-1"
        style={{ color: pctColor(row.percent), fontSize: 30 }}
      >
        {row.percent == null ? '—' : `${Math.round(row.percent)}%`}
      </div>
      <div className="mt-auto text-[10px] font-mono text-text-muted pt-1">
        {factLabel} · {fmtN(row.avg_units, 1)} ед. · {row.work_shifts_total} см.
      </div>

      {hover && (
        <div className={`absolute z-40 top-full mt-1 p-3 bg-[#1a1a1a] text-white rounded-lg shadow-xl text-[11px] leading-snug min-w-[560px] max-w-[min(calc(100vw-40px),920px)] lg:min-w-[720px] ${anchorRight ? 'right-0' : 'left-0'}`}>
          <div className="font-semibold mb-1 text-accent-red uppercase tracking-wider">
            {row.equipment_type} · №{num} · {row.percent == null ? '—' : Math.round(row.percent) + '%'}
          </div>
          {row.by_work_type && row.by_work_type.length > 0 && (
            <WorkTypeTable rows={row.by_work_type} />
          )}
          {row.by_material && row.by_material.length > 0 && (
            <MaterialTable rows={row.by_material} />
          )}
          <div className="text-neutral-400 mt-2 text-[10px]">
            Средний % = усреднение по работам с нормой. Считаются только смены, где был факт и работающая техника данного типа.
          </div>
        </div>
      )}
    </div>
  )
}

function WorkTypeTable({ rows }: { rows: WorkTypeDetail[] }) {
  return (
    <table className="w-full text-[10.5px] font-mono">
      <thead className="text-neutral-400">
        <tr>
          <th className="text-left pb-1">Работа</th>
          <th className="text-right pb-1">Норма/см</th>
          <th className="text-right pb-1">План (ожид.)</th>
          <th className="text-right pb-1">Факт</th>
          <th className="text-right pb-1">См.</th>
          <th className="text-right pb-1">Ед./см</th>
          <th className="text-right pb-1">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(w => (
          <tr key={w.wt_code} className="text-neutral-200 border-t border-neutral-700">
            <td className="text-left py-1 pr-2 text-[10px] leading-tight whitespace-normal break-words max-w-[200px]" title={w.wt_name}>
              {w.wt_name}
            </td>
            <td className="text-right py-1">{fmt(w.norm_per_shift)} {w.norm_unit}</td>
            <td className="text-right py-1 whitespace-nowrap">
              <div>{w.expected > 0 ? fmt(w.expected) : '—'}</div>
              {w.expected > 0 && (
                <div className="text-[9px] text-neutral-400">
                  {w.shifts} ед-смен × {fmt(w.norm_per_shift)}
                </div>
              )}
            </td>
            <td className="text-right py-1">{fmt(w.fact_volume)}</td>
            <td className="text-right py-1">{w.shifts}</td>
            <td className="text-right py-1">{fmtN(w.avg_units, 1)}</td>
            <td className="text-right py-1 font-semibold" style={{ color: pctColor(w.percent) }}>
              {w.percent == null ? '—' : Math.round(w.percent) + '%'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MaterialTable({ rows }: { rows: MaterialDetail[] }) {
  return (
    <table className="w-full text-[10.5px] font-mono">
      <thead className="text-neutral-400">
        <tr>
          <th className="text-left pb-1">Материал</th>
          <th className="text-left pb-1">Карьер</th>
          <th className="text-right pb-1">Норма</th>
          <th className="text-right pb-1">План (ожид.)</th>
          <th className="text-right pb-1">Факт (в норме)</th>
          <th className="text-right pb-1">Вне нормы</th>
          <th className="text-right pb-1">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(m => (
          <tr key={m.material} className="text-neutral-200 border-t border-neutral-700">
            <td className="text-left py-1 pr-2">{m.material}</td>
            <td className="text-left py-1 pr-2 text-[10px] whitespace-normal break-words max-w-[140px]" title={m.quarry ?? ''}>
              {m.quarry ?? '—'}
            </td>
            <td className="text-right py-1 whitespace-nowrap">
              <div>{m.norm_per_shift == null ? '—' : `${fmt(m.norm_per_shift)} м³/см`}</div>
              {m.norm_formula && <div className="text-[9px] text-neutral-400">{m.norm_formula}</div>}
            </td>
            <td className="text-right py-1 whitespace-nowrap">
              <div>{m.expected > 0 ? fmt(m.expected) : '—'}</div>
              {m.expected > 0 && (
                <div className="text-[9px] text-neutral-400">
                  {fmtN(m.avg_units, 1)}×{fmt(m.norm_per_shift ?? 0)}×{m.shifts}см
                </div>
              )}
            </td>
            <td className="text-right py-1">{fmt(m.fact_in_norm)}</td>
            <td className="text-right py-1 text-neutral-400">{fmt(m.fact_off_norm)}</td>
            <td className="text-right py-1 font-semibold" style={{ color: pctColor(m.percent) }}>
              {m.percent == null ? '—' : Math.round(m.percent) + '%'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
