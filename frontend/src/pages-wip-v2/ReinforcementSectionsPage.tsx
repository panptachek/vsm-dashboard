import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Columns3, LandPlot, TrendingUp } from 'lucide-react'

type Mode = 'cumulative' | 'date'

interface SectionKpi {
  code: string
  label: string
  main: number
  test: number
  dyn?: number
  total: number
  plan_main?: number
  plan_test?: number
  plan_dyn?: number
  plan_total?: number
  month_plan_main?: number
  month_plan_test?: number
  month_plan_dyn?: number
  month_plan_total?: number
  delta?: number
  month_delta?: number
}

interface DayFacts {
  main: number
  test: number
  dyn?: number
  total: number
  plan_main?: number
  plan_test?: number
  plan_dyn?: number
  plan_total?: number
}

interface ReinforcementResponse {
  date: string
  mode: Mode
  plan_available: boolean
  sections: SectionKpi[]
  calendar: {
    month: string
    days: string[]
    rows: { code: string; label: string; days: Record<string, DayFacts> }[]
    totals_by_day: Record<string, DayFacts>
  }
  dynamic: { date: string; plan: number; by_section: Record<string, number>; total: number }[]
}

const SECTION_COLORS = ['#dc2626', '#f59e0b', '#eab308', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777']

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

function signed(n: number): string {
  const rounded = Math.round(n)
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('ru-RU')}`
}

function dayLabel(value: string): string {
  const [, m, d] = value.split('-')
  return `${d}.${m}`
}

export default function ReinforcementSectionsPage() {
  const [date, setDate] = useState(todayISO())
  const [mode, setMode] = useState<Mode>('cumulative')

  const { data, isLoading } = useQuery<ReinforcementResponse>({
    queryKey: ['reinforcement-sections-summary', date, mode],
    queryFn: () => fetch(`/api/wip/reinforcement-sections/summary?date=${date}&mode=${mode}`).then(r => r.json()),
  })

  const maxDynamic = useMemo(() => Math.max(1, ...(data?.dynamic || []).map(d => Math.max(d.total, d.plan))), [data])

  return (
    <div className="p-4 md:p-6 pb-24 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <LandPlot className="w-6 h-6 text-accent-red" />
        <div className="flex-1 min-w-[240px]">
          <h1 className="font-heading text-2xl font-bold text-text-primary">Участки усиления</h1>
          <p className="text-sm text-text-muted mt-0.5">Факт забивки свай и майский производственный план по участкам усиления.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm font-mono"
          />
          <div className="inline-flex rounded-md border border-border bg-white p-1">
            <button
              type="button"
              onClick={() => setMode('cumulative')}
              className={`px-3 py-1.5 text-xs font-semibold rounded ${mode === 'cumulative' ? 'bg-slate-900 text-white' : 'text-text-secondary hover:bg-bg-surface'}`}
            >
              Нарастающим
            </button>
            <button
              type="button"
              onClick={() => setMode('date')}
              className={`px-3 py-1.5 text-xs font-semibold rounded ${mode === 'date' ? 'bg-slate-900 text-white' : 'text-text-secondary hover:bg-bg-surface'}`}
            >
              На дату
            </button>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="h-52 bg-white border border-border rounded-lg animate-pulse" />
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {data.sections.map((section, index) => {
              const displayPlan = section.month_plan_total ?? section.plan_total ?? 0
              const displayPlanMain = section.month_plan_main ?? section.plan_main ?? 0
              const displayPlanTest = section.month_plan_test ?? section.plan_test ?? 0
              const displayPlanDyn = section.month_plan_dyn ?? section.plan_dyn ?? 0
              const displayDelta = section.total - displayPlan
              return (
              <div key={section.code} className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: SECTION_COLORS[index] }} />
                    <div className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-wide text-text-muted">{section.label}</div>
                  </div>
                  <div className={`shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                    displayDelta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {signed(displayDelta)}
                  </div>
                </div>
                <div className="mt-4 flex items-stretch justify-between gap-4">
                  <div className="min-w-0 rounded-md bg-bg-surface px-3 py-3">
                    <div className="whitespace-nowrap text-[11px] font-semibold uppercase text-text-muted">Факт</div>
                    <div className="mt-1 whitespace-nowrap font-heading text-4xl font-bold leading-none text-text-primary">{fmt(section.total)}</div>
                    <div className="mt-2 whitespace-nowrap text-[11px] text-text-muted">осн. {fmt(section.main)} · проб. {fmt(section.test)} · дин. {fmt(section.dyn ?? 0)}</div>
                  </div>
                  <div className="min-w-[118px] flex-1 space-y-2">
                    <div className="rounded-md bg-bg-surface px-3 py-2">
                      <div className="whitespace-nowrap text-[11px] font-semibold uppercase text-text-muted">План май</div>
                      <div className="mt-1 whitespace-nowrap font-heading text-[28px] font-bold leading-none text-text-primary">{fmt(displayPlan)}</div>
                      <div className="mt-1 whitespace-nowrap text-right text-[9px] text-text-muted">осн. {fmt(displayPlanMain)} · проб. {fmt(displayPlanTest)} · дин. {fmt(displayPlanDyn)}</div>
                    </div>
                    <div className="rounded-md bg-bg-surface px-3 py-2">
                      <div className="whitespace-nowrap text-[11px] font-semibold uppercase text-text-muted">Разница</div>
                      <div className={`mt-1 whitespace-nowrap font-heading text-[28px] font-bold leading-none ${
                        displayDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}>
                        {signed(displayDelta)}
                      </div>
                      <div className="mt-1 whitespace-nowrap text-right text-[9px] text-text-muted">факт − план</div>
                    </div>
                  </div>
                </div>
              </div>
              )
            })}
          </section>

          <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-accent-red" />
              <h2 className="font-heading text-base font-semibold text-text-primary">Производственный календарь месяца</h2>
              <span className="text-xs text-text-muted">факт, шт</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold">Участок</th>
                    {data.calendar.days.map(day => (
                      <th key={day} className="px-2 py-2 text-center font-semibold whitespace-nowrap">{day.split('-')[2]}</th>
                    ))}
                    <th className="px-2 py-2 text-center font-semibold">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calendar.rows.map((row, index) => {
                    const rowTotal = data.calendar.days.reduce((sum, day) => sum + row.days[day].total, 0)
                    return (
                      <tr key={row.code} className="border-b border-border/60">
                        <td className="sticky left-0 z-10 bg-white px-2 py-1.5 font-semibold text-text-primary">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SECTION_COLORS[index] }} />
                            {row.label}
                          </span>
                        </td>
                        {data.calendar.days.map(day => {
                          const facts = row.days[day]
                          return (
                            <td key={day} className="px-1 py-1 text-center font-mono text-text-secondary">
                              {facts.total > 0 ? `${fmt(facts.total)}` : ''}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-center font-mono font-semibold text-text-primary">{fmt(rowTotal)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-bg-surface font-semibold">
                    <td className="sticky left-0 z-10 bg-bg-surface px-2 py-2 text-text-primary">Итого</td>
                    {data.calendar.days.map(day => (
                      <td key={day} className="px-1 py-2 text-center font-mono text-text-primary">
                        {data.calendar.totals_by_day[day].total > 0 ? fmt(data.calendar.totals_by_day[day].total) : ''}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-mono text-text-primary">
                      {fmt(data.calendar.days.reduce((sum, day) => sum + data.calendar.totals_by_day[day].total, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent-red" />
              <h2 className="font-heading text-base font-semibold text-text-primary">Динамика: последние 3 дня и следующий день</h2>
              <span className="text-xs text-text-muted">план и факт по графику забивки</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {data.dynamic.map(day => (
                <div key={day.date} className="rounded-lg border border-border bg-bg-surface p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="font-heading text-sm font-semibold text-text-primary">{dayLabel(day.date)}</div>
                    <div className="font-mono text-xs text-text-muted">{fmt(day.total)} шт</div>
                  </div>
                  <div className="space-y-2">
                    <BarRow label="План" value={0} max={maxDynamic} muted />
                    <StackedFactBar bySection={day.by_section} max={maxDynamic} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-dashed border-border bg-white p-4 text-sm text-text-muted">
            <div className="flex items-center gap-2">
              <Columns3 className="w-4 h-4 text-text-muted" />
              В карточках используется майский план из календаря забивки свай по участкам усиления.
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function BarRow({ label, value, max, muted = false }: { label: string; value: number; max: number; muted?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-text-muted">
        <span>{label}</span>
        <span>{fmt(value)}</span>
      </div>
      <div className="h-7 rounded border border-border bg-white overflow-hidden">
        <div
          className={muted ? 'h-full bg-neutral-200' : 'h-full bg-accent-red'}
          style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }}
        />
      </div>
    </div>
  )
}

function StackedFactBar({ bySection, max }: { bySection: Record<string, number>; max: number }) {
  const entries = Object.entries(bySection).filter(([, value]) => value > 0)
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-text-muted">
        <span>Факт по участкам</span>
        <span>{fmt(total)}</span>
      </div>
      <div className="flex h-7 rounded border border-border bg-white overflow-hidden" style={{ width: `${Math.max(6, Math.min(100, total / max * 100))}%` }}>
        {entries.length === 0 ? (
          <div className="w-full bg-neutral-100" />
        ) : entries.map(([code, value]) => {
          const index = Math.max(0, Number(code.replace('UCH_', '')) - 1)
          return (
            <div
              key={code}
              title={`${code}: ${fmt(value)} шт`}
              style={{ width: `${value / total * 100}%`, background: SECTION_COLORS[index] }}
            />
          )
        })}
      </div>
    </div>
  )
}
