/**
 * WIP Analytics v2.
 *
 * Принцип: числа — главные, проценты — только в прогресс-барах.
 * 4 категории (Песок, Грунт, ЩПГС, Возка) + донат по карьерам
 * справа от каждой категории.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { TrendingUp, Filter } from 'lucide-react'
import { PeriodBar, usePeriod } from './PeriodBar'

type Bucket = 'own' | 'almaz' | 'other_hired'
type CatKey = 'sand' | 'soil' | 'shps' | 'transport'

interface Category {
  fact: number
  plan: number
  trips: number
  by_section: Record<string, number>
  by_shift: { day: number; night: number }
  by_contractor: Record<Bucket, number>
}
interface SummaryResponse {
  from: string; to: string
  categories: Record<CatKey, Category>
  sections: string[]
}

const CAT_LABEL: Record<CatKey, string> = {
  sand: 'Песок, м³',
  soil: 'Грунт, м³',
  shps: 'ЩПГС, м³',
  transport: 'Возка (всего), м³',
}
const CAT_UNIT: Record<CatKey, string> = {
  sand: 'м³', soil: 'м³', shps: 'м³', transport: 'м³',
}
const BUCKET_COLOR: Record<Bucket, string> = {
  own: '#1a1a1a', almaz: '#dc2626', other_hired: '#7f1d1d',
}
const BUCKET_LABEL: Record<Bucket, string> = {
  own: 'Свои', almaz: 'АЛМАЗ', other_hired: 'Прочие',
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}
function sectionLabel(code: string): string {
  if (code === 'UCH_31' || code === 'UCH_32') return '3'
  const m = code.match(/UCH_(\d)/)
  return m ? m[1] : code
}

export default function WipAnalyticsV2() {
  const { from, to } = usePeriod()
  const [sectionFilter, setSectionFilter] = useState<string>('all')

  const { data, isLoading } = useQuery<SummaryResponse>({
    queryKey: ['wip', 'analytics-summary', from, to, sectionFilter],
    queryFn: () => {
      const url = `/api/wip/analytics/summary?from=${from}&to=${to}` +
                  (sectionFilter !== 'all' ? `&section=${sectionFilter}` : '')
      return fetch(url).then(r => r.json())
    },
  })

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <PeriodBar />

      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <TrendingUp className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Аналитика (WIP v2)
        </h1>
        <Filter className="w-4 h-4 text-text-muted" />
        <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)}
          className="px-3 py-1.5 text-xs border border-border rounded-md bg-white">
          <option value="all">Все участки</option>
          <option value="UCH_1">Участок №1</option>
          <option value="UCH_2">Участок №2</option>
          <option value="UCH_3">Участок №3</option>
          <option value="UCH_4">Участок №4</option>
          <option value="UCH_5">Участок №5</option>
          <option value="UCH_6">Участок №6</option>
          <option value="UCH_7">Участок №7</option>
          <option value="UCH_8">Участок №8</option>
        </select>
      </div>

      <div className="p-4 sm:p-6 pb-24 lg:pb-6 space-y-6">
        {isLoading || !data ? (
          [...Array(4)].map((_, i) =>
            <div key={i} className="h-40 bg-bg-card border border-border rounded-xl animate-pulse" />)
        ) : (
          (['sand','soil','shps','transport'] as CatKey[]).map((k, i) => (
            <motion.div key={k} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}
                        transition={{ delay: i * 0.05 }}>
              <CategoryCard keyName={k} data={data.categories[k]}
                            sections={data.sections}
                            from={from} to={to}
                            sectionFilter={sectionFilter} />
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}

function CategoryCard({
  keyName, data, sections, from, to, sectionFilter,
}: {
  keyName: CatKey; data: Category; sections: string[]
  from: string; to: string; sectionFilter: string
}) {
  const pct = data.plan > 0 ? Math.min(100, data.fact / data.plan * 100) : 0
  const matForDonut = keyName === 'sand' ? 'SAND'
                    : keyName === 'soil' ? 'SOIL'
                    : keyName === 'shps' ? 'SHPGS'
                    : undefined

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-heading font-bold text-lg">{CAT_LABEL[keyName]}</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-text-muted">
          всего за период
        </span>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Левая треть: big number + факт/план + смены + подрядчики */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div>
            <div className="font-mono text-5xl font-bold text-text-primary leading-none">
              {fmt(data.fact)}
            </div>
            <div className="text-xs text-text-muted mt-1">
              {CAT_UNIT[keyName]} · {fmt(data.trips)} рейс.
            </div>
          </div>

          {data.plan > 0 && (
            <div>
              <div className="flex items-baseline gap-2 text-xs text-text-secondary mb-1.5">
                <span>План: <b className="text-text-primary font-mono">{fmt(data.plan)}</b></span>
                <span className="ml-auto font-mono font-semibold text-text-primary">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                <div className="h-full bg-accent-red transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {/* Смены */}
          <div className="grid grid-cols-2 gap-2">
            <ShiftCell label="День"  value={data.by_shift.day} />
            <ShiftCell label="Ночь" value={data.by_shift.night} />
          </div>

          {/* Подрядчики */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              По силам
            </div>
            <div className="h-2 bg-bg-surface rounded-full overflow-hidden flex">
              {(['own','almaz','other_hired'] as Bucket[]).map(b =>
                data.by_contractor[b] > 0 && (
                  <div key={b} style={{
                    width: `${data.by_contractor[b] / (data.fact || 1) * 100}%`,
                    background: BUCKET_COLOR[b],
                  }} title={`${BUCKET_LABEL[b]}: ${fmt(data.by_contractor[b])}`} />
                )
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] font-mono">
              {(['own','almaz','other_hired'] as Bucket[]).map(b => (
                <span key={b} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                  <span className="text-text-secondary">{BUCKET_LABEL[b]}:</span>
                  <span className="text-text-primary">{fmt(data.by_contractor[b])}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Средняя треть: столбики по участкам */}
        <div className="col-span-12 lg:col-span-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            По участкам
          </div>
          <SectionBars data={data.by_section} sections={sections} />
        </div>

        {/* Правая треть: донат по карьерам */}
        <div className="col-span-12 lg:col-span-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            По карьерам
          </div>
          <QuarryDonut from={from} to={to} material={matForDonut}
                       sectionFilter={sectionFilter} />
        </div>
      </div>
    </section>
  )
}

function ShiftCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2 bg-white">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold">{fmt(value)}</div>
    </div>
  )
}

/**
 * Столбики по участкам. Высота относительна к максимуму.
 * UCH_31 + UCH_32 сливаются в «Участок 3».
 */
function SectionBars({
  data, sections,
}: { data: Record<string, number>; sections: string[] }) {
  const merged: { label: string; value: number }[] = []
  const seen3 = { v: 0 }
  for (const s of sections) {
    if (s === 'UCH_31' || s === 'UCH_32') { seen3.v += data[s] || 0; continue }
    merged.push({ label: sectionLabel(s), value: data[s] || 0 })
  }
  // Вставляем «3» на позицию 3
  merged.splice(2, 0, { label: '3', value: seen3.v })
  const max = Math.max(1, ...merged.map(m => m.value))
  return (
    <div className="flex items-end gap-1.5 h-32">
      {merged.map(m => (
        <div key={m.label} className="flex-1 flex flex-col items-center gap-1 group">
          <span className="font-mono text-[10px] text-text-primary">
            {m.value > 0 ? fmt(m.value) : ''}
          </span>
          <div className="w-full rounded-t-sm transition-all group-hover:opacity-80"
               style={{
                 height: `${m.value / max * 100}%`,
                 background: m.value > 0 ? '#1a1a1a' : '#e5e5e5',
                 minHeight: m.value > 0 ? 2 : 0,
               }} />
          <span className="font-mono text-[10px] text-text-muted">{m.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Донат-диаграмма по карьерам. */
function QuarryDonut({
  from, to, material, sectionFilter,
}: { from: string; to: string; material?: string; sectionFilter: string }) {
  const { data, isLoading } = useQuery<{ total: number; rows: any[] }>({
    queryKey: ['wip', 'quarry-donut', from, to, material, sectionFilter],
    queryFn: () => {
      const params = new URLSearchParams({ from, to })
      if (material) params.set('material', material)
      if (sectionFilter !== 'all') params.set('section', sectionFilter)
      return fetch(`/api/wip/analytics/quarry-donut?${params}`).then(r => r.json())
    },
  })

  if (isLoading || !data) return <div className="h-32 bg-bg-surface rounded animate-pulse" />
  if (!data.rows.length) {
    return <div className="text-xs text-text-muted py-6 text-center">Нет возки</div>
  }

  // Подготовка сегментов для SVG-доната.
  const R = 44, r = 28, cx = 60, cy = 60
  let offset = 0
  const segments = data.rows.slice(0, 8).map((row, i) => {
    const shareAngle = (row.volume / data.total) * 360
    const start = offset
    offset += shareAngle
    const palette = ['#1a1a1a','#dc2626','#7f1d1d','#525252','#a3a3a3','#f59e0b','#737373','#262626']
    return { ...row, start, end: offset, color: palette[i % palette.length] }
  })

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px] shrink-0">
        {segments.map(s => (
          <DonutSlice key={s.quarry_id} start={s.start} end={s.end}
                      R={R} r={r} cx={cx} cy={cy} color={s.color} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11}
              fill="#737373" fontFamily="JetBrains Mono, monospace">всего</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={13} fontWeight={700}
              fill="#1a1a1a" fontFamily="JetBrains Mono, monospace">
          {fmt(data.total)}
        </text>
      </svg>
      <ul className="flex-1 space-y-1 text-[11px] font-mono">
        {segments.slice(0, 6).map(s => (
          <li key={s.quarry_id} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
            <span className="truncate flex-1 text-text-secondary">{s.quarry_name}</span>
            <span className="text-text-primary">{s.share}%</span>
          </li>
        ))}
        {segments.length > 6 && (
          <li className="text-text-muted">+ ещё {segments.length - 6}</li>
        )}
      </ul>
    </div>
  )
}

function DonutSlice({
  start, end, R, r, cx, cy, color,
}: { start: number; end: number; R: number; r: number; cx: number; cy: number; color: string }) {
  const toRad = (deg: number) => (deg - 90) * Math.PI / 180
  const x1 = cx + R * Math.cos(toRad(start))
  const y1 = cy + R * Math.sin(toRad(start))
  const x2 = cx + R * Math.cos(toRad(end))
  const y2 = cy + R * Math.sin(toRad(end))
  const xi1 = cx + r * Math.cos(toRad(end))
  const yi1 = cy + r * Math.sin(toRad(end))
  const xi2 = cx + r * Math.cos(toRad(start))
  const yi2 = cy + r * Math.sin(toRad(start))
  const large = end - start > 180 ? 1 : 0
  const d = `M ${x1} ${y1}
             A ${R} ${R} 0 ${large} 1 ${x2} ${y2}
             L ${xi1} ${yi1}
             A ${r} ${r} 0 ${large} 0 ${xi2} ${yi2}
             Z`
  return <path d={d} fill={color} />
}
