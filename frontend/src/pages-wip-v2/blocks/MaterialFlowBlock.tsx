/**
 * Блок «Возка (песок, ЩПГС)». Три вкладки: по участкам / по карьерам / по силам.
 * Колонки: material (песок/ЩПГС) × labor bucket (ЖДС / АЛМАЗ / наёмники) + итого-бар.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { sectionCodeToUILabel } from '../../lib/sections'

type Material = 'SAND' | 'SHPGS' | string
type LaborBucket = 'own' | 'almaz' | 'hire'
type Mode = 'sections' | 'quarries' | 'labor'

interface Row {
  section_code: string
  material: Material
  quarry_id: string | null
  quarry_name: string | null
  contractor_id: string | null
  contractor_name: string | null
  contractor_short: string | null
  contractor_kind: 'own' | 'subcontractor' | 'supplier'
  contractor_bucket?: 'zhds' | 'almaz' | 'hire'
  volume: number
  trips: number
}

const BUCKET_COLOR: Record<LaborBucket, string> = {
  own:   '#1a1a1a',
  almaz: '#dc2626',
  hire:  '#7f1d1d',
}

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))

function bucketOf(r: Row): LaborBucket {
  // Предпочитаем новое поле contractor_bucket (zhds/almaz/hire) если оно есть.
  if (r.contractor_bucket === 'zhds') return 'own'
  if (r.contractor_bucket === 'almaz') return 'almaz'
  if (r.contractor_bucket === 'hire') return 'hire'
  // Фолбэк на contractor_kind/contractor_short.
  if (r.contractor_kind === 'own') return 'own'
  if ((r.contractor_short ?? '').toUpperCase().includes('АЛМАЗ')) return 'almaz'
  return 'hire'
}

function isSand(m: Material): boolean {
  return m === 'SAND' || m.toLowerCase().includes('песок')
}

interface Agg {
  sand: number; shpgs: number
  own: number; almaz: number; hire: number
  // Матрица material × contractor для разделения по силам внутри материала.
  sand_own: number; sand_almaz: number; sand_hire: number
  shpgs_own: number; shpgs_almaz: number; shpgs_hire: number
  total: number
}

function emptyAgg(): Agg {
  return {
    sand: 0, shpgs: 0, own: 0, almaz: 0, hire: 0,
    sand_own: 0, sand_almaz: 0, sand_hire: 0,
    shpgs_own: 0, shpgs_almaz: 0, shpgs_hire: 0,
    total: 0,
  }
}

function addRow(a: Agg, r: Row, b: LaborBucket) {
  const sand = isSand(r.material)
  if (sand) {
    a.sand += r.volume
    if (b === 'own') a.sand_own += r.volume
    else if (b === 'almaz') a.sand_almaz += r.volume
    else a.sand_hire += r.volume
  } else {
    a.shpgs += r.volume
    if (b === 'own') a.shpgs_own += r.volume
    else if (b === 'almaz') a.shpgs_almaz += r.volume
    else a.shpgs_hire += r.volume
  }
  a[b] += r.volume
  a.total += r.volume
}

export function MaterialFlowBlock({
  from, to,
}: { from: string; to: string; view: 'table'|'cards'|'timeline' }) {
  const [mode, setMode] = useState<Mode>('sections')

  const { data, isLoading } = useQuery<{ rows: Row[] }>({
    queryKey: ['wip', 'material-flow', from, to],
    queryFn: () => fetch(`/api/wip/material-flow?from=${from}&to=${to}`).then(r => r.json()),
  })

  const { rows, totals, bySection, byQuarry, byLabor } = useMemo(() => {
    const rs = data?.rows ?? []
    const totals = emptyAgg()
    const bySection: Record<string, Agg> = {}
    const byQuarry: Record<string, Agg> = {}
    const byLabor: Record<LaborBucket, Agg> = { own: emptyAgg(), almaz: emptyAgg(), hire: emptyAgg() }
    for (const r of rs) {
      const b = bucketOf(r)
      addRow(totals, r, b)
      const sec = r.section_code
      bySection[sec] ??= emptyAgg()
      addRow(bySection[sec], r, b)
      const q = r.quarry_name ?? '—'
      byQuarry[q] ??= emptyAgg()
      addRow(byQuarry[q], r, b)
      addRow(byLabor[b], r, b)
    }
    return { rows: rs, totals, bySection, byQuarry, byLabor }
  }, [data])

  if (isLoading || !data) {
    return <div className="bg-white border border-border rounded-xl p-5 h-40 animate-pulse" />
  }

  const tableRows: { label: string; agg: Agg }[] = (() => {
    if (mode === 'sections') {
      return Object.entries(bySection)
        .map(([code, agg]) => ({ label: sectionCodeToUILabel(code), agg }))
        .sort((a, b) => b.agg.total - a.agg.total)
    }
    if (mode === 'quarries') {
      return Object.entries(byQuarry)
        .map(([name, agg]) => ({ label: name, agg }))
        .sort((a, b) => b.agg.total - a.agg.total)
    }
    const FORCE_LABEL: Record<LaborBucket, string> = {
      own: 'ЖДС',
      almaz: 'ООО «АЛМАЗ»',
      hire: 'Наёмники',
    }
    return (['own', 'almaz', 'hire'] as LaborBucket[]).map(b => ({
      label: FORCE_LABEL[b],
      agg: byLabor[b],
    }))
  })()

  const firstColLabel = mode === 'sections' ? 'УЧАСТОК' : mode === 'quarries' ? 'КАРЬЕР' : 'СИЛЫ'

  const maxTotal = Math.max(1, ...tableRows.map(r => r.agg.total))

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Truck className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading tracking-wide uppercase">
          Возка (песок, ЩПГС)
        </h2>
        <div className="flex items-center gap-2 text-xs text-text-secondary font-mono">
          <span>Σ <span className="text-text-primary">{fmt(totals.total)}</span> м³</span>
          <span className="text-text-muted">·</span>
          <span>песок <span className="text-text-primary">{fmt(totals.sand)}</span></span>
          <span className="text-text-muted">·</span>
          <span>ЩПГС <span className="text-text-primary">{fmt(totals.shpgs)}</span></span>
        </div>
        {/* Tabs */}
        <div className="ml-auto flex items-center gap-1 bg-bg-surface rounded-lg p-1 border border-border">
          <TabChip active={mode === 'sections'} onClick={() => setMode('sections')}>по участкам</TabChip>
          <TabChip active={mode === 'quarries'} onClick={() => setMode('quarries')}>по карьерам</TabChip>
          <TabChip active={mode === 'labor'} onClick={() => setMode('labor')}>по силам</TabChip>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs">
        <LegendChip color={BUCKET_COLOR.own} label="ЖДС (собств.)" />
        <LegendChip color={BUCKET_COLOR.almaz} label="ООО «АЛМАЗ»" />
        <LegendChip color={BUCKET_COLOR.hire} label="Прочие наёмники" />
        <div className="ml-auto flex items-center gap-3 text-text-muted">
          <LegendChip color="#737373" label="песок" />
          <LegendChip color="#b45309" label="ЩПГС" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-text-muted uppercase tracking-wider text-[10px]">
              <th rowSpan={2} className="text-left py-2 pr-4 font-semibold align-bottom">{firstColLabel}</th>
              <th colSpan={3} className="text-center py-2 px-2 font-semibold border-l border-border/60">ПЕСОК, м³</th>
              <th colSpan={3} className="text-center py-2 px-2 font-semibold border-l border-border/60 bg-amber-50">ЩПС/ЩПГС, м³</th>
              <th rowSpan={2} className="text-right py-2 pl-3 font-semibold min-w-[220px] align-bottom border-l border-border">ИТОГО, м³</th>
            </tr>
            <tr className="text-text-muted uppercase tracking-wider text-[10px]">
              <th className="text-right py-1 px-2 font-normal border-l border-border/60">ЖДС</th>
              <th className="text-right py-1 px-2 font-normal">АЛМАЗ</th>
              <th className="text-right py-1 px-2 font-normal">наём.</th>
              <th className="text-right py-1 px-2 font-normal border-l border-border/60 bg-amber-50">ЖДС</th>
              <th className="text-right py-1 px-2 font-normal bg-amber-50">АЛМАЗ</th>
              <th className="text-right py-1 px-2 font-normal bg-amber-50">наём.</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-muted text-xs">
                  Нет данных за выбранный период.
                </td>
              </tr>
            )}
            {tableRows.map(({ label, agg }) => (
              <tr key={label} className="border-t border-border/60 hover:bg-bg-surface/40">
                <td className="py-3 pr-4 font-semibold text-text-primary">{label}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary border-l border-border/60">{agg.sand_own ? fmt(agg.sand_own) : '—'}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary">{agg.sand_almaz ? fmt(agg.sand_almaz) : '—'}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary">{agg.sand_hire ? fmt(agg.sand_hire) : '—'}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary border-l border-border/60 bg-amber-50">{agg.shpgs_own ? fmt(agg.shpgs_own) : '—'}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary bg-amber-50">{agg.shpgs_almaz ? fmt(agg.shpgs_almaz) : '—'}</td>
                <td className="py-3 px-2 text-right font-mono text-text-secondary bg-amber-50">{agg.shpgs_hire ? fmt(agg.shpgs_hire) : '—'}</td>
                <td className="py-3 pl-3 min-w-[220px] border-l border-border">
                  <TotalBar agg={agg} maxTotal={maxTotal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && data.rows?.length === 0 && (
        <div className="mt-2 text-[11px] text-text-muted">
          Возка за период отсутствует.
        </div>
      )}
    </section>
  )
}

function TabChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium rounded-md transition ${
        active
          ? 'bg-slate-800 text-white'
          : 'bg-white text-gray-600 border border-gray-200 hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-[3px]" style={{ background: color }} />
      <span className="text-text-secondary">{label}</span>
    </span>
  )
}

function TotalBar({ agg, maxTotal }: { agg: Agg; maxTotal: number }) {
  const width = agg.total > 0 ? Math.max(10, (agg.total / maxTotal) * 100) : 0
  // Верхний ряд — split по материалам (песок / ЩПГС)
  const matStack = agg.total > 0 ? [
    { k: 'sand' as const, v: agg.sand, color: '#737373' },
    { k: 'shpgs' as const, v: agg.shpgs, color: '#b45309' },
  ] : []
  // Нижний ряд — split по силам (ЖДС / АЛМАЗ / Наёмники)
  const laborStack = agg.total > 0 ? [
    { b: 'own' as const, v: agg.own },
    { b: 'almaz' as const, v: agg.almaz },
    { b: 'hire' as const, v: agg.hire },
  ] : []
  return (
    <div className="w-full flex flex-col items-end gap-1">
      <div className="relative w-full h-2.5 rounded-sm overflow-hidden bg-bg-surface" style={{ maxWidth: `${width}%`, marginLeft: 'auto' }}>
        <div className="flex w-full h-full">
          {matStack.map(({ k, v, color }) => v > 0 && (
            <div key={k} style={{ width: `${(v / agg.total) * 100}%`, background: color }} />
          ))}
        </div>
      </div>
      <div className="relative w-full h-2 rounded-sm overflow-hidden bg-bg-surface" style={{ maxWidth: `${width}%`, marginLeft: 'auto' }}>
        <div className="flex w-full h-full">
          {laborStack.map(({ b, v }) => v > 0 && (
            <div key={b} style={{ width: `${(v / agg.total) * 100}%`, background: BUCKET_COLOR[b] }} />
          ))}
        </div>
      </div>
      <span className="inline-block bg-text-primary text-white px-2 py-0.5 text-[11px] font-mono rounded-sm">
        {fmt(agg.total)}
      </span>
    </div>
  )
}
