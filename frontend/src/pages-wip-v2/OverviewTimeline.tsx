/**
 * OverviewTimeline — таймлайн работ.
 * Источник: GET /api/wip/overview/timeline?section=
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Event {
  code: string
  name: string
  first: string
  last: string
  days: number
  total_volume: number
  unit: string
}

interface TimelineResp {
  section: string
  events: Event[]
}

const PALETTE = ['#1a1a1a', '#dc2626', '#7f1d1d', '#991b1b', '#525252', '#404040', '#d97706', '#0891b2']

const SECTIONS = [
  { value: 'all', label: 'все' },
  ...Array.from({ length: 8 }, (_, i) => ({ value: `UCH_${i + 1}`, label: `№${i + 1}` })),
]

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))

function hashColor(code: string): string {
  let h = 0
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function diffDays(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86400000
}

function monthTicks(start: Date, end: Date): { date: Date; label: string }[] {
  const ticks: { date: Date; label: string }[] = []
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  if (cur.getTime() < start.getTime()) cur.setUTCMonth(cur.getUTCMonth() + 1)
  while (cur.getTime() <= end.getTime()) {
    ticks.push({
      date: new Date(cur),
      label: cur.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }),
    })
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return ticks
}

export default function OverviewTimeline(_props: { from: string; to: string }) {
  const [section, setSection] = useState<string>('all')

  const { data, isLoading, isError } = useQuery<TimelineResp>({
    queryKey: ['wip', 'overview', 'timeline', section],
    queryFn: () => fetch(`/api/wip/overview/timeline?section=${section}`).then(r => r.json()),
  })

  const events = data?.events ?? []

  const axis = useMemo(() => {
    if (events.length === 0) return null
    const firsts = events.map(e => parseDate(e.first).getTime())
    const lasts = events.map(e => parseDate(e.last).getTime())
    const minT = Math.min(...firsts)
    const maxT = Math.max(...lasts)
    const start = addDays(new Date(minT), -3)
    const end = addDays(new Date(maxT), 3)
    const totalDays = diffDays(start, end)
    return { start, end, totalDays, ticks: monthTicks(start, end) }
  }, [events])

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-heading font-bold text-lg">Таймлайн работ</h2>
      </div>

      {/* Section selector */}
      <div className="flex flex-wrap gap-1 mb-4">
        {SECTIONS.map(s => (
          <button
            key={s.value}
            onClick={() => setSection(s.value)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition ${
              section === s.value
                ? 'bg-text-primary text-text-on-dark border-text-primary'
                : 'bg-bg-card text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isError && <div className="text-sm text-accent-red">Ошибка загрузки таймлайна</div>}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 rounded bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && events.length === 0 && !isError && (
        <div className="text-sm text-text-muted py-8 text-center">Нет событий</div>
      )}

      {!isLoading && events.length > 0 && axis && (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Axis */}
            <div className="flex items-stretch text-xs text-text-muted border-b border-border pb-1 mb-2">
              <div className="w-[240px] shrink-0" />
              <div className="relative flex-1 h-5">
                {axis.ticks.map((t, i) => {
                  const leftPct = (diffDays(axis.start, t.date) / axis.totalDays) * 100
                  return (
                    <div
                      key={i}
                      className="absolute top-0 text-[10px] font-mono"
                      style={{ left: `${leftPct}%` }}
                    >
                      <span className="pl-1">{t.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Rows */}
            <div className="space-y-1.5">
              {events.map(ev => {
                const s = parseDate(ev.first)
                const e = parseDate(ev.last)
                const leftPct = (diffDays(axis.start, s) / axis.totalDays) * 100
                const widthPct = Math.max((diffDays(s, e) / axis.totalDays) * 100, 0.8)
                const color = hashColor(ev.code)
                return (
                  <div key={ev.code} className="flex items-center group">
                    <div className="w-[240px] shrink-0 pr-3">
                      <div className="text-xs font-medium text-text-primary truncate" title={ev.name}>{ev.name}</div>
                      <div className="text-[10px] font-mono text-text-muted">{ev.code}</div>
                    </div>
                    <div className="relative flex-1 h-7">
                      {/* gridlines */}
                      {axis.ticks.map((t, i) => {
                        const lp = (diffDays(axis.start, t.date) / axis.totalDays) * 100
                        return (
                          <div
                            key={i}
                            className="absolute top-0 bottom-0 border-l border-border/50"
                            style={{ left: `${lp}%` }}
                          />
                        )
                      })}
                      <div
                        className="absolute top-1 h-5 rounded-md shadow-sm flex items-center px-2 text-[10px] font-mono text-white whitespace-nowrap overflow-hidden"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }}
                        title={`${ev.first} — ${ev.last} · ${ev.days} дн · ${fmt(ev.total_volume)} ${ev.unit}`}
                      >
                        {widthPct > 8 && <span>{fmt(ev.total_volume)} {ev.unit}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
