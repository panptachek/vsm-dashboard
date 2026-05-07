import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, CalendarDays, LandPlot, Sigma, TrendingUp } from 'lucide-react'

type ApiMode = 'cumulative' | 'date'
type TotalScope = 'month' | 'all'

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
  mode: ApiMode
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
const WEEKDAY_SHORT = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ']

function reportDefaultDateISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
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

function monthLabel(value: string): string {
  const [year, month] = value.split('-')
  const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  const idx = Number(month) - 1
  return `${names[idx] ?? month} ${year}`
}

function dateObj(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function sectionNumber(code: string): number {
  const n = Number(code.replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

function colorForSection(code: string): string {
  return SECTION_COLORS[(sectionNumber(code) - 1) % SECTION_COLORS.length]
}

function pct(fact: number, plan: number): number {
  return plan > 0 ? Math.max(0, Math.min(100, Math.round(fact / plan * 100))) : 0
}

function progressTone(value: number, plan: number): 'ok' | 'warn' | 'risk' | 'empty' {
  if (plan <= 0) return value > 0 ? 'ok' : 'empty'
  if (value <= 0) return 'empty'
  const p = value / plan
  if (p >= 1) return 'ok'
  if (p >= 0.75) return 'warn'
  return 'risk'
}

function toneClasses(tone: 'ok' | 'warn' | 'risk' | 'empty'): { text: string; bar: string; bg: string } {
  if (tone === 'ok') return { text: 'text-emerald-700', bar: 'bg-emerald-600', bg: 'bg-emerald-50 border-emerald-200' }
  if (tone === 'warn') return { text: 'text-amber-700', bar: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200' }
  if (tone === 'risk') return { text: 'text-red-700', bar: 'bg-red-600', bg: 'bg-red-50 border-red-200' }
  return { text: 'text-text-muted', bar: 'bg-neutral-300', bg: 'bg-neutral-50 border-border' }
}

function missedPulseClasses(days: number): { box: string; dot: string; text: string; badge: string } {
  if (days <= 0) {
    return {
      box: 'border-emerald-200 bg-emerald-50',
      dot: '#16a34a',
      text: 'text-emerald-800',
      badge: 'bg-white/80 text-emerald-700',
    }
  }
  if (days === 1) {
    return {
      box: 'border-red-200 bg-red-50',
      dot: '#dc2626',
      text: 'text-red-800',
      badge: 'bg-red-100 text-red-800',
    }
  }
  if (days <= 3) {
    return {
      box: 'border-rose-300 bg-rose-100',
      dot: '#e11d48',
      text: 'text-rose-900',
      badge: 'bg-white/70 text-rose-900',
    }
  }
  return {
    box: 'border-red-950 bg-red-950',
    dot: '#991b1b',
    text: 'text-white',
    badge: 'bg-white/15 text-white',
  }
}

function consecutiveMissedDays(
  code: string,
  days: string[],
  selectedDate: string,
  rows: ReinforcementResponse['calendar']['rows'],
): number {
  let endIndex = -1
  for (let i = 0; i < days.length; i++) {
    if (days[i] <= selectedDate) endIndex = i
  }
  if (endIndex < 0) return 0
  const row = rows.find(r => r.code === code)
  if (!row) return 0
  let misses = 0
  for (let i = endIndex; i >= 0; i--) {
    const day = days[i]
    const plan = (row.days[day]?.plan_main ?? 0) + (row.days[day]?.plan_test ?? 0)
    if (plan <= 0) break
    const value = row?.days[day]?.total ?? 0
    if (value >= plan) break
    misses += 1
  }
  return misses
}

function sumRowUntil(row: { days: Record<string, DayFacts> }, days: string[], selectedDate: string): number {
  return days
    .filter(day => day <= selectedDate)
    .reduce((sum, day) => sum + (row.days[day]?.total ?? 0), 0)
}

function sumPlanRowUntil(row: { days: Record<string, DayFacts> }, days: string[], selectedDate: string): number {
  return days
    .filter(day => day <= selectedDate)
    .reduce((sum, day) => sum + (row.days[day]?.plan_main ?? 0) + (row.days[day]?.plan_test ?? 0), 0)
}

function sumPlanRow(row: { days: Record<string, DayFacts> }, days: string[]): number {
  return days.reduce((sum, day) => sum + (row.days[day]?.plan_main ?? 0) + (row.days[day]?.plan_test ?? 0), 0)
}

function sectionFactForScope(
  code: string,
  scope: TotalScope,
  selectedDate: string,
  calendarDays: string[],
  calendarRows: ReinforcementResponse['calendar']['rows'],
  cumulativeSections: SectionKpi[],
): number {
  if (scope === 'all') {
    const section = cumulativeSections.find(s => s.code === code)
    return section ? section.main + section.test : 0
  }
  const row = calendarRows.find(r => r.code === code)
  return row ? sumRowUntil(row, calendarDays, selectedDate) : 0
}

function sectionPlanForScope(
  code: string,
  scope: TotalScope,
  selectedDate: string,
  calendarDays: string[],
  calendarRows: ReinforcementResponse['calendar']['rows'],
  cumulativeSections: SectionKpi[],
): number {
  if (scope === 'all') {
    void cumulativeSections
    return 0
  }
  const row = calendarRows.find(r => r.code === code)
  return row ? sumPlanRowUntil(row, calendarDays, selectedDate) : 0
}

async function fetchReinforcement(date: string, mode: ApiMode): Promise<ReinforcementResponse> {
  const res = await fetch(`/api/wip/reinforcement-sections/summary?date=${date}&mode=${mode}`)
  if (!res.ok) throw new Error(`Failed to fetch reinforcement summary: ${res.status}`)
  return res.json()
}

export default function ReinforcementSectionsBoard() {
  const [date, setDate] = useState(reportDefaultDateISO())
  const [scope, setScope] = useState<TotalScope>('month')

  const { data: dailyData, isLoading: dailyLoading } = useQuery<ReinforcementResponse>({
    queryKey: ['reinforcement-sections-summary', date, 'date'],
    queryFn: () => fetchReinforcement(date, 'date'),
  })

  const { data: cumulativeData, isLoading: cumulativeLoading } = useQuery<ReinforcementResponse>({
    queryKey: ['reinforcement-sections-summary', date, 'cumulative'],
    queryFn: () => fetchReinforcement(date, 'cumulative'),
  })

  const calendarRows = dailyData?.calendar.rows ?? []
  const calendarDays = dailyData?.calendar.days ?? []

  const monthlyPlanBySection = useMemo(() => Object.fromEntries(
    calendarRows.map(row => [
      row.code,
      calendarDays.reduce((sum, day) => (
        sum + (row.days[day]?.plan_main ?? 0) + (row.days[day]?.plan_test ?? 0)
      ), 0),
    ]),
  ), [calendarRows, calendarDays])

  const dailyPlan = useMemo(() => Object.fromEntries(
    calendarRows.map(row => [
      row.code,
      (row.days[date]?.plan_main ?? 0) + (row.days[date]?.plan_test ?? 0),
    ]),
  ), [calendarRows, date])

  const activeSections = useMemo(() => {
    const sections = dailyData?.sections ?? []
    return sections.filter(section => (monthlyPlanBySection[section.code] ?? 0) > 0)
  }, [dailyData, monthlyPlanBySection])

  const activeCodes = useMemo(() => new Set(activeSections.map(section => section.code)), [activeSections])
  const allFactSections = useMemo(() => {
    const sections = cumulativeData?.sections ?? []
    return sections.filter(section => (section.main + section.test) > 0)
  }, [cumulativeData])
  const totalSections = scope === 'all' ? allFactSections : activeSections
  const totalSectionCodes = useMemo(() => new Set(totalSections.map(section => section.code)), [totalSections])
  const totalDailyPlan = activeSections.reduce((sum, section) => sum + (dailyPlan[section.code] ?? 0), 0)
  const activeDynamic = useMemo(() => (dailyData?.dynamic ?? []).map(day => {
    const bySection = Object.fromEntries(
      Object.entries(day.by_section).filter(([code]) => activeCodes.has(code)),
    )
    return {
      ...day,
      by_section: bySection,
      total: Object.values(bySection).reduce((sum, value) => sum + value, 0),
      plan: day.plan,
    }
  }), [activeCodes, dailyData])
  const monthPlanToDate = (dailyData?.calendar.rows ?? [])
    .filter(row => activeCodes.has(row.code))
    .reduce((sum, row) => sum + sumPlanRowUntil(row, calendarDays, date), 0)
  const monthFactToDate = (dailyData?.calendar.rows ?? [])
    .filter(row => activeCodes.has(row.code))
    .reduce((sum, row) => sum + sumRowUntil(row, calendarDays, date), 0)
  const allFact = (cumulativeData?.sections ?? [])
    .filter(section => totalSectionCodes.has(section.code))
    .reduce((sum, section) => sum + section.main + section.test, 0)
  const totalFact = scope === 'month' ? monthFactToDate : allFact
  const totalPlan = scope === 'month' ? monthPlanToDate : 0
  const totalDelta = scope === 'month' ? totalFact - totalPlan : 0

  const maxDynamic = useMemo(() => {
    return Math.max(1, totalDailyPlan, ...activeDynamic.map(day => Math.max(day.total, day.plan)))
  }, [activeDynamic, totalDailyPlan])

  const isLoading = dailyLoading || cumulativeLoading || !dailyData || !cumulativeData

  return (
    <div className="space-y-5 p-4 pb-24 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <LandPlot className="h-6 w-6 text-accent-red" />
        <div className="min-w-[240px] flex-1">
          <h1 className="font-heading text-2xl font-bold text-text-primary">Участки усиления</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Суточная забивка, нарастающий итог и производственный календарь по участкам с месячным планом.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm">
          <CalendarDays className="h-4 w-4 text-accent-red" />
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
            className="bg-transparent font-mono text-sm outline-none"
          />
        </label>
      </div>

      {isLoading ? (
        <div className="h-72 animate-pulse rounded-lg border border-border bg-white" />
      ) : (
        <>
          <PulseStrip
            sections={activeSections}
            dailyPlan={dailyPlan}
            totalDailyPlan={totalDailyPlan}
            days={calendarDays}
            selectedDate={date}
            calendarRows={dailyData.calendar.rows}
          />

          <section className="space-y-3">
            <SectionTitle title="Суточный отчет" subtitle={`факт за ${dayLabel(date)} рядом с планом на день`} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {activeSections.map(section => (
                <DailySectionCard
                  key={section.code}
                  section={section}
                  dayPlan={dailyPlan[section.code] ?? 0}
                  dayPlanMain={section.plan_main ?? 0}
                  dayPlanTest={section.plan_test ?? 0}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle title="Нарастающий итог" subtitle={scope === 'month' ? 'текущий месяц' : 'за все время по БД'} />
              <div className="inline-flex rounded-md border border-border bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setScope('month')}
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${scope === 'month' ? 'bg-slate-900 text-white' : 'text-text-secondary hover:bg-bg-surface'}`}
                >
                  Текущий месяц
                </button>
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${scope === 'all' ? 'bg-slate-900 text-white' : 'text-text-secondary hover:bg-bg-surface'}`}
                >
                  Нарастающий итог
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {totalSections.map(section => {
                  const fact = sectionFactForScope(
                    section.code,
                    scope,
                    date,
                    calendarDays,
                    dailyData.calendar.rows,
                    cumulativeData.sections,
                  )
                  const plan = sectionPlanForScope(
                    section.code,
                    scope,
                    date,
                    calendarDays,
                    dailyData.calendar.rows,
                    cumulativeData.sections,
                  )
                  return <TotalMiniCard key={section.code} section={section} fact={fact} plan={plan} showPlan={scope === 'month'} />
                })}
              </div>
              <TotalSummaryCard scope={scope} fact={totalFact} plan={totalPlan} delta={totalDelta} showPlan={scope === 'month'} />
            </div>
          </section>

          <ProductionCalendar
            date={date}
            month={dailyData.calendar.month}
            days={calendarDays}
            rows={dailyData.calendar.rows.filter(row => activeCodes.has(row.code))}
            totalsByDay={dailyData.calendar.totals_by_day}
            monthlyPlanBySection={monthlyPlanBySection}
          />

          <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent-red" />
              <h2 className="font-heading text-base font-semibold text-text-primary">Динамика: последние 3 дня и следующий день</h2>
              <span className="text-xs text-text-muted">план и факт по графику забивки</span>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              {activeDynamic.map(day => (
                <div key={day.date} className="rounded-lg border border-border bg-bg-surface p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="font-heading text-sm font-semibold text-text-primary">{dayLabel(day.date)}</div>
                    <div className="font-mono text-xs text-text-muted">{fmt(day.total)} шт</div>
                  </div>
                  <div className="space-y-2">
                    <BarRow label="План" value={day.plan} max={maxDynamic} variant="plan" />
                    <StackedFactBar bySection={day.by_section} max={maxDynamic} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{title}</div>
      <div className="h-px min-w-8 flex-1 bg-border" />
      <div className="text-right text-[11px] font-medium text-text-muted">{subtitle}</div>
    </div>
  )
}

function PulseStrip({
  sections,
  dailyPlan,
  totalDailyPlan,
  days,
  selectedDate,
  calendarRows,
}: {
  sections: SectionKpi[]
  dailyPlan: Record<string, number>
  totalDailyPlan: number
  days: string[]
  selectedDate: string
  calendarRows: ReinforcementResponse['calendar']['rows']
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
      <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        <Activity className="h-4 w-4 shrink-0 text-accent-red" />
        <span className="whitespace-nowrap">Пульс</span>
      </div>
      <div className="flex min-w-max flex-1 items-center gap-1.5">
        {sections.map(section => {
          const plan = dailyPlan[section.code] ?? 0
          const valuePct = pct(section.total, plan)
          const missedDays = consecutiveMissedDays(section.code, days, selectedDate, calendarRows)
          const pulse = missedPulseClasses(missedDays)
          return (
            <div key={section.code} className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 ${pulse.box}`}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: pulse.dot }} />
              <span className={`whitespace-nowrap text-[11px] font-semibold ${pulse.text}`}>№{sectionNumber(section.code)}</span>
              <span className={`font-mono text-[11px] font-semibold ${pulse.text}`}>{valuePct}%</span>
              {missedDays > 0 && (
                <span className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold ${pulse.badge}`}>
                  {missedDays}д
                </span>
              )}
            </div>
          )
        })}
        <div className="shrink-0 rounded border border-red-100 bg-red-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-800">
          План день: {fmt(totalDailyPlan)} шт
        </div>
      </div>
    </div>
  )
}

function DailySectionCard({
  section,
  dayPlan,
  dayPlanMain,
  dayPlanTest,
}: {
  section: SectionKpi
  dayPlan: number
  dayPlanMain: number
  dayPlanTest: number
}) {
  const fact = section.main + section.test
  const valuePct = pct(fact, dayPlan)
  const tone = progressTone(fact, dayPlan)
  const toneCls = toneClasses(tone)
  const color = colorForSection(section.code)
  return (
    <div className="relative flex min-h-[205px] flex-col overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute right-3 top-1 font-heading text-5xl font-bold leading-none text-neutral-100">
        {sectionNumber(section.code)}
      </div>
      <div className="relative flex h-full flex-col">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{section.label}</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MetricBlock label="План день" value={dayPlan} muted compact />
          <MetricBlock label="Факт" value={fact} compact />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-muted">
          <div className="min-w-0 whitespace-nowrap">осн. {fmt(section.main)} / {fmt(dayPlanMain)}</div>
          <div className="min-w-0 whitespace-nowrap text-right">проб. {fmt(section.test)} / {fmt(dayPlanTest)}</div>
        </div>
        <div className="mt-auto pt-3">
          <div className="mb-1 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <span>Выполнение</span>
            <span className={toneCls.text}>{valuePct}%</span>
          </div>
          <div className="reinforcement-pulse-track h-2 overflow-hidden rounded-full border border-border bg-bg-surface">
            <div
              className={`reinforcement-pulse-fill h-full ${toneCls.bar}`}
              style={{ width: `${valuePct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricBlock({
  label,
  value,
  muted = false,
  compact = false,
}: {
  label: string
  value: number
  muted?: boolean
  compact?: boolean
}) {
  return (
    <div className="min-w-0 rounded-md bg-bg-surface px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase text-text-muted">{label}</div>
      <div className={`mt-1 font-heading font-bold leading-none tracking-normal ${compact ? 'text-[30px]' : 'text-4xl'} ${muted ? 'text-text-secondary' : 'text-text-primary'}`}>
        {fmt(value)}
      </div>
    </div>
  )
}

function TotalMiniCard({
  section,
  fact,
  plan,
  showPlan,
}: {
  section: SectionKpi
  fact: number
  plan: number
  showPlan: boolean
}) {
  const delta = fact - plan
  const tone = delta >= 0 ? 'text-emerald-700' : delta >= -Math.max(1, plan * 0.1) ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForSection(section.code) }} />
        <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">{section.label}</div>
      </div>
      {showPlan ? (
        <div className="mt-2 text-[11px] text-text-muted">План: {fmt(plan)}</div>
      ) : (
        <div className="mt-2 text-[11px] text-text-muted">Факт за все время</div>
      )}
      <div className="mt-1 font-heading text-3xl font-bold leading-none text-text-primary">{fmt(fact)}</div>
      {showPlan && <div className={`mt-1 font-mono text-xs font-semibold ${tone}`}>{signed(delta)} шт</div>}
    </div>
  )
}

function TotalSummaryCard({
  scope,
  fact,
  plan,
  delta,
  showPlan,
}: {
  scope: TotalScope
  fact: number
  plan: number
  delta: number
  showPlan: boolean
}) {
  const tone = delta >= 0 ? 'text-emerald-700' : delta >= -Math.max(1, plan * 0.1) ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="rounded-lg border border-red-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        <Sigma className="h-4 w-4 text-accent-red" />
        Итого · {scope === 'month' ? 'текущий месяц' : 'нарастающий итог'}
      </div>
      <div className={showPlan ? 'grid grid-cols-2 items-end gap-4' : 'grid grid-cols-1 items-end gap-4'}>
        {showPlan && (
          <div className="min-w-0 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">План</div>
            <div className="mt-1 whitespace-nowrap font-heading text-[28px] font-bold leading-none text-text-secondary">{fmt(plan)}</div>
          </div>
        )}
        <div className="min-w-0 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Факт</div>
          <div className="mt-1 whitespace-nowrap font-heading text-[38px] font-bold leading-none text-text-primary">{fmt(fact)}</div>
        </div>
      </div>
      {showPlan && (
        <div className={`mt-3 text-center font-mono text-sm font-semibold ${tone}`}>
          {signed(delta)} шт отклонение
        </div>
      )}
    </div>
  )
}

function ProductionCalendar({
  date,
  month,
  days,
  rows,
  totalsByDay,
  monthlyPlanBySection,
}: {
  date: string
  month: string
  days: string[]
  rows: ReinforcementResponse['calendar']['rows']
  totalsByDay: Record<string, DayFacts>
  monthlyPlanBySection: Record<string, number>
}) {
  return (
    <section className="space-y-3">
      <SectionTitle title="Производственный календарь" subtitle={monthLabel(month)} />
      <div className="overflow-x-auto rounded-lg border border-border bg-white p-3 shadow-sm">
        <div
          className="grid gap-1 text-[11px]"
          style={{ gridTemplateColumns: `240px repeat(${days.length}, minmax(34px, 1fr)) 64px` }}
        >
          <div className="sticky left-0 z-20 flex min-h-9 items-center rounded border border-border bg-bg-surface px-2 font-semibold uppercase tracking-wide text-text-muted">
            Участок
          </div>
          {days.map(day => (
            <DayHeader key={day} day={day} selected={day === date} />
          ))}
          <div className="flex min-h-9 items-center justify-center rounded border border-border bg-bg-surface font-semibold uppercase text-text-muted">
            Итого
          </div>

          {rows.map(row => {
            const monthPlan = monthlyPlanBySection[row.code] ?? 0
            const rowTotal = days.reduce((sum, day) => sum + (row.days[day]?.total ?? 0), 0)
            return (
              <RowFragment key={row.code}>
                <div className="sticky left-0 z-10 flex min-h-8 items-center gap-2 rounded border border-border bg-white px-2 font-semibold text-text-primary">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForSection(row.code) }} />
                  <span className="whitespace-nowrap">{row.label}</span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-text-muted">[{fmt(monthPlan)}]</span>
                </div>
                {days.map(day => (
                  <CalendarCell
                    key={`${row.code}-${day}`}
                    day={day}
                    selectedDate={date}
                    value={row.days[day]?.total ?? 0}
                    plan={row.days[day]?.plan_total ?? 0}
                  />
                ))}
                <div className="flex min-h-8 items-center justify-center rounded border border-border bg-bg-surface font-mono font-semibold text-text-primary">
                  {rowTotal > 0 ? fmt(rowTotal) : '—'}
                </div>
              </RowFragment>
            )
          })}

          <div className="sticky left-0 z-10 flex min-h-9 items-center rounded border border-red-100 bg-red-50 px-2 font-semibold uppercase tracking-wide text-red-800">
            Итого
          </div>
          {days.map(day => {
            const value = totalsByDay[day]?.total ?? 0
            return <CalendarTotalCell key={`total-${day}`} day={day} selectedDate={date} value={value} plan={totalsByDay[day]?.plan_total ?? 0} />
          })}
          <div className="flex min-h-9 items-center justify-center rounded border border-red-100 bg-red-50 font-mono font-semibold text-red-800">
            {fmt(days.reduce((sum, day) => sum + (totalsByDay[day]?.total ?? 0), 0))}
          </div>
        </div>
      </div>
    </section>
  )
}

function RowFragment({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function DayHeader({ day, selected }: { day: string; selected: boolean }) {
  const d = dateObj(day)
  const weekend = d.getDay() === 0 || d.getDay() === 6
  return (
    <div className={`flex min-h-9 flex-col items-center justify-center rounded border px-1 ${
      selected ? 'border-red-300 bg-red-50 text-red-800' : weekend ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-border bg-bg-surface text-text-muted'
    }`}>
      <span className="font-mono text-xs font-semibold">{day.split('-')[2]}</span>
      <span className="text-[9px] font-semibold uppercase">{WEEKDAY_SHORT[d.getDay()]}</span>
    </div>
  )
}

function CalendarCell({ day, selectedDate, value, plan }: { day: string; selectedDate: string; value: number; plan: number }) {
  const future = day > selectedDate
  const selected = day === selectedDate
  const tone = future ? 'empty' : progressTone(value, plan)
  const toneCls = toneClasses(tone)
  return (
    <div className={`flex min-h-8 items-center justify-center rounded border px-1 font-mono text-xs font-semibold ${
      selected ? 'border-red-300 bg-red-50' : toneCls.bg
    } ${future ? 'text-neutral-300' : toneCls.text}`}>
      {future ? '' : value > 0 ? fmt(value) : '·'}
    </div>
  )
}

function CalendarTotalCell({ day, selectedDate, value, plan }: { day: string; selectedDate: string; value: number; plan: number }) {
  const future = day > selectedDate
  const selected = day === selectedDate
  const tone = future ? 'empty' : progressTone(value, plan)
  const toneCls = toneClasses(tone)
  return (
    <div className={`flex min-h-9 items-center justify-center rounded border px-1 font-mono text-xs font-semibold ${
      selected ? 'border-red-300 bg-red-50' : toneCls.bg
    } ${future ? 'text-neutral-300' : toneCls.text}`}>
      {future ? '—' : value > 0 ? fmt(value) : '—'}
    </div>
  )
}

function BarRow({ label, value, max, variant = 'fact' }: { label: string; value: number; max: number; variant?: 'fact' | 'plan' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-text-muted">
        <span>{label}</span>
        <span>{fmt(value)}</span>
      </div>
      <div className={`h-7 overflow-hidden rounded border ${variant === 'plan' ? 'border-amber-200 bg-amber-50' : 'border-border bg-white'}`}>
        <div
          className={variant === 'plan' ? 'h-full bg-amber-400' : 'h-full bg-accent-red'}
          style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }}
        />
      </div>
    </div>
  )
}

function StackedFactBar({ bySection, max }: { bySection: Record<string, number>; max: number }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(bySection)
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => sectionNumber(a) - sectionNumber(b))
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  const width = Math.max(6, Math.min(100, total / max * 100))
  return (
    <div className="relative group">
      <div className="mb-1 flex justify-between text-[11px] text-text-muted">
        <span>Факт по участкам</span>
        <span>{fmt(total)}</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex h-7 overflow-hidden rounded border border-border bg-white text-left outline-none ring-offset-2 transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-red-300"
        style={{ width: `${width}%` }}
        aria-label="Разбивка факта по участкам"
      >
        {entries.length === 0 ? (
          <div className="w-full bg-neutral-100" />
        ) : entries.map(([code, value]) => (
          <div
            key={code}
            title={`${code}: ${fmt(value)} шт`}
            style={{ width: `${value / total * 100}%`, background: colorForSection(code) }}
          />
        ))}
      </button>
      <div className={`${open ? 'block' : 'hidden group-hover:block'} absolute bottom-full left-0 z-30 mb-2 w-56 rounded-md border border-border bg-white p-3 text-xs shadow-lg`}>
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
          <span className="font-semibold text-text-primary">Факт по участкам</span>
          <span className="font-mono text-text-muted">{fmt(total)} шт</span>
        </div>
        <div className="space-y-1.5">
          {entries.length === 0 ? (
            <div className="text-text-muted">Факта нет</div>
          ) : entries.map(([code, value]) => (
            <div key={code} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorForSection(code) }} />
                <span className="truncate text-text-secondary">Участок №{sectionNumber(code)}</span>
              </span>
              <span className="shrink-0 font-mono font-semibold text-text-primary">{fmt(value)} шт</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
