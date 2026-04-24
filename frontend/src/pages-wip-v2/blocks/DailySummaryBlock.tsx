/**
 * Блок «Выполнение за выбранную дату» + «Сводные показатели по 3 этапу».
 * Источник: /api/wip/analytics/daily-summary?to=YYYY-MM-DD
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
  to: string
  summary: Summary
  stage3: Stage3
}

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))
const fmt2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

function pctColor(p: number): string {
  if (p >= 50) return 'text-[#16a34a]'
  if (p >= 15) return 'text-[#ca8a04]'
  return 'text-accent-red'
}

export function DailySummaryBlock({ to }: { to: string }) {
  const { data, isLoading } = useQuery<Response>({
    queryKey: ['wip', 'daily-summary', to],
    queryFn: () => fetch(`/api/wip/analytics/daily-summary?to=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return <div className="h-40 bg-white border border-border rounded-xl animate-pulse" />
  }

  const dateStr = new Date(data.to).toLocaleDateString('ru-RU')
  const s = data.summary
  const st = data.stage3
  const pctTotal = st.total_length_m > 0
    ? (st.ready_plus_done_m / st.total_length_m * 100) : 0

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <ClipboardCheck className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="font-heading font-bold text-[15px] tracking-wide uppercase text-text-primary">
          Выполнение за {dateStr}
        </h2>
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
            <h3 className="font-heading font-bold text-[13px] uppercase tracking-wider text-text-primary">
              Сводные показатели по 3 этапу
            </h3>
          </div>
          <div className="text-[12px] text-text-secondary mb-3 leading-snug">
            Общая протяжённость временных притрассовых автодорог 3 этапа —
            <b className="text-text-primary font-mono"> {fmt2(st.total_length_m / 1000)} км</b>.
            По состоянию на <b className="text-text-primary">{dateStr}</b> для проезда доступно
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
              Цель ЩПГС: {new Date(st.target_date).toLocaleDateString('ru-RU')} · осталось {st.days_to_target} дн.
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
