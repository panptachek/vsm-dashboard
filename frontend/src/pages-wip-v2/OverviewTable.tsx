/**
 * OverviewTable — сводная таблица по участкам.
 * Источник: GET /api/wip/overview/table?from=&to=
 */
import { useQuery } from '@tanstack/react-query'

interface Section {
  code: string
  label: string
  sand_m3: number
  shps_m3: number
  zhds: number
  almaz: number
  hire: number
  total_m3: number
  piles_main: number
  piles_trial: number
  piles_dyntest: number
  tad_ready_pct: number
  equipment_units: number
}

interface TableResp {
  as_of: string
  sections: Section[]
}

const COL_OWN = '#1a1a1a'
const COL_ALMAZ = '#dc2626'
const COL_HIRE = '#7f1d1d'

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))
const fmtPct = (n: number) => `${n.toFixed(0)}%`

export default function OverviewTable({ from, to }: { from: string; to: string }) {
  const { data, isLoading, isError } = useQuery<TableResp>({
    queryKey: ['wip', 'overview', 'table', from, to],
    queryFn: () => fetch(`/api/wip/overview/table?from=${from}&to=${to}`).then(r => r.json()),
  })

  if (isError) {
    return <div className="text-sm text-accent-red">Ошибка загрузки таблицы</div>
  }

  const sections = (data?.sections ?? []).slice().sort((a, b) => b.total_m3 - a.total_m3)

  const totals = sections.reduce(
    (acc, s) => {
      acc.sand_m3 += s.sand_m3
      acc.shps_m3 += s.shps_m3
      acc.zhds += s.zhds
      acc.almaz += s.almaz
      acc.hire += s.hire
      acc.total_m3 += s.total_m3
      acc.piles_main += s.piles_main
      acc.piles_trial += s.piles_trial
      acc.piles_dyntest += s.piles_dyntest
      acc.equipment_units += s.equipment_units
      return acc
    },
    { sand_m3: 0, shps_m3: 0, zhds: 0, almaz: 0, hire: 0, total_m3: 0,
      piles_main: 0, piles_trial: 0, piles_dyntest: 0, equipment_units: 0 },
  )
  const avgReady = sections.length ? sections.reduce((s, x) => s + x.tad_ready_pct, 0) / sections.length : 0
  const maxTotal = sections.reduce((m, s) => Math.max(m, s.total_m3), 0) || 1

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-heading font-bold text-lg">Сводная таблица по участкам</h2>
        {data?.as_of && (
          <span className="ml-auto text-xs font-mono text-text-muted">на {data.as_of}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-bg-card z-10">
            <tr className="border-b border-border text-text-muted uppercase tracking-wider">
              <th className="text-left py-2 px-2 font-semibold">Участок</th>
              <th className="text-right py-2 px-2 font-semibold">Песок, м³</th>
              <th className="text-right py-2 px-2 font-semibold">ЩПГС, м³</th>
              <th className="text-right py-2 px-2 font-semibold">ЖДС</th>
              <th className="text-right py-2 px-2 font-semibold">АЛМАЗ</th>
              <th className="text-right py-2 px-2 font-semibold">Наёмные</th>
              <th className="text-right py-2 px-2 font-semibold min-w-[180px]">Итого, м³</th>
              <th className="text-right py-2 px-2 font-semibold">Сваи осн</th>
              <th className="text-right py-2 px-2 font-semibold">Сваи проб</th>
              <th className="text-right py-2 px-2 font-semibold">Дин.исп</th>
              <th className="text-right py-2 px-2 font-semibold min-w-[120px]">Готовность АД, %</th>
              <th className="text-right py-2 px-2 font-semibold">Техника, ед.</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 9 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {Array.from({ length: 12 }).map((_, j) => (
                    <td key={j} className="py-3 px-2">
                      <div className="h-3 rounded bg-bg-surface animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading && sections.map((s, idx) => (
              <tr
                key={s.code}
                className={`border-b border-border/60 hover:bg-bg-surface ${idx % 2 === 1 ? 'bg-bg-surface/40' : ''}`}
              >
                <td className="py-2 px-2 font-medium">{s.label}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.sand_m3)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.shps_m3)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.zhds)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.almaz)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.hire)}</td>
                <td className="py-1 px-2">
                  <TotalBar
                    zhds={s.zhds} almaz={s.almaz} hire={s.hire}
                    total={s.total_m3} widthPct={(s.total_m3 / maxTotal) * 100}
                  />
                </td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.piles_main)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.piles_trial)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.piles_dyntest)}</td>
                <td className="py-1 px-2">
                  <ReadyBar pct={s.tad_ready_pct} />
                </td>
                <td className="py-2 px-2 text-right font-mono">{fmt(s.equipment_units)}</td>
              </tr>
            ))}
            {!isLoading && sections.length > 0 && (
              <tr className="border-t-2 border-text-primary/80 font-semibold bg-bg-surface">
                <td className="py-2 px-2">Итого</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.sand_m3)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.shps_m3)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.zhds)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.almaz)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.hire)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.total_m3)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.piles_main)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.piles_trial)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.piles_dyntest)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmtPct(avgReady)}</td>
                <td className="py-2 px-2 text-right font-mono">{fmt(totals.equipment_units)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TotalBar({ zhds, almaz, hire, total, widthPct }: {
  zhds: number; almaz: number; hire: number; total: number; widthPct: number
}) {
  const sum = zhds + almaz + hire
  return (
    <div className="flex flex-col items-end gap-1 min-w-[160px]">
      <div className="w-full h-2.5 rounded-full bg-bg-surface overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
        {sum > 0 && (
          <div className="flex h-full w-full">
            {zhds > 0 && <div style={{ width: `${(zhds / sum) * 100}%`, background: COL_OWN }} title={`ЖДС: ${fmt(zhds)}`} />}
            {almaz > 0 && <div style={{ width: `${(almaz / sum) * 100}%`, background: COL_ALMAZ }} title={`АЛМАЗ: ${fmt(almaz)}`} />}
            {hire > 0 && <div style={{ width: `${(hire / sum) * 100}%`, background: COL_HIRE }} title={`Наёмные: ${fmt(hire)}`} />}
          </div>
        )}
      </div>
      <span className="font-mono text-text-primary">{fmt(total)}</span>
    </div>
  )
}

function ReadyBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-bg-surface overflow-hidden min-w-[70px]">
        <div className="h-full bg-progress-green" style={{ width: `${clamped}%` }} />
      </div>
      <span className="font-mono text-text-primary w-10 text-right">{fmtPct(clamped)}</span>
    </div>
  )
}
