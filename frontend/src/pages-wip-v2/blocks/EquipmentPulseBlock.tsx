import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { Activity, AlertTriangle, Gauge, Truck, Wrench } from 'lucide-react'

interface CategoryPulse {
  key: 'dump_truck' | 'excavator' | 'bulldozer' | 'other'
  label: string
  short: string
  working: number
  idle: number
  productivity: number | null
}

interface SectionPulse {
  section_code: string
  label: string
  working_total: number
  idle_total: number
  productivity: number | null
}

interface Insight {
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  text: string
}

interface Response {
  from: string
  to: string
  categories: CategoryPulse[]
  sections: SectionPulse[]
  totals: { working: number; idle: number; productivity: number | null }
  insights: Insight[]
}

const nf = new Intl.NumberFormat('ru-RU')

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU')
}

function fmtPeriod(from: string, to: string): string {
  return from === to ? fmtDate(to) : `${fmtDate(from)} — ${fmtDate(to)}`
}

function pctTone(value: number | null): string {
  if (value === null) return 'text-text-muted'
  if (value >= 85) return 'text-progress-green'
  if (value >= 60) return 'text-progress-amber'
  return 'text-accent-red'
}

function pctBg(value: number | null): string {
  if (value === null) return 'bg-neutral-300'
  if (value >= 85) return 'bg-progress-green'
  if (value >= 60) return 'bg-progress-amber'
  return 'bg-accent-red'
}

export function EquipmentPulseBlock({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery<Response>({
    queryKey: ['wip', 'overview', 'equipment-pulse', from, to],
    queryFn: () => fetch(`/api/wip/overview/equipment-pulse?from=${from}&to=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return <div className="h-72 bg-white border border-border rounded-xl animate-pulse" />
  }

  const maxWorking = Math.max(1, ...data.categories.map(c => c.working))
  const maxIdle = Math.max(1, ...data.categories.map(c => c.idle))
  const activeSections = data.sections.filter(s => s.working_total > 0 || s.idle_total > 0 || s.productivity !== null)

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <div className="flex items-center gap-2 mr-auto">
          <Activity className="w-5 h-5 text-accent-red" />
          <div>
            <h2 className="text-base font-semibold text-gray-800 font-heading tracking-wide uppercase">
              Пульс техники
            </h2>
            <div className="text-[11px] text-text-muted font-mono">{fmtPeriod(data.from, data.to)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Badge label="В работе" value={data.totals.working} tone="work" />
          <Badge label="В простое" value={data.totals.idle} tone="idle" />
          <Badge label="Производительность" value={data.totals.productivity} suffix="%" tone="prod" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <PulseCard
          title="Техника в работе"
          icon="truck"
          value={data.totals.working}
          subtitle="единиц / смен за период"
          categories={data.categories}
          metric="working"
          max={maxWorking}
        />
        <PulseCard
          title="Техника в простое"
          icon="wrench"
          value={data.totals.idle}
          subtitle="standby, ремонт, нерабочие статусы"
          categories={data.categories}
          metric="idle"
          max={maxIdle}
        />
        <PulseCard
          title="Производительность"
          icon="gauge"
          value={data.totals.productivity}
          suffix="%"
          subtitle="факт к нормативу по работающей технике"
          categories={data.categories}
          metric="productivity"
          max={100}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
        <div className="border border-border rounded-lg p-4 bg-bg-surface/40">
          <div className="text-[12px] font-semibold text-text-primary uppercase tracking-wider mb-3">
            Нагрузка по участкам
          </div>
          {activeSections.length === 0 ? (
            <div className="text-sm text-text-muted">За выбранный период нет данных по технике.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
              {activeSections.map(section => (
                <SectionTile key={section.section_code} section={section} />
              ))}
            </div>
          )}
        </div>

        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-text-primary uppercase tracking-wider mb-3">
            <AlertTriangle className="w-4 h-4 text-accent-red" />
            Логические выводы
          </div>
          {data.insights.length === 0 ? (
            <div className="text-sm text-text-muted">Критичных сигналов по выбранному периоду не найдено.</div>
          ) : (
            <div className="space-y-2">
              {data.insights.map((insight, index) => (
                <InsightRow key={`${insight.title}-${index}`} insight={insight} index={index} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function PulseCard({
  title,
  icon,
  value,
  suffix = '',
  subtitle,
  categories,
  metric,
  max,
}: {
  title: string
  icon: 'truck' | 'wrench' | 'gauge'
  value: number | null
  suffix?: string
  subtitle: string
  categories: CategoryPulse[]
  metric: 'working' | 'idle' | 'productivity'
  max: number
}) {
  const Icon = icon === 'truck' ? Truck : icon === 'wrench' ? Wrench : Gauge
  const numeric = value ?? 0
  return (
    <div className="relative border border-border rounded-lg p-4 bg-white min-h-[250px]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bg-surface border border-border flex items-center justify-center">
          <Icon className="w-5 h-5 text-accent-red" />
        </div>
        <div className="flex-1">
          <div className="text-[12px] uppercase tracking-wider text-text-muted font-semibold">{title}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <AnimatedNumber
              value={numeric}
              suffix={suffix}
              decimals={suffix ? 1 : 0}
              className={`text-4xl font-heading font-bold leading-none ${metric === 'productivity' ? pctTone(value) : 'text-text-primary'}`}
            />
          </div>
          <div className="mt-1 text-[11px] text-text-muted">{subtitle}</div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {categories.map((category, index) => {
          const raw = metric === 'productivity' ? category.productivity : category[metric]
          const level = metric === 'productivity'
            ? Math.min((category.productivity ?? 0) / 100, 1.25)
            : Math.min((Number(raw) || 0) / max, 1)
          return (
            <motion.div
              key={category.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="grid grid-cols-[86px_minmax(0,1fr)_56px] items-center gap-2"
            >
              <div>
                <div className="text-[12px] font-semibold text-text-primary leading-tight">{category.label}</div>
                <div className="text-[10px] text-text-muted font-mono">{category.short}</div>
              </div>
              <AssemblyRail level={level} tone={metric} />
              <div className={`text-right text-[13px] font-mono font-bold ${metric === 'productivity' ? pctTone(category.productivity) : 'text-text-primary'}`}>
                {metric === 'productivity'
                  ? category.productivity === null ? '—' : `${category.productivity.toFixed(0)}%`
                  : nf.format(Number(raw) || 0)}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function AssemblyRail({ level, tone }: { level: number; tone: 'working' | 'idle' | 'productivity' }) {
  const parts = 18
  const active = Math.max(0, Math.min(parts, Math.round(parts * level)))
  const color = tone === 'idle'
    ? 'bg-accent-red'
    : tone === 'productivity'
      ? 'bg-progress-green'
      : 'bg-slate-800'
  return (
    <div className="grid grid-cols-9 gap-1 min-w-0">
      {Array.from({ length: parts }).map((_, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8, rotate: -12, scale: 0.6 }}
          animate={{
            opacity: index < active ? 1 : 0.18,
            y: 0,
            rotate: 0,
            scale: index < active ? 1 : 0.82,
          }}
          transition={{ delay: index * 0.018, type: 'spring', stiffness: 260, damping: 18 }}
          className={`h-2.5 rounded-[2px] ${index < active ? color : 'bg-neutral-300'}`}
        />
      ))}
    </div>
  )
}

function SectionTile({ section }: { section: SectionPulse }) {
  const total = section.working_total + section.idle_total
  const prod = section.productivity
  const heat = total <= 0 ? 0 : section.working_total / total
  const fill = prod !== null ? Math.min(prod / 120, 1) : heat
  return (
    <div className="rounded-lg border border-border bg-white p-2 min-h-[92px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-text-primary">{section.label}</div>
        <div className={`text-[11px] font-mono font-bold ${pctTone(prod)}`}>
          {prod === null ? '—' : `${prod.toFixed(0)}%`}
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-neutral-200 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(fill * 100)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full ${pctBg(prod)}`}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] font-mono">
        <div className="rounded bg-bg-surface px-1.5 py-1">
          <span className="text-text-muted">раб.</span> <b>{section.working_total}</b>
        </div>
        <div className="rounded bg-red-50 px-1.5 py-1 text-red-800">
          <span>прост.</span> <b>{section.idle_total}</b>
        </div>
      </div>
    </div>
  )
}

function InsightRow({ insight, index }: { insight: Insight; index: number }) {
  const tone = insight.severity === 'high' || insight.severity === 'critical'
    ? 'border-red-200 bg-red-50 text-red-800'
    : insight.severity === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-neutral-200 bg-bg-surface text-text-secondary'
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`rounded-md border px-3 py-2 ${tone}`}
    >
      <div className="text-[12px] font-semibold">{insight.title}</div>
      <div className="mt-0.5 text-[11px] leading-snug">{insight.text}</div>
    </motion.div>
  )
}

function Badge({ label, value, suffix = '', tone }: {
  label: string; value: number | null; suffix?: string; tone: 'work' | 'idle' | 'prod'
}) {
  const color = tone === 'work' ? 'bg-slate-900 text-white' : tone === 'idle' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-green-50 text-green-800 border-green-200'
  return (
    <div className={`border rounded-md px-2 py-1 ${color}`}>
      <span className="opacity-75">{label}: </span>
      <b className="font-mono">{value === null ? '—' : `${nf.format(Math.round(value))}${suffix}`}</b>
    </div>
  )
}

function AnimatedNumber({
  value,
  suffix = '',
  decimals = 0,
  className,
}: {
  value: number
  suffix?: string
  decimals?: number
  className?: string
}) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, latest => {
    const rounded = decimals > 0
      ? latest.toLocaleString('ru-RU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
      : nf.format(Math.round(latest))
    return `${rounded}${suffix}`
  })

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: 'easeOut' })
    return () => controls.stop()
  }, [mv, value])

  return <motion.span className={className}>{text}</motion.span>
}
