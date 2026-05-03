/**
 * Блок «Выполнение за выбранный период» + «Сводные показатели по 3 этапу».
 * Источник: /api/wip/analytics/daily-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Route } from 'lucide-react'

interface ContractorSplit {
  own: number; almaz: number; hired: number; total: number
}
interface Summary {
  prs_m3: number
  vyemka_m3: number
  shpgs_m3: number
  sand_transport: ContractorSplit
  shpgs_transport: ContractorSplit
  soil_transport: ContractorSplit
  piles: { main: number; trial: number; dyntest: number; total: number }
}
interface Stage3Section {
  section: number
  length_m: number
  ready_plus_done_m: number
  pct_ready_plus_done: number
  required_rate_m_per_day: number
}
interface Stage3 {
  total_length_m: number
  passable_m: number
  completed_m: number
  ready_plus_done_m: number
  required_rate_m_per_day_total: number
  target_date: string
  days_to_target: number
  sections: Stage3Section[]
}
interface Response {
  from: string
  to: string
  summary: Summary
  stage3: Stage3
}

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))
const fmt2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

function pctColor(p: number): string {
  if (p >= 50) return 'text-progress-green'
  if (p >= 15) return 'text-progress-amber'
  return 'text-accent-red'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU')
}

function formatPeriod(from: string, to: string): string {
  return from === to ? formatDate(to) : `${formatDate(from)} — ${formatDate(to)}`
}

export function DailySummaryBlock({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery<Response>({
    queryKey: ['wip', 'daily-summary', from, to],
    queryFn: () => fetch(`/api/wip/analytics/daily-summary?from=${from}&to=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return <div className="h-40 bg-white border border-border rounded-xl animate-pulse" />
  }

  const periodStr = formatPeriod(data.from, data.to)
  const asOfStr = formatDate(data.to)
  const isSingleDay = data.from === data.to
  const s = data.summary
  const st = data.stage3
  const pctTotal = st.total_length_m > 0
    ? (st.ready_plus_done_m / st.total_length_m * 100) : 0

  // KPI для верхней полосы: пионерка, ЩПГС за день, % готовности (ЩПГС+готово).
  // «Пионерка» отдельным полем API не возвращается — используем soil_transport.total
  // как ближайший прокси (работы по пионерской отсыпке обычно = перевозка грунта).
  const kpiPioneer = s.soil_transport.total
  const kpiShpgs = s.shpgs_transport.total
  const kpiPct = pctTotal

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardCheck className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading tracking-wide uppercase">
          Выполнение за {periodStr}
        </h2>
      </div>

      {/* 3 KPI-карточки сверху */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <KpiBig label="Пионерка" value={`${fmt(kpiPioneer)}`} unit="м³" />
        <KpiBig label={isSingleDay ? 'ЩПГС за день' : 'ЩПГС за период'} value={`${fmt(kpiShpgs)}`} unit="м³" />
        <KpiBig
          label="% готовности (ЩПГС+готово)"
          value={`${kpiPct.toFixed(1)}`}
          unit="%"
          colorClass={pctColor(kpiPct)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Левая колонка: работы + сваи */}
        <div className="space-y-3 text-[13px]">
          <SummaryRow label="Снятие ПРС" value={`${fmt(s.prs_m3)} м³`} />
          <div>
            <SummaryRow label="Песок (возка)"
              value={`${fmt(s.sand_transport.total)} м³`}
              bold />
            <div className="ml-5 mt-1 space-y-0.5 text-[12px] text-text-secondary font-mono">
              <div>— собственными силами: {fmt(s.sand_transport.own)} м³</div>
              <div>— силами ООО «АЛМАЗ»: {fmt(s.sand_transport.almaz)} м³</div>
              <div>— наёмники: {fmt(s.sand_transport.hired)} м³</div>
            </div>
          </div>
          <SummaryRow label="Выемка грунта" value={`${fmt(s.vyemka_m3)} м³`} />
          <div>
            <SummaryRow label="ЩПС/ЩПГС"
              value={`${fmt(s.shpgs_transport.total)} м³`}
              bold />
            <div className="ml-5 mt-1 space-y-0.5 text-[12px] text-text-secondary font-mono">
              <div>— ЖДС: {fmt(s.shpgs_transport.own)} м³</div>
              <div>— АЛМАЗ: {fmt(s.shpgs_transport.almaz)} м³</div>
              <div>— наёмники: {fmt(s.shpgs_transport.hired)} м³</div>
            </div>
          </div>
          <SummaryRow label="Перевозка грунта" value={`${fmt(s.soil_transport.total)} м³`} />
          <div>
            <SummaryRow label="Погружение свай"
              value={`${fmt(s.piles.total)} шт`}
              bold />
            <div className="ml-5 mt-1 space-y-0.5 text-[12px] text-text-secondary font-mono">
              <div>— пробных: {fmt(s.piles.trial)} шт</div>
              <div>— основных: {fmt(s.piles.main)} шт</div>
              <div>— динамические испытания: {fmt(s.piles.dyntest)} шт</div>
            </div>
          </div>
        </div>

        {/* Правая колонка: сводные показатели по 3 этапу */}
        <div className="border border-border rounded-lg p-4 bg-bg-surface/40">
          <div className="flex items-center gap-2 mb-3">
            <Route className="w-4 h-4 text-accent-red" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-gray-800 font-heading uppercase tracking-wider">
              Сводные показатели по 3 этапу
            </h3>
          </div>
          <div className="text-[12px] text-text-secondary mb-3 leading-snug">
            Общая протяжённость временных притрассовых автодорог 3 этапа —
            <b className="text-text-primary font-mono"> {fmt2(st.total_length_m / 1000)} км</b>.
            По состоянию на <b className="text-text-primary">{asOfStr}</b> для проезда доступно
            <b className="text-text-primary font-mono"> {fmt2(st.passable_m / 1000)} км</b>,
            работы по устройству ЗП завершены на
            <b className="text-text-primary font-mono"> {fmt2(st.completed_m / 1000)} км</b>,
            ЩПГС+готово — <b className="text-text-primary font-mono">{fmt2(st.ready_plus_done_m / 1000)} км</b>
            {' '}({pctTotal.toFixed(1)}%).
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-text-muted uppercase tracking-wider text-[9px] border-b border-border">
                  <th className="text-left py-1 pr-2 font-semibold">Уч.</th>
                  <th className="text-right py-1 px-1 font-semibold">L<sub>АД</sub>, м</th>
                  <th className="text-right py-1 px-1 font-semibold">L<sub>ЩПГС+готово</sub>, м</th>
                  <th className="text-right py-1 px-1 font-semibold">%</th>
                  <th className="text-right py-1 pl-1 font-semibold">Треб. темп, м/сут</th>
                </tr>
              </thead>
              <tbody>
                {st.sections.map(sec => (
                  <tr key={sec.section} className="border-b border-border/60">
                    <td className="py-1 pr-2 font-semibold text-text-primary">№{sec.section}</td>
                    <td className="py-1 px-1 text-right font-mono text-text-secondary">{fmt(sec.length_m)}</td>
                    <td className="py-1 px-1 text-right font-mono text-text-secondary">{fmt(sec.ready_plus_done_m)}</td>
                    <td className={`py-1 px-1 text-right font-mono font-semibold ${pctColor(sec.pct_ready_plus_done)}`}>
                      {sec.pct_ready_plus_done.toFixed(1)}
                    </td>
                    <td className="py-1 pl-1 text-right font-mono text-text-secondary">
                      {fmt(sec.required_rate_m_per_day)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-white font-bold">
                  <td className="py-1 pr-2 text-text-primary">Σ</td>
                  <td className="py-1 px-1 text-right font-mono text-text-primary">{fmt(st.total_length_m)}</td>
                  <td className="py-1 px-1 text-right font-mono text-text-primary">{fmt(st.ready_plus_done_m)}</td>
                  <td className={`py-1 px-1 text-right font-mono ${pctColor(pctTotal)}`}>
                    {pctTotal.toFixed(1)}
                  </td>
                  <td className="py-1 pl-1 text-right font-mono text-text-primary">{fmt(st.required_rate_m_per_day_total)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-text-muted">
              Цель ЩПГС: {formatDate(st.target_date)} · осталось {st.days_to_target} дн.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-secondary">— <b className={bold ? 'text-text-primary' : ''}>{label}</b>:</span>
      <span className="font-mono font-semibold text-text-primary">{value}</span>
    </div>
  )
}

function KpiBig({ label, value, unit, colorClass }: {
  label: string; value: string; unit: string; colorClass?: string
}) {
  return (
    <div className="border border-border rounded-lg p-3 bg-white">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-3xl font-bold font-heading leading-none ${colorClass ?? 'text-text-primary'}`}>
          {value}
        </span>
        <span className="text-sm text-text-muted font-mono">{unit}</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500 uppercase tracking-wider">
        {label}
      </div>
    </div>
  )
}
