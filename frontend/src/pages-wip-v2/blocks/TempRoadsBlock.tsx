/**
 * Блок «Схемы отсыпки временных автодорог».
 * Каждая карточка — SVG-схема в стиле суточного PDF-отчёта:
 *   6 треков (Пионерка, ЗП в работе, ДСО, Под ЩПГС, ЗП готово, Не в работе),
 *   ось ПК с тиками и подписями, границы ВСЖМ/АД, статистика и легенда.
 * «Не в работе» вычисляется как ВСЖМ-спан минус объединение остальных сегментов.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Layers } from 'lucide-react'

type StatusType =
  | 'shpgs_done'
  | 'ready_for_shpgs'
  | 'dso'
  | 'subgrade_not_to_grade'
  | 'pioneer_fill'
  | 'no_work'
  | string

interface Seg {
  // Старые поля — координата на текущей оси (rail, если rail-мэппинг есть, иначе AD).
  pk_start: number; pk_end: number
  // Новые поля — обе координаты, чтобы длины считать всегда в АД (как в PDF).
  ad_pk_start?: number | null; ad_pk_end?: number | null
  rail_pk_start?: number | null; rail_pk_end?: number | null
  status_type: StatusType; is_demo?: boolean
}
interface Road {
  id: string; code: string; name: string
  ad_pk_start: number; ad_pk_end: number
  rail_pk_start: number | null; rail_pk_end: number | null
  length_m: number | null
  effective_date: string | null
  section_code?: string | null
  segments: Seg[]
}

interface UpdatedRow { road_code: string; status_type: StatusType; last_updated: string }

type TrackKey =
  | 'pioneer_fill'
  | 'subgrade_not_to_grade'
  | 'dso'
  | 'ready_for_shpgs'
  | 'shpgs_done'
  | 'no_work'

// Порядок треков — сверху вниз, как в PDF.
const TRACKS: TrackKey[] = [
  'pioneer_fill',
  'subgrade_not_to_grade',
  'dso',
  'ready_for_shpgs',
  'shpgs_done',
  'no_work',
]

const TRACK_LABEL: Record<TrackKey, string> = {
  pioneer_fill:          'Пионерка',
  subgrade_not_to_grade: 'ЗП в работе',
  dso:                   'ДСО',
  ready_for_shpgs:       'Под ЩПГС',
  shpgs_done:            'ЗП готово',
  no_work:               'Не в работе',
}

const TRACK_FILL: Record<TrackKey, string> = {
  pioneer_fill:          '#E8DDF5',
  subgrade_not_to_grade: '#FCE5CD',
  dso:                   '#FFF2CC',
  ready_for_shpgs:       '#D9EAF7',
  shpgs_done:            '#D9EAD3',
  no_work:               'url(#hatch)',
}

const TRACK_STROKE: Record<TrackKey, string> = {
  pioneer_fill:          '#7c3aed',
  subgrade_not_to_grade: '#d97706',
  dso:                   '#ca8a04',
  ready_for_shpgs:       '#2563eb',
  shpgs_done:            '#16a34a',
  no_work:               '#6b7280',
}

function toTrack(st: StatusType): TrackKey | null {
  if (st === 'shpgs_done') return 'shpgs_done'
  if (st === 'ready_for_shpgs') return 'ready_for_shpgs'
  if (st === 'dso') return 'dso'
  if (st === 'subgrade_not_to_grade') return 'subgrade_not_to_grade'
  if (st === 'pioneer_fill') return 'pioneer_fill'
  return null
}

function formatPk(pk100: number): string {
  const sign = pk100 < 0 ? '-' : ''
  const abs = Math.abs(pk100)
  const pk = Math.floor(abs / 100)
  const plus = abs - pk * 100
  return `${sign}ПК${pk}+${plus.toFixed(2).padStart(5, '0')}`
}

type Range = [number, number]

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as Range).sort((a, b) => a[0] - b[0])
  const out: Range[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]
    const last = out[out.length - 1]
    if (s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

function subtractRanges(universe: Range, ranges: Range[]): Range[] {
  const [uStart, uEnd] = universe
  const merged = mergeRanges(ranges)
  const out: Range[] = []
  let cursor = uStart
  for (const [s, e] of merged) {
    if (e <= uStart) continue
    if (s >= uEnd) break
    const ss = Math.max(s, uStart)
    const ee = Math.min(e, uEnd)
    if (ss > cursor) out.push([cursor, ss])
    cursor = Math.max(cursor, ee)
  }
  if (cursor < uEnd) out.push([cursor, uEnd])
  return out
}

// Шаг подбирается так, чтобы на оси получалось ~8–15 подписей.
function pkTicks(pkStart: number, pkEnd: number): { pk: number; labelled: boolean }[] {
  const startPK = Math.ceil(pkStart / 100)
  const endPK = Math.floor(pkEnd / 100)
  const count = Math.max(0, endPK - startPK + 1)
  if (count <= 0) return []
  const steps = [1, 2, 5, 10, 20, 50]
  let step = 1
  for (const s of steps) {
    if (Math.ceil(count / s) <= 15) { step = s; break }
  }
  const ticks: { pk: number; labelled: boolean }[] = []
  for (let pk = startPK; pk <= endPK; pk++) {
    ticks.push({ pk, labelled: pk % step === 0 })
  }
  return ticks
}

// Участки по дороге. Сплит-дороги (АД8 №1, АД4 №8) принадлежат двум участкам.
const ROAD_TO_SECTIONS: Record<string, number[]> = {
  'АД9': [1], 'АД6': [1], 'АД5': [1], 'АД13': [1],
  'АД14': [2],
  'АД7': [3], 'АД15': [3], 'АД1': [3],
  'АД8 №1': [3, 4],
  'АД3': [4],
  'АД8 №2': [5], 'АД11': [5],
  'АД12': [6], 'АД2 №6': [6],
  'АД2 №7': [7], 'АД4 №7': [7],
  'АД4 №8': [7, 8],
  'АД4 №8.1': [8], 'АД4 №9': [8],
}

function parseRoad(road: Road): { title: string; sectionNum: number | null; sections: number[] } {
  const raw = road.code || road.name || ''
  const m = raw.match(/^АД\s*(\d+(?:\.\d+)?)\s*(№\s*\d+(?:\.\d+)?)?$/i)
  let title = raw
  if (m) {
    const x = m[1]
    const y = (m[2] || '').replace(/\s+/g, '')
    title = y ? `АД${x} ${y}` : `АД${x}`
  }
  const sections = ROAD_TO_SECTIONS[raw] ?? []
  return { title, sectionNum: sections[0] ?? null, sections }
}

function formatMeters(m: number): string {
  const rounded = Math.round(m * 100) / 100
  const [i, f = '00'] = rounded.toFixed(2).split('.')
  // Пробельный разделитель тысяч как в PDF: "1 099.00"
  const iGrouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
  return `${iGrouped}.${f}`
}

export function TempRoadsBlock({ to }: { to: string; view: 'table'|'cards'|'timeline' }) {
  const { data, isLoading } = useQuery<{ roads: Road[]; as_of: string }>({
    queryKey: ['wip', 'temp-roads', to],
    queryFn: () => fetch(`/api/wip/temp-roads/status?to=${to}`).then(r => r.json()),
  })

  const { data: updatedData } = useQuery<{ rows: UpdatedRow[] }>({
    queryKey: ['wip', 'temp-roads', 'updated'],
    queryFn: () => fetch(`/api/wip/temp-roads/updated`).then(r => r.json()),
    staleTime: 60_000,
  })

  const updatedMap = useMemo(() => {
    const m: Record<string, Partial<Record<TrackKey, string>>> = {}
    for (const r of updatedData?.rows ?? []) {
      const key = toTrack(r.status_type)
      if (!key) continue
      m[r.road_code] ??= {}
      const prev = m[r.road_code][key]
      if (!prev || r.last_updated > prev) m[r.road_code][key] = r.last_updated
    }
    return m
  }, [updatedData])

  const [sectionFilter, setSectionFilter] = useState<number | 'all'>('all')

  if (isLoading || !data) {
    return (
      <section className="bg-white border border-border rounded-xl p-5 shadow-sm animate-pulse">
        <div className="h-6 w-64 bg-bg-surface rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 bg-bg-surface rounded-lg" />)}
        </div>
      </section>
    )
  }

  const parsed = data.roads.map(r => ({ road: r, ...parseRoad(r) }))
  const filtered = sectionFilter === 'all'
    ? parsed
    : parsed.filter(p => p.sections.includes(sectionFilter))

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Layers className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading tracking-wide uppercase">
          Схемы отсыпки временных автодорог
        </h2>
        <span className="text-xs text-text-muted">
          {data.roads.length} АД · схемы из суточного PDF-отчёта
        </span>

        <div className="ml-auto flex items-center gap-1">
          <PillChip active={sectionFilter === 'all'} onClick={() => setSectionFilter('all')}>все</PillChip>
          {[1,2,3,4,5,6,7,8].map(n => (
            <PillChip key={n} active={sectionFilter === n} onClick={() => setSectionFilter(n)}>№{n}</PillChip>
          ))}
        </div>
      </div>

      {/* Общая легенда — 6 статусов, как в PDF */}
      <div className="flex flex-wrap items-center gap-4 mb-5 text-[11px]">
        {TRACKS.map(k => (
          <span key={k} className="flex items-center gap-1.5">
            <LegendSwatch k={k} />
            <span className="text-text-secondary">{TRACK_LABEL[k]}</span>
          </span>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-sm text-text-muted py-8 text-center">
          Нет АД для выбранного участка.
        </div>
      )}

      <div className="flex flex-col gap-5">
        {filtered.map(({ road, title }) => (
          <RoadCard
            key={road.id}
            road={road}
            title={title}
            updated={updatedMap[road.code] ?? {}}
          />
        ))}
      </div>
    </section>
  )
}

function LegendSwatch({ k }: { k: TrackKey }) {
  if (k === 'no_work') {
    return (
      <span
        className="inline-block w-3.5 h-3 rounded-[2px] border border-[#6b7280]"
        style={{ background: 'repeating-linear-gradient(45deg, transparent 0 3px, #9ca3af 3px 4px)' }}
      />
    )
  }
  return (
    <span
      className="inline-block w-3.5 h-3 rounded-[2px]"
      style={{ background: TRACK_FILL[k], border: `1px solid ${TRACK_STROKE[k]}` }}
    />
  )
}

function PillChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${
        active
          ? 'bg-slate-800 text-white'
          : 'bg-white text-gray-600 border border-gray-200 hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

interface PaintedSeg { track: TrackKey; absStart: number; absEnd: number; isDemo: boolean }

function RoadCard({ road, title, updated }: {
  road: Road; title: string; updated: Partial<Record<TrackKey, string>>
}) {
  // Ось: ВСЖМ если есть, иначе АД (напр. АД4 №8.1 без rail-мэппинга).
  const hasRail = road.rail_pk_start != null && road.rail_pk_end != null
  const axisStart = hasRail ? Math.min(road.rail_pk_start!, road.rail_pk_end!) : road.ad_pk_start
  const axisEnd   = hasRail ? Math.max(road.rail_pk_start!, road.rail_pk_end!) : road.ad_pk_end
  const span = Math.max(1, axisEnd - axisStart)
  // Длина дороги для карточки — АД-пикетаж (как в PDF).
  const adSpan = Math.abs(road.ad_pk_end - road.ad_pk_start)
  const lengthKm = (road.length_m ?? adSpan) / 1000

  // Сегменты: 5 известных статусов + производный «не в работе» из незакрытых диапазонов.
  // Позиционирование — в координатах оси (rail либо AD); длины в легенде — всегда в АД.
  const { painted, totals } = useMemo(() => {
    const totals: Record<TrackKey, number> = {
      pioneer_fill: 0, subgrade_not_to_grade: 0, dso: 0,
      ready_for_shpgs: 0, shpgs_done: 0, no_work: 0,
    }
    const out: PaintedSeg[] = []
    const coveredAxis: Range[] = []
    const coveredAd: Range[] = []
    for (const s of road.segments) {
      const t = toTrack(s.status_type)
      if (!t) continue
      const a = Math.min(s.pk_start, s.pk_end), b = Math.max(s.pk_start, s.pk_end)
      if (b <= a) continue
      // Длина в АД — из ad_pk_*; если их нет (старый ответ API), считаем по оси.
      const adA = s.ad_pk_start != null && s.ad_pk_end != null
        ? Math.min(s.ad_pk_start, s.ad_pk_end) : a
      const adB = s.ad_pk_start != null && s.ad_pk_end != null
        ? Math.max(s.ad_pk_start, s.ad_pk_end) : b
      totals[t] += adB - adA
      out.push({ track: t, absStart: a, absEnd: b, isDemo: !!s.is_demo })
      coveredAxis.push([a, b])
      coveredAd.push([adA, adB])
    }
    // «Не в работе» для карты — по оси; для totals — АД-остаток.
    for (const [a, b] of subtractRanges([axisStart, axisEnd], coveredAxis)) {
      if (b - a < 0.01) continue
      out.push({ track: 'no_work', absStart: a, absEnd: b, isDemo: false })
    }
    const adRoadStart = Math.min(road.ad_pk_start, road.ad_pk_end)
    const adRoadEnd   = Math.max(road.ad_pk_start, road.ad_pk_end)
    for (const [a, b] of subtractRanges([adRoadStart, adRoadEnd], coveredAd)) {
      if (b - a < 0.01) continue
      totals.no_work += b - a
    }
    return { painted: out, totals }
  }, [road, axisStart, axisEnd])

  const lReady = totals.ready_for_shpgs + totals.shpgs_done
  const pctReady = adSpan > 0 ? (lReady / adSpan) * 100 : 0
  // Эвристика темпа: оставшийся «не-готовый» АД-диапазон / 30 сут.
  const tempo = Math.max(0, adSpan - lReady) / 30

  const ticks = useMemo(() => pkTicks(axisStart, axisEnd), [axisStart, axisEnd])

  // SVG-геометрия (увеличили треки и подписи для лучшей читаемости).
  const VIEW_W = 1000, PAD_L = 90, PAD_R = 10
  const DRAW_W = VIEW_W - PAD_L - PAD_R
  const TRACK_H = 28, TRACK_GAP = 5
  const TRACKS_Y0 = 22
  const TRACKS_H = TRACKS.length * TRACK_H + (TRACKS.length - 1) * TRACK_GAP
  const AXIS_Y = TRACKS_Y0 + TRACKS_H + 6
  const BOTTOM_LABEL_Y = AXIS_Y + 34
  const VIEW_H = BOTTOM_LABEL_Y + 4

  const xOf = (pk100: number) => PAD_L + ((pk100 - axisStart) / span) * DRAW_W
  const trackY = (i: number) => TRACKS_Y0 + i * (TRACK_H + TRACK_GAP)

  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{
    x: number; y: number; pk100: number; seg: PaintedSeg | null
  } | null>(null)

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap) return
    const rect = svg.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const scale = rect.width / VIEW_W
    const localX = (e.clientX - rect.left) / scale
    const localY = (e.clientY - rect.top) / scale
    if (localX < PAD_L || localX > VIEW_W - PAD_R) { setHover(null); return }
    if (localY < TRACKS_Y0 - 2 || localY > TRACKS_Y0 + TRACKS_H + 2) { setHover(null); return }
    const pk100 = axisStart + ((localX - PAD_L) / DRAW_W) * span
    const trackIdx = Math.min(
      TRACKS.length - 1,
      Math.max(0, Math.floor((localY - TRACKS_Y0) / (TRACK_H + TRACK_GAP))),
    )
    const track = TRACKS[trackIdx]
    const seg = painted.find(p => p.track === track && pk100 >= p.absStart && pk100 <= p.absEnd) ?? null
    setHover({
      x: e.clientX - wrapRect.left,
      y: e.clientY - wrapRect.top,
      pk100,
      seg,
    })
  }

  const topLeftLabel = hasRail ? formatPk(axisStart) : 'ВСЖМ —'
  const topRightLabel = hasRail ? formatPk(axisEnd) : ''

  return (
    <div ref={wrapRef} className="relative border border-border rounded-lg p-3 bg-white">
      <div className="font-heading font-bold text-[13px] text-text-primary mb-1">
        {title} — {lengthKm.toFixed(2)} км
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        className="block select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern
            id={`hatch-${road.id}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="#9ca3af" strokeWidth="1.2" />
          </pattern>
        </defs>

        {/* Верхние подписи ВСЖМ-ПК */}
        <text x={PAD_L} y={10} fontSize={13}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fill="#404040" textAnchor="start">{topLeftLabel}</text>
        {topRightLabel && (
          <text x={VIEW_W - PAD_R} y={10} fontSize={13}
            fontFamily="'JetBrains Mono', ui-monospace, monospace"
            fill="#404040" textAnchor="end">{topRightLabel}</text>
        )}

        {/* Треки */}
        {TRACKS.map((k, i) => {
          const y = trackY(i)
          const fill = k === 'no_work' ? `url(#hatch-${road.id})` : TRACK_FILL[k]
          return (
            <g key={k}>
              <text x={PAD_L - 6} y={y + TRACK_H / 2 + 3} fontSize={13}
                fontFamily="'Onest', system-ui, sans-serif" fill="#404040" textAnchor="end">
                {TRACK_LABEL[k]}
              </text>
              <rect x={PAD_L} y={y} width={DRAW_W} height={TRACK_H}
                fill="white" stroke="#d1d5db" strokeWidth={0.6} />
              {ticks.filter(t => t.labelled).map(t => (
                <line key={`g-${k}-${t.pk}`}
                  x1={xOf(t.pk * 100)} y1={y} x2={xOf(t.pk * 100)} y2={y + TRACK_H}
                  stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray="2 2" />
              ))}
              {painted.filter(p => p.track === k).map((p, idx) => {
                const x = xOf(p.absStart)
                const w = Math.max(0.8, xOf(p.absEnd) - x)
                return (
                  <rect key={`s-${k}-${idx}`} x={x} y={y} width={w} height={TRACK_H}
                    fill={fill} stroke={TRACK_STROKE[k]} strokeWidth={0.8}
                    opacity={p.isDemo ? 0.75 : 1} />
                )
              })}
            </g>
          )
        })}

        {/* Ось ПК */}
        <line x1={PAD_L} y1={AXIS_Y} x2={VIEW_W - PAD_R} y2={AXIS_Y}
          stroke="#9ca3af" strokeWidth={0.6} />
        {ticks.map(t => {
          const x = xOf(t.pk * 100)
          return (
            <g key={`t-${t.pk}`}>
              <line x1={x} y1={AXIS_Y} x2={x} y2={AXIS_Y + (t.labelled ? 5 : 3)}
                stroke="#9ca3af" strokeWidth={0.6} />
              {t.labelled && (
                <text x={x} y={AXIS_Y + 15} fontSize={10}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fill="#6b7280" textAnchor="middle">ПК{t.pk}</text>
              )}
            </g>
          )
        })}

        {/* Нижние подписи АД-ПК */}
        <text x={PAD_L} y={BOTTOM_LABEL_Y} fontSize={13}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fill="#404040" textAnchor="start">АД {formatPk(road.ad_pk_start)}</text>
        <text x={VIEW_W - PAD_R} y={BOTTOM_LABEL_Y} fontSize={13}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fill="#404040" textAnchor="end">АД {formatPk(road.ad_pk_end)}</text>
      </svg>

      {/* Статистика */}
      <div className="mt-2 text-[11px] text-text-secondary">
        <span className="font-semibold">L</span>
        <sub className="text-[9px]">щпгс+готово</sub>
        {' = '}<span className="font-mono">{formatMeters(lReady)} м</span>
        {' | '}
        <span className="font-semibold">%</span>
        <sub className="text-[9px]">щпгс+готово</sub>
        {' = '}<span className="font-mono">{pctReady.toFixed(1)}%</span>
        {' | '}
        <span>Треб. темп передачи ЗП под ЩПГС = </span>
        <span className="font-mono">{tempo.toFixed(2)} м/сут</span>
      </div>

      {/* Легенда с длинами */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
        {TRACKS.map(k => (
          <span key={k} className="flex items-center gap-1">
            <LegendSwatch k={k} />
            <span className="text-text-secondary">{TRACK_LABEL[k]}:</span>
            <span className="font-mono text-text-primary">{formatMeters(totals[k])} м</span>
          </span>
        ))}
      </div>

      {/* Кастомный тултип */}
      {hover && hover.seg && (
        <div
          className="absolute z-40 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1.5 bg-[#1a1a1a] text-white rounded-md shadow-xl text-[10px] leading-snug whitespace-nowrap"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-mono font-semibold">{formatPk(hover.pk100)}</div>
          <div className="text-neutral-300">{TRACK_LABEL[hover.seg.track]}</div>
          {(() => {
            const key = hover.seg.track
            const ud = updated[key]
            if (ud) return <div className="text-neutral-400">обновлено {ud}</div>
            if (road.effective_date) return <div className="text-neutral-400">обновлено {road.effective_date}</div>
            return null
          })()}
        </div>
      )}
    </div>
  )
}
