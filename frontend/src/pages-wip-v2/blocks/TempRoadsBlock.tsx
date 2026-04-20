/**
 * Блок «Временные автодороги»: схемы осей с целыми ПК,
 * закрашиваем сегменты по статусу.
 */
import { useQuery } from '@tanstack/react-query'
import { Construction } from 'lucide-react'

type StatusType = 'pioneer_fill' | 'subgrade_not_to_grade' | 'ready_for_shpgs' | 'shpgs_done' | 'no_work'

interface Seg { pk_start: number; pk_end: number; status_type: StatusType; is_demo?: boolean }
interface Road {
  id: string; code: string; name: string
  ad_pk_start: number; ad_pk_end: number; length_m: number | null
  effective_date: string | null
  segments: Seg[]
}

const STATUS_COLOR: Record<StatusType, string> = {
  shpgs_done:            '#16a34a',
  ready_for_shpgs:       '#f59e0b',
  subgrade_not_to_grade: '#dc2626',
  pioneer_fill:          '#7f1d1d',
  no_work:               '#e5e5e5',
}
const STATUS_LABEL: Record<StatusType, string> = {
  shpgs_done:            'готово по ЩПГС',
  ready_for_shpgs:       'готово земполотно',
  subgrade_not_to_grade: 'земполотно не в отметке',
  pioneer_fill:          'пионерная отсыпка',
  no_work:               'работ не ведётся',
}

function fmtPK(pk100: number): string {
  // pk100 — в единицах «долей ПК» (100 = один ПК). В БД и API — в чистых
  // «PK × 100 + плюс метры». Логика совпадает с твоим RailwayCrossSection.
  const pk = Math.floor(pk100 / 100)
  const plus = pk100 - pk * 100
  return `ПК${pk}+${plus.toFixed(2).padStart(5, '0')}`
}

function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`
}

export function TempRoadsBlock({ to, view: _v }: { to: string; view: 'table'|'cards'|'timeline' }) {
  const { data, isLoading } = useQuery<{ roads: Road[]; as_of: string }>({
    queryKey: ['wip', 'temp-roads', to],
    queryFn: () => fetch(`/api/wip/temp-roads/status?to=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) return <SkeletonBlock title="Временные автодороги" />

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Construction className="w-5 h-5 text-accent-red" />
        <h2 className="font-heading font-bold text-lg">Временные автодороги</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          на {data.as_of} · {data.roads.length} АД
        </span>
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-3 mb-5 text-xs">
        {(['shpgs_done','ready_for_shpgs','subgrade_not_to_grade','pioneer_fill'] as StatusType[]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="space-y-4">
        {data.roads.map(road => <RoadLine key={road.id} road={road} />)}
      </div>
    </section>
  )
}

function RoadLine({ road }: { road: Road }) {
  const span = road.ad_pk_end - road.ad_pk_start
  if (span <= 0) return null

  // Целые ПК внутри диапазона (целое значение PK × 100)
  const firstPK = Math.ceil(road.ad_pk_start / 100)
  const lastPK = Math.floor(road.ad_pk_end / 100)
  const intPK: number[] = []
  for (let p = firstPK; p <= lastPK; p++) intPK.push(p * 100)

  const byStatus = road.segments.reduce<Record<string, number>>((acc, s) => {
    const key = s.status_type
    acc[key] = (acc[key] || 0) + (s.pk_end - s.pk_start)
    return acc
  }, {})

  return (
    <div className="border border-border rounded-lg p-4 bg-white">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-heading font-bold text-sm">{road.code}</span>
        <span className="text-sm text-text-secondary">{road.name}</span>
        <span className="ml-auto text-xs font-mono text-text-muted">
          {fmtPK(road.ad_pk_start)} — {fmtPK(road.ad_pk_end)}
          {road.length_m && <> · {fmtLen(road.length_m)}</>}
        </span>
      </div>

      {/* SVG-схема */}
      <svg viewBox={`0 0 1000 50`} className="w-full h-10">
        {/* базовая линия */}
        <rect x={0} y={18} width={1000} height={14} fill="#e5e5e5" rx={2} />
        {/* сегменты */}
        {road.segments.map((s, i) => {
          const x = ((s.pk_start - road.ad_pk_start) / span) * 1000
          const w = ((s.pk_end - s.pk_start) / span) * 1000
          return (
            <rect key={i} x={x} y={18} width={Math.max(w, 0.5)} height={14}
                  fill={STATUS_COLOR[s.status_type] ?? '#ccc'}
                  opacity={s.is_demo ? 0.6 : 1} />
          )
        })}
        {/* целые ПК — засечки снизу */}
        {intPK.map(p => {
          const x = ((p - road.ad_pk_start) / span) * 1000
          return (
            <g key={p}>
              <line x1={x} x2={x} y1={32} y2={38} stroke="#737373" strokeWidth={1} />
              {(p/100) % 5 === 0 && (
                <text x={x} y={48} fontSize={9} textAnchor="middle" fill="#737373"
                      fontFamily="JetBrains Mono, monospace">
                  {p/100}
                </text>
              )}
            </g>
          )
        })}
        {/* концы диапазона */}
        <line x1={0} x2={0} y1={10} y2={40} stroke="#1a1a1a" strokeWidth={1.5} />
        <line x1={1000} x2={1000} y1={10} y2={40} stroke="#1a1a1a" strokeWidth={1.5} />
      </svg>

      {/* Текстовая разбивка */}
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 text-xs font-mono">
        {(Object.keys(byStatus) as StatusType[])
          .sort((a,b) => byStatus[b] - byStatus[a])
          .map(st => (
          <li key={st} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[st] }} />
            <span className="text-text-secondary">{STATUS_LABEL[st]}:</span>
            <span className="ml-auto text-text-primary">{fmtLen(byStatus[st])}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SkeletonBlock({ title }: { title: string }) {
  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm animate-pulse">
      <h2 className="font-heading font-bold text-lg mb-4">{title}</h2>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-bg-surface rounded-lg" />)}
      </div>
    </section>
  )
}
