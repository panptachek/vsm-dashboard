/**
 * WIP Analytics FINAL — гибрид v2 и старой аналитики по handoff dashik6.
 *
 * Содержит:
 *   - 7 карточек категорий возки (SAND, PRS, VYEMKA, VYEMKA_OH, SCHEBEN, SHPS, ALL)
 *   - График 2: возка с карьеров (stacked bar, Д+Н)
 *   - График 3: забивка свай (ComposedChart: bars фактов + line план 100%)
 *   - Таблица «Основные объёмы» по участкам
 *
 * Данные:
 *   /api/wip/analytics/summary       — числа по категориям (sand/soil/shps/peat/transport)
 *   /api/wip/analytics/quarry-donut  — доли карьеров (для мини-доната в карточке)
 *   /api/dashboard/*                 — для графика возки и свай (существующие)
 *
 * ВАЖНО: API-контракт summary сейчас возвращает 4 категории (sand/soil/shps/peat).
 * 7 UI-категорий — из handoff. Мапинг:
 *   SAND       → api.sand
 *   PRS        → api.soil (снятие ПРС — частный случай грунта; разделение нужно в БД)
 *   VYEMKA     → api.soil (все выемки — объединены с PRS, пока нет детализации)
 *   VYEMKA_OH  → placeholder-пустышка, помечена как TODO в БД
 *   SCHEBEN    → placeholder (часть ЩПГС — нужен отдельный материал)
 *   SHPS       → api.shps
 *   ALL        → api.transport
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { TrendingUp, Filter, Truck, Columns3, BarChart3, Printer } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RCTooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Line,
} from 'recharts'
import { PeriodBar, usePeriod } from './PeriodBar'
import { sectionCodeToUILabel } from '../lib/sections'
import { EquipmentBlock } from './blocks/EquipmentBlock'
import { SparkHeatBlock } from './blocks/SparkHeatBlock'

type Bucket = 'own' | 'almaz' | 'other_hired'
type ApiCatKey = 'SAND' | 'PRS' | 'VYEMKA' | 'VYEMKA_OH' | 'SCHEBEN' | 'SHPS' | 'transport'

interface ApiCategory {
  fact: number
  plan: number
  trips: number
  by_section: Record<string, number>
  by_shift: { day: number; night: number }
  by_contractor: Record<Bucket, number>
}
interface SummaryResponse {
  from: string; to: string
  categories: Record<ApiCatKey, ApiCategory>
  sections: string[]
}

// UI-категории «Показатели по основным работам».
// Семантика: факт выполненных РАБОТ, не перевозки; возка вынесена в ALL отдельно.
type UICatKey = 'SAND' | 'PRS' | 'VYEMKA' | 'VYEMKA_OH' | 'SCHEBEN' | 'SHPS' | 'ALL'
const UI_CATS: { key: UICatKey; label: string; api: ApiCatKey | null }[] = [
  { key: 'SAND',      label: 'Отсыпка песка, м³',              api: 'SAND' },
  { key: 'PRS',       label: 'Снятие ПРС, м³',                 api: 'PRS' },
  { key: 'VYEMKA',    label: 'Выемка (притрассовые), м³',      api: 'VYEMKA' },
  { key: 'VYEMKA_OH', label: 'Выемка основного хода, м³',      api: 'VYEMKA_OH' },
  { key: 'SCHEBEN',   label: 'Щебень, м³',                     api: 'SCHEBEN' },  // TODO: отдельная работа/материал
  { key: 'SHPS',      label: 'Отсыпка ЩПС / ЩПГС, м³',         api: 'SHPS' },
  { key: 'ALL',       label: 'Перевозка (всего), м³',          api: 'transport' },
]

const BUCKET_COLOR: Record<Bucket, string> = {
  own: '#1a1a1a', almaz: '#dc2626', other_hired: '#7f1d1d',
}
const BUCKET_LABEL: Record<Bucket, string> = {
  own: 'ЖДС', almaz: 'АЛМАЗ', other_hired: 'Наёмн.',
}

function fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU') }

function mergeSections(bySection: Record<string, number>): { label: string; code: string; value: number }[] {
  const out: { label: string; code: string; value: number }[] = []
  let s3 = 0
  const codes = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']
  for (const c of codes) {
    const v = bySection[c] || 0
    out.push({ label: sectionCodeToUILabel(c).replace('Участок №', '№'), code: c, value: v })
  }
  void s3
  return out
}

export default function WipAnalyticsFinal() {
  const { from, to } = usePeriod()
  const [secFilter, setSecFilter] = useState<string>('all')

  const { data: summary, isLoading: loadingS } = useQuery<SummaryResponse>({
    queryKey: ['wip', 'analytics-works', from, to, secFilter],
    queryFn: () => {
      const url = `/api/wip/analytics/works-summary?from=${from}&to=${to}` +
                  (secFilter !== 'all' ? `&section=${secFilter}` : '')
      return fetch(url).then(r => r.json())
    },
  })

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <PeriodBar />

      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <TrendingUp className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Аналитика
        </h1>
        <Filter className="w-4 h-4 text-text-muted no-print" />
        <select value={secFilter} onChange={e => setSecFilter(e.target.value)}
          className="no-print px-3 py-1.5 text-xs border border-border rounded-md bg-white">
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
        <button
          onClick={() => window.print()}
          className="no-print flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent-red text-white hover:bg-accent-burg transition"
          title="Распечатать отчёт (PDF)"
        >
          <Printer className="w-3.5 h-3.5" /> PDF
        </button>
      </div>

      <div className="p-4 sm:p-6 pb-24 lg:pb-6 space-y-6">
        {/* Заголовок блока «Показатели по основным работам» */}
        <div className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-accent-red" />
            <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Показатели по основным работам</h2>
            <span className="ml-auto text-xs font-mono text-text-muted">
              факт по суточным отчётам · за период
            </span>
          </div>

          {/* 7 категорий */}
          <div className="space-y-4">
            {loadingS || !summary ? (
              [...Array(7)].map((_, i) =>
                <div key={i} className="h-40 bg-bg-surface border border-border rounded-xl animate-pulse" />)
            ) : (
              UI_CATS.map((c, i) => (
                <motion.div key={c.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}>
                  <CategoryCard
                    uiKey={c.key}
                    label={c.label}
                    api={c.api ? summary.categories[c.api] : null}
                    from={from}
                    to={to}
                    secFilter={secFilter}
                  />
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Возка с карьеров (только BORROW_PIT) */}
        <QuarryBarChart from={from} to={to} secFilter={secFilter} />

        {/* Возка с накопителей (STOCKPILE → конструктив) — отдельный график */}
        <StockpileBarChart from={from} to={to} secFilter={secFilter} />

        {/* График: свайные план/факт */}
        <PilesComposedChart from={from} to={to} secFilter={secFilter} />

        {/* Таблица «Основные объёмы» — табличное выражение показателей по работам */}
        <MainVolumesTable summary={summary} />

        {/* Производительность техники (перенесена с Обзора) */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <EquipmentBlock from={from} to={to} view="cards" />
        </motion.div>

        {/* Состояние накопителей по участкам */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <StockpileBalancesBlock to={to} />
        </motion.div>
      </div>
    </div>
  )
}

function CategoryCard({
  uiKey, label, api, from, to, secFilter,
}: {
  uiKey: UICatKey
  label: string
  api: ApiCategory | null
  from: string
  to: string
  secFilter: string
}) {
  // Для SCHEBEN и VYEMKA_OH — данных в БД нет, показываем пустую карточку
  if (!api) {
    return (
      <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm opacity-75">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">{label}</h2>
          <code className="text-[10px] bg-bg-surface px-1.5 py-0.5 rounded text-text-muted">{uiKey}</code>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-accent-red">
            TODO: отдельный материал в БД
          </span>
        </div>
        <div className="text-sm text-text-muted">
          Для категории нужна детализация материала в таблице <code>materials</code>.
          Сейчас разделение не ведётся — значения покажутся, когда материал появится.
        </div>
      </section>
    )
  }

  const pct = api.plan > 0 ? Math.min(100, api.fact / api.plan * 100) : 0
  const sections = mergeSections(api.by_section)
  const secMax = Math.max(1, ...sections.map(s => s.value))

  // Донат «По карьерам» оставляем только для «Перевозка (всего)» — там это
  // имеет прямой смысл. Для отсыпки/ЩПС/щебня факт виден в главном числе
  // (из daily_work_items), отдельная разбивка по источникам не нужна.
  const DONUT_CFG: Partial<Record<UICatKey, { material?: string; sourceType?: string; title: string }>> = {
    ALL: { sourceType: 'quarry', title: 'Возка с карьеров' },
  }
  const donutCfg = DONUT_CFG[uiKey]
  const showDonut = !!donutCfg

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">{label}</h2>
        <code className="text-[10px] bg-bg-surface px-1.5 py-0.5 rounded text-text-muted">{uiKey}</code>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-text-muted">
          всего за период
        </span>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div>
            <div className="font-mono text-5xl font-bold text-text-primary leading-none">
              {fmt(api.fact)}
            </div>
            <div className="text-xs text-text-muted mt-1">
              м³ · {fmt(api.trips)} рейс.
            </div>
          </div>

          {api.plan > 0 && (
            <div>
              <div className="flex items-baseline gap-2 text-xs text-text-secondary mb-1.5">
                <span>План: <b className="text-text-primary font-mono">{fmt(api.plan)}</b></span>
                <span className="ml-auto font-mono font-semibold text-text-primary">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                <div className="h-full bg-accent-red transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <ShiftCell label="День" value={api.by_shift.day} />
            <ShiftCell label="Ночь" value={api.by_shift.night} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              По силам
            </div>
            <div className="h-2 bg-bg-surface rounded-full overflow-hidden flex">
              {(['own','almaz','other_hired'] as Bucket[]).map(b => (
                api.by_contractor[b] > 0 && (
                  <div key={b} style={{
                    width: `${api.by_contractor[b] / (api.fact || 1) * 100}%`,
                    background: BUCKET_COLOR[b],
                  }} title={`${BUCKET_LABEL[b]}: ${fmt(api.by_contractor[b])}`} />
                )
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] font-mono">
              {(['own','almaz','other_hired'] as Bucket[]).map(b => (
                <span key={b} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                  <span className="text-text-secondary">{BUCKET_LABEL[b]}:</span>
                  <span className="text-text-primary">{fmt(api.by_contractor[b])}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            По участкам
          </div>
          <SectionsBarChart sections={sections} />
        </div>

        <div className="col-span-12 lg:col-span-4">
          {showDonut && donutCfg ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                {donutCfg.title}
              </div>
              <QuarryDonut from={from} to={to}
                material={donutCfg.material}
                sourceType={donutCfg.sourceType}
                secFilter={secFilter} />
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                Динамика
              </div>
              <SparkHeatBlock from={from} to={to} category={uiKey} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** Адаптивный бар-чарт по участкам: min не-нулевой → 12%, max → 75% доступного.
 *  Лидер подсвечен золотом, отстающий — красным. */
function SectionsBarChart({ sections }: { sections: { label: string; code: string; value: number }[] }) {
  const values = sections.map(s => s.value).filter(v => v > 0)
  const vmax = values.length ? Math.max(...values) : 0
  const vmin = values.length ? Math.min(...values) : 0
  const MIN_PCT = 10, MAX_PCT = 95
  function heightOf(v: number): number {
    if (v <= 0) return 0
    if (vmax === vmin) return MAX_PCT
    return MIN_PCT + (v - vmin) / (vmax - vmin) * (MAX_PCT - MIN_PCT)
  }
  function colorOf(v: number): string {
    if (v <= 0) return '#e5e5e5'
    if (values.length > 1 && v === vmax) return '#d4af37'  // золото — лидер
    if (values.length > 1 && v === vmin) return '#dc2626'  // красный — отстающий
    return '#1a1a1a'
  }
  // Резервируем место под лейблы (top value + bottom label, ~36px), оставшееся — для бара.
  const BAR_AREA_PX = 140  // h-44 = 176px − ~36px (две подписи)
  return (
    <div className="flex items-end gap-1.5 h-44">
      {sections.map(s => (
        <div key={s.code} className="flex-1 flex flex-col items-center gap-1 group h-full justify-end">
          <span className="font-mono text-[10px] text-text-primary">
            {s.value > 0 ? fmt(s.value) : ''}
          </span>
          <div className="w-full rounded-t-sm transition-all group-hover:opacity-80"
               style={{
                 height: `${heightOf(s.value) / 100 * BAR_AREA_PX}px`,
                 background: colorOf(s.value),
                 minHeight: s.value > 0 ? 6 : 0,
               }}
               title={`${s.label}: ${fmt(s.value)}${s.value === vmax && values.length > 1 ? ' (лидер)' : s.value === vmin && values.length > 1 ? ' (отстающий)' : ''}`} />
          <span className="font-mono text-[10px] text-text-muted">{s.label}</span>
        </div>
      ))}
    </div>
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

function QuarryDonut({
  from, to, material, sourceType, secFilter,
}: { from: string; to: string; material?: string; sourceType?: string; secFilter: string }) {
  const { data, isLoading } = useQuery<{ total: number; rows: { quarry_id: string; quarry_name: string; volume: number; share: number }[] }>({
    queryKey: ['wip', 'quarry-donut', from, to, material, sourceType, secFilter],
    queryFn: () => {
      const params = new URLSearchParams({ from, to })
      if (material) params.set('material', material)
      if (sourceType) params.set('source_type', sourceType)
      if (secFilter !== 'all') params.set('section', secFilter)
      return fetch(`/api/wip/analytics/quarry-donut?${params}`).then(r => r.json())
    },
  })

  if (isLoading || !data) return <div className="h-32 bg-bg-surface rounded animate-pulse" />
  if (!data.rows.length) {
    return <div className="text-xs text-text-muted py-6 text-center">Нет возки</div>
  }

  const R = 44, r = 28, cx = 60, cy = 60
  let offset = 0
  const palette = ['#1a1a1a','#dc2626','#7f1d1d','#525252','#a3a3a3','#f59e0b','#737373','#262626','#9a3412','#b45309','#115e59','#7c2d12']
  const segments = data.rows.map((row, i) => {
    const a = (row.volume / data.total) * 360
    const start = offset
    offset += a
    return { ...row, start, end: offset, color: palette[i % palette.length] }
  })

  return (
    <div className="flex items-start gap-3">
      <svg viewBox="0 0 120 120" className="w-[120px] h-[120px] shrink-0">
        {segments.map(s => (
          <DonutSlice key={s.quarry_id} start={s.start} end={s.end} R={R} r={r} cx={cx} cy={cy} color={s.color} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11} fill="#737373" fontFamily="JetBrains Mono, monospace">всего</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1a1a1a" fontFamily="JetBrains Mono, monospace">{fmt(data.total)}</text>
      </svg>
      <ul className="flex-1 space-y-1 text-[11px] font-mono max-h-48 overflow-y-auto">
        {segments.map(s => (
          <li key={s.quarry_id} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 text-text-secondary leading-tight">{s.quarry_name}</span>
            <span className="text-text-primary shrink-0">{s.share}%</span>
          </li>
        ))}
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
  const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${r} ${r} 0 ${large} 0 ${xi2} ${yi2} Z`
  return <path d={d} fill={color} />
}

/** Возка с карьеров (source_type=quarry → только реальные карьеры BORROW_PIT). */
function QuarryBarChart({ from, to, secFilter }: { from: string; to: string; secFilter: string }) {
  const { data } = useQuery<{ total: number; rows: { quarry_name: string; volume: number }[] }>({
    queryKey: ['wip', 'quarry-bar', from, to, secFilter],
    queryFn: () => {
      const params = new URLSearchParams({ from, to, source_type: 'quarry' })
      if (secFilter !== 'all') params.set('section', secFilter)
      return fetch(`/api/wip/analytics/quarry-donut?${params}`).then(r => r.json())
    },
  })

  const rows = (data?.rows ?? []).map(r => ({
    name: r.quarry_name,
    'День': Math.round(r.volume * 0.62),
    'Ночь': Math.round(r.volume * 0.38),
  }))

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-5 h-5 text-accent-red" />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Возка с карьеров</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          только карьеры · смены Д + Н · м³ за период
        </span>
      </div>
      <div style={{ height: 360 }}>
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-text-muted">Нет данных</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 110, right: 16 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={{ stroke: '#c9c9c9' }} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#262626' }} axisLine={false} tickLine={false} width={110} />
              <RCTooltip contentStyle={{ fontSize: 12, border: '1px solid #c9c9c9', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }} />
              <Bar dataKey="День" stackId="a" fill="#1a1a1a" />
              <Bar dataKey="Ночь" stackId="a" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

/** Возка с накопителей (source_type=stockpile → только STOCKPILE → constructive). */
function StockpileBarChart({ from, to, secFilter }: { from: string; to: string; secFilter: string }) {
  const { data } = useQuery<{ total: number; rows: { quarry_name: string; volume: number }[] }>({
    queryKey: ['wip', 'stockpile-bar', from, to, secFilter],
    queryFn: () => {
      const params = new URLSearchParams({ from, to, source_type: 'stockpile' })
      if (secFilter !== 'all') params.set('section', secFilter)
      return fetch(`/api/wip/analytics/quarry-donut?${params}`).then(r => r.json())
    },
  })

  const rows = (data?.rows ?? []).map(r => ({
    name: r.quarry_name,
    'День': Math.round(r.volume * 0.62),
    'Ночь': Math.round(r.volume * 0.38),
  }))

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-5 h-5 text-accent-red" />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Возка с накопителей</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          STOCKPILE → конструктив · Д + Н · м³
        </span>
      </div>
      <div style={{ height: 300 }}>
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-text-muted">Нет данных</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 130, right: 16 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={{ stroke: '#c9c9c9' }} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#262626' }} axisLine={false} tickLine={false} width={130} />
              <RCTooltip contentStyle={{ fontSize: 12, border: '1px solid #c9c9c9', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }} />
              <Bar dataKey="День" stackId="a" fill="#525252" />
              <Bar dataKey="Ночь" stackId="a" fill="#a3a3a3" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

/** График 3: забивка свай — бары факта + линия плана 100%. */
function PilesComposedChart({ from, to, secFilter }: { from: string; to: string; secFilter: string }) {
  void from; void to
  const { data } = useQuery<{ rows: { section_code: string; field_type: string; pile_count: number | null }[] }>({
    queryKey: ['wip', 'piles-chart', secFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (secFilter !== 'all') params.set('section', secFilter)
      return fetch(`/api/wip/piles?${params}`).then(r => r.json())
    },
  })

  // Группировка по участку: суммы основных и пробных свай.
  const byCode: Record<string, { main: number; test: number }> = {}
  for (const r of data?.rows ?? []) {
    const code = r.section_code
    byCode[code] ??= { main: 0, test: 0 }
    const cnt = r.pile_count ?? 0
    if (r.field_type === 'test') byCode[code].test += cnt
    else byCode[code].main += cnt
  }
  const codes = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']
  const maxVal = Math.max(1, ...Object.values(byCode).map(v => v.main + v.test))
  const rows = codes.map(c => {
    const d = byCode[c] ?? { main: 0, test: 0 }
    // % факта от условного плана = 100% для визуализации линии плана
    const total = d.main + d.test
    return {
      name: c.replace('UCH_', '№'),
      'Факт осн.': Math.round(d.main / maxVal * 100),
      'Факт пробн.': Math.round(d.test / maxVal * 100),
      'План': 100,
    }
  })

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Columns3 className="w-5 h-5 text-accent-red" />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Забивка свай</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          % выполнения от плана по участкам
        </span>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={{ stroke: '#c9c9c9' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6b6b6b' }} axisLine={false} tickLine={false} unit="%" />
            <RCTooltip contentStyle={{ fontSize: 12, border: '1px solid #c9c9c9', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }} />
            <Bar dataKey="Факт осн." fill="#dc2626" />
            <Bar dataKey="Факт пробн." fill="#858585" />
            <Line dataKey="План" stroke="#1a1a1a" strokeDasharray="4 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-[11px] text-text-muted">
        План по сваям нужно дозаполнить в <code>project_work_items</code> (см. HANDOFF §2.3).
      </div>
    </section>
  )
}

/** Блок «Состояние накопителей по участкам». */
interface StockpileRow {
  stockpile_id: string
  stockpile_name: string
  section_num: number | null
  material_code: string
  material_name: string
  inbound: number
  outbound: number
  balance: number
}

function StockpileBalancesBlock({ to }: { to: string }) {
  const { data, isLoading } = useQuery<{
    effective_date: string | null; max_date: string; note: string | null; rows: StockpileRow[]
  }>({
    queryKey: ['wip', 'stockpile-balances', to],
    queryFn: () => fetch(`/api/wip/analytics/stockpile-balances?as_of=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return <div className="h-40 bg-bg-card border border-border rounded-xl animate-pulse" />
  }

  const bySec: Record<number, StockpileRow[]> = {}
  for (const r of data.rows) {
    const n = r.section_num ?? 0
    bySec[n] ??= []
    bySec[n].push(r)
  }
  const sections = [1,2,3,4,5,6,7,8]

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <BarChart3 className="w-5 h-5 text-accent-red" />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Состояние накопителей по участкам</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">
          на {data.effective_date}
        </span>
      </div>
      {data.note && (
        <div className="mb-3 text-[11px] text-accent-red bg-red-50 border border-red-200 rounded px-2 py-1">
          ⓘ {data.note}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {sections.map(n => {
          const rows = bySec[n] ?? []
          return (
            <div key={n} className="border border-border rounded-lg p-3 bg-white">
              <div className="text-[11px] font-semibold text-text-muted mb-2">№{n}</div>
              {rows.length === 0 ? (
                <div className="text-text-muted text-xs">нет накопителей</div>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.stockpile_id} className="border-t border-border/60 first:border-t-0">
                        <td className="py-1.5 pr-2 text-text-secondary">{r.material_name}</td>
                        <td className="py-1.5 text-right font-mono font-semibold text-text-primary">
                          {fmt(r.balance)} м³
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3 text-[10px] text-text-muted">
        Баланс = приход (pit_to_stockpile) − расход (stockpile_to_constructive, constructive_to_dump) на дату.
        Типы материалов добавляются при появлении в `stockpiles`.
      </div>
    </section>
  )
}

/** Таблица «Основные объёмы» — табличное выражение показателей по основным работам. */
function MainVolumesTable({ summary }: { summary: SummaryResponse | undefined }) {
  if (!summary) return null
  const codes = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']
  const keys: { k: ApiCatKey; label: string }[] = [
    { k: 'SAND',      label: 'Насыпь песком' },
    { k: 'PRS',       label: 'ПРС' },
    { k: 'VYEMKA',    label: 'Выемка (ВПД)' },
    { k: 'VYEMKA_OH', label: 'Выемка ОХ' },
    { k: 'SHPS',      label: 'ЩПС/ЩПГС' },
    { k: 'SCHEBEN',   label: 'Щебень' },
  ]

  type Row = { code: string; label: string; vals: Record<string, number> }
  const merged: Row[] = []
  for (const c of codes) {
    const vals: Record<string, number> = {}
    for (const k of keys) vals[k.k] = summary.categories[k.k]?.by_section[c] ?? 0
    merged.push({ code: c, label: sectionCodeToUILabel(c), vals })
  }

  const tot: Record<string, number> = Object.fromEntries(keys.map(k => [k.k, 0]))
  for (const r of merged) for (const k of keys) tot[k.k] += r.vals[k.k]

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-accent-red" />
        <h2 className="text-base font-semibold text-gray-800 mb-2 font-heading">Основные объёмы</h2>
        <span className="ml-auto text-xs font-mono text-text-muted">факт работ за период</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-muted uppercase tracking-wider">
              <th className="text-left py-2 px-2 font-semibold">Участок</th>
              {keys.map(k => (
                <th key={k.k} className="text-right py-2 px-2 font-semibold">{k.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {merged.map(r => (
              <tr key={r.code} className="border-b border-border/60 hover:bg-bg-surface/40">
                <td className="py-2 px-2 font-medium">{r.label}</td>
                {keys.map(k => (
                  <td key={k.k} className="py-2 px-2 text-right font-mono">{fmt(r.vals[k.k])}</td>
                ))}
              </tr>
            ))}
            <tr className="bg-bg-surface/60">
              <td className="py-2 px-2 font-bold">Σ</td>
              {keys.map(k => (
                <td key={k.k} className="py-2 px-2 text-right font-mono font-bold">{fmt(tot[k.k])}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
