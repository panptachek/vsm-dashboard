import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { Activity, Truck, Wrench } from 'lucide-react'

interface CategoryPulse {
  key: 'dump_truck' | 'excavator' | 'bulldozer' | 'other'
  label: string
  short: string
  working: number
  idle: number
  repair: number
}

interface SectionPulse {
  section_code: string
  label: string
  working_total: number
  idle_total: number
  repair_total: number
  categories: Record<CategoryPulse['key'], Pick<CategoryPulse, 'working' | 'idle' | 'repair'>>
}

interface Response {
  from: string
  to: string
  categories: CategoryPulse[]
  sections: SectionPulse[]
  totals: { working: number; idle: number; repair: number }
}

const nf = new Intl.NumberFormat('ru-RU')

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU')
}

function fmtPeriod(from: string, to: string): string {
  return from === to ? fmtDate(to) : `${fmtDate(from)} — ${fmtDate(to)}`
}

type EquipmentStatus = 'working' | 'idle' | 'repair'

const STATUS_TEXT: Record<EquipmentStatus, { title: string; subtitle: string; tone: 'work' | 'idle' | 'repair' }> = {
  working: {
    title: 'Техника в работе',
    subtitle: 'единиц / смен за выбранный период',
    tone: 'work',
  },
  idle: {
    title: 'Техника в простое',
    subtitle: 'standby и нерабочие статусы без признака ремонта',
    tone: 'idle',
  },
  repair: {
    title: 'Техника в ремонте',
    subtitle: 'ремонт, неисправность, maintenance/service',
    tone: 'repair',
  },
}

export function EquipmentPulseBlock({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery<Response>({
    queryKey: ['wip', 'overview', 'equipment-pulse', from, to],
    queryFn: () => fetch(`/api/wip/overview/equipment-pulse?from=${from}&to=${to}`).then(r => r.json()),
  })

  if (isLoading || !data) {
    return <div className="h-72 bg-white border border-border rounded-xl animate-pulse" />
  }

  const maxByStatus: Record<EquipmentStatus, number> = {
    working: Math.max(1, ...data.categories.map(c => c.working)),
    idle: Math.max(1, ...data.categories.map(c => c.idle)),
    repair: Math.max(1, ...data.categories.map(c => c.repair)),
  }

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
          <Badge label="В ремонте" value={data.totals.repair} tone="repair" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {(['working', 'idle', 'repair'] as EquipmentStatus[]).map(status => (
          <PulseCard
            key={status}
            status={status}
            value={data.totals[status]}
            categories={data.categories}
            sections={data.sections}
            max={maxByStatus[status]}
          />
        ))}
      </div>
    </section>
  )
}

function PulseCard({
  status,
  value,
  categories,
  sections,
  max,
}: {
  status: EquipmentStatus
  value: number
  categories: CategoryPulse[]
  sections: SectionPulse[]
  max: number
}) {
  const meta = STATUS_TEXT[status]
  const Icon = status === 'working' ? Truck : status === 'repair' ? Wrench : Activity
  const activeSections = sections.filter(section => section[`${status}_total`] > 0)
  return (
    <div className="relative border border-border rounded-lg p-4 bg-white min-h-[360px]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-bg-surface border border-border flex items-center justify-center">
          <Icon className={`w-5 h-5 ${status === 'working' ? 'text-slate-900' : 'text-accent-red'}`} />
        </div>
        <div className="flex-1">
          <div className="text-[12px] uppercase tracking-wider text-text-muted font-semibold">{meta.title}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <AnimatedNumber
              value={value}
              className="text-4xl font-heading font-bold leading-none text-text-primary"
            />
          </div>
          <div className="mt-1 text-[11px] text-text-muted">{meta.subtitle}</div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {categories.map((category, index) => {
          const raw = category[status]
          const level = Math.min((Number(raw) || 0) / max, 1)
          return (
            <motion.div
              key={category.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="grid grid-cols-[112px_minmax(0,1fr)_56px] items-center gap-2"
            >
              <div className="min-w-0">
                <div className="whitespace-nowrap text-[11px] font-semibold leading-none text-text-primary">{category.label}</div>
                <div className="text-[10px] text-text-muted font-mono">{category.short}</div>
              </div>
              <AssemblyRail level={level} tone={status} />
              <div className="text-right text-[13px] font-mono font-bold text-text-primary">
                {nf.format(Number(raw) || 0)}
              </div>
            </motion.div>
          )
        })}
      </div>

      <div className="mt-5 border-t border-border pt-3">
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2">По участкам</div>
        {activeSections.length === 0 ? (
          <div className="text-[12px] text-text-muted">Нет данных по выбранному статусу.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-2">
            {activeSections.map((section, index) => (
              <SectionStatusTile key={section.section_code} section={section} status={status} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssemblyRail({ level, tone }: { level: number; tone: EquipmentStatus }) {
  const parts = 18
  const active = Math.max(0, Math.min(parts, Math.round(parts * level)))
  const color = tone === 'repair'
    ? 'bg-accent-red'
    : tone === 'idle'
      ? 'bg-progress-amber'
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

function SectionStatusTile({ section, status, index }: {
  section: SectionPulse
  status: EquipmentStatus
  index: number
}) {
  const total = section[`${status}_total`]
  const maxCat = Math.max(1, ...Object.values(section.categories).map(category => category[status]))
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-lg border border-border bg-bg-surface/50 p-2 min-h-[104px]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-text-primary">{section.label}</div>
        <div className="text-[12px] font-mono font-bold text-text-primary">{total}</div>
      </div>
      <div className="mt-2 space-y-1.5">
        {Object.entries(section.categories).map(([key, category]) => {
          const count = category[status]
          const width = Math.round((count / maxCat) * 100)
          const meta = key === 'dump_truck'
            ? { short: 'СВ', label: 'Самосвалы' }
            : key === 'excavator'
              ? { short: 'ЭК', label: 'Экскаваторы' }
              : key === 'bulldozer'
                ? { short: 'БД', label: 'Бульдозеры' }
                : { short: 'ПР', label: 'Прочая' }
          return (
            <div key={key} className="grid grid-cols-[24px_minmax(0,1fr)_22px] items-center gap-1.5 text-[10px] font-mono">
              <div className="text-text-muted" title={meta.label}>{meta.short}</div>
              <div className="h-1.5 rounded-full bg-white overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.65, ease: 'easeOut' }}
                  className={`h-full ${status === 'repair' ? 'bg-accent-red' : status === 'idle' ? 'bg-progress-amber' : 'bg-slate-900'}`}
                />
              </div>
              <div className="text-right text-text-primary">{count}</div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

function Badge({ label, value, suffix = '', tone }: {
  label: string; value: number | null; suffix?: string; tone: 'work' | 'idle' | 'repair'
}) {
  const color = tone === 'work'
    ? 'bg-slate-900 text-white'
    : tone === 'repair'
      ? 'bg-red-50 text-red-800 border-red-200'
      : 'bg-amber-50 text-amber-900 border-amber-200'
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
