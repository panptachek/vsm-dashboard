import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, MapPin, Calendar, FileText, TrendingUp } from 'lucide-react'
import {
  RailwayCrossSection,
  type Structure,
} from '../components/railway/RailwayCrossSection'
import { sectionCodeToUILabel } from '../lib/sections'

/* ------------------------------------------------------------------ */
/*  API types                                                          */
/* ------------------------------------------------------------------ */

interface WorkItem {
  id: number
  name: string
  planned_volume: number
  completed_volume: number
  unit: string
  percent: number
}

interface Report {
  id: number
  date: string
  author: string
  summary: string
}

interface SectionData {
  code: string
  name: string
  pk_range: string
  map_color: string
  progress_percent: number
  planned_volume: number
  completed_volume: number
  work_items: WorkItem[]
  recent_reports: Report[]
}

/* ------------------------------------------------------------------ */
/*  API response → SectionData transformer                             */
/* ------------------------------------------------------------------ */

function formatPkRange(sec: Record<string, unknown>): string {
  const pkStart = sec.pk_start as number | null
  const pkEnd = sec.pk_end as number | null
  if (pkStart != null && pkEnd != null) {
    return `ПК${Math.floor(pkStart / 100)}+${String(Math.floor(pkStart % 100)).padStart(2, '0')} - ПК${Math.floor(pkEnd / 100)}+${String(Math.floor(pkEnd % 100)).padStart(2, '0')}`
  }
  return ''
}

async function fetchSectionData(code: string): Promise<SectionData> {
  const res = await fetch(`/api/dashboard/section/${code}`)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  const json = await res.json()
  if (json.error) {
    throw new Error(json.error)
  }

  const sec = json.section ?? {}
  const rawWorkItems: Record<string, unknown>[] = json.work_items ?? []
  const rawReports: Record<string, unknown>[] = json.recent_reports ?? []

  // Transform work items from API shape to frontend shape
  const workItems: WorkItem[] = rawWorkItems.map((wi, idx) => {
    const completed = Number(wi.completed ?? 0)
    return {
      id: idx + 1,
      name: String(wi.work_type_name ?? ''),
      planned_volume: 0,
      completed_volume: completed,
      unit: String(wi.unit ?? 'м3'),
      percent: 0,
    }
  })

  // Transform reports from API shape to frontend shape
  const reports: Report[] = rawReports.map((r, idx) => ({
    id: idx + 1,
    date: String(r.report_date ?? ''),
    author: String(r.source_type ?? r.shift ?? ''),
    summary: `${r.shift === 'day' ? 'Дневная' : 'Ночная'} смена — ${r.parse_status ?? 'draft'}`,
  }))

  return {
    code: String(sec.code ?? code),
    name: String(sec.name ?? sectionCodeToUILabel(code)),
    pk_range: formatPkRange(sec),
    map_color: String(sec.map_color ?? '#64748b'),
    progress_percent: 0,
    planned_volume: 0,
    completed_volume: workItems.reduce((sum, wi) => sum + wi.completed_volume, 0),
    work_items: workItems,
    recent_reports: reports,
  }
}

/* ------------------------------------------------------------------ */
/*  Mock structures for the cross-section diagram                      */
/* ------------------------------------------------------------------ */

function buildMockStructures(progress: number): Structure[] {
  // Derive individual layer progress from overall, with earthwork ahead
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  return [
    {
      type: 'earthwork',
      name: 'Земляное полотно',
      planned: 125000,
      completed: Math.round(125000 * clamp(progress * 1.3) / 100),
      unit: 'м3',
      percent: clamp(progress * 1.3),
    },
    {
      type: 'ballast',
      name: 'Балластная призма',
      planned: 48000,
      completed: Math.round(48000 * clamp(progress * 1.1) / 100),
      unit: 'м3',
      percent: clamp(progress * 1.1),
    },
    {
      type: 'sleepers',
      name: 'Шпалы ж/б',
      planned: 4200,
      completed: Math.round(4200 * clamp(progress * 0.9) / 100),
      unit: 'шт',
      percent: clamp(progress * 0.9),
    },
    {
      type: 'rails',
      name: 'Рельсы Р65',
      planned: 24000,
      completed: Math.round(24000 * clamp(progress * 0.7) / 100),
      unit: 'п.м.',
      percent: clamp(progress * 0.7),
    },
    {
      type: 'catenary',
      name: 'Контактная сеть',
      planned: 12000,
      completed: Math.round(12000 * clamp(progress * 0.4) / 100),
      unit: 'п.м.',
      percent: clamp(progress * 0.4),
    },
  ]
}

/* ------------------------------------------------------------------ */
/*  Progress bar helper                                                */
/* ------------------------------------------------------------------ */

function progressColor(pct: number): string {
  if (pct >= 70) return '#22c55e'
  if (pct >= 30) return '#f59e0b'
  return '#ef4444'
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({ section }: { section: SectionData }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-bg-card rounded-xl p-5 border border-border shadow-sm mb-6"
    >
      <div className="flex items-start gap-4">
        <div
          className="w-4 h-4 mt-1 rounded-full shrink-0"
          style={{ backgroundColor: section.map_color }}
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-heading font-bold text-text-primary leading-tight">
            {section.name}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-text-muted">
            {section.pk_range && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {section.pk_range}
              </span>
            )}
            <span className="flex items-center gap-1 font-mono">
              Код: {section.code}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className="text-2xl font-bold font-mono"
            style={{ color: progressColor(section.progress_percent) }}
          >
            {section.progress_percent.toFixed(1)}%
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">общий прогресс</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-bg-surface rounded-full overflow-hidden mt-4">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(section.progress_percent, 100)}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: progressColor(section.progress_percent) }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-text-muted mt-1.5">
        <span>
          {section.completed_volume.toLocaleString('ru-RU')} / {section.planned_volume.toLocaleString('ru-RU')} м3
        </span>
        <span>факт / план</span>
      </div>
    </motion.div>
  )
}

function WorkItemsTable({ items }: { items: WorkItem[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
    >
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-accent-red" />
        <h3 className="text-sm font-heading font-semibold text-text-primary">Работы</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left px-5 py-2.5 font-medium">Наименование</th>
              <th className="text-right px-3 py-2.5 font-medium">План</th>
              <th className="text-right px-3 py-2.5 font-medium">Факт</th>
              <th className="text-right px-5 py-2.5 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/50 hover:bg-bg-surface/50 transition-colors">
                <td className="px-5 py-2.5 text-text-secondary">{item.name}</td>
                <td className="px-3 py-2.5 text-right font-mono text-text-muted">
                  {item.planned_volume.toLocaleString('ru-RU')} {item.unit}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-text-secondary">
                  {item.completed_volume.toLocaleString('ru-RU')} {item.unit}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(item.percent, 100)}%`,
                          backgroundColor: progressColor(item.percent),
                        }}
                      />
                    </div>
                    <span className="font-mono font-semibold w-10 text-right" style={{ color: progressColor(item.percent) }}>
                      {item.percent.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

function RecentReports({ reports }: { reports: Report[] }) {
  if (!reports.length) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
    >
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <FileText className="w-4 h-4 text-accent-red" />
        <h3 className="text-sm font-heading font-semibold text-text-primary">Последние отчёты</h3>
      </div>
      <ul className="divide-y divide-border/50">
        {reports.map((report) => (
          <li key={report.id} className="px-5 py-3 hover:bg-bg-surface/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-text-secondary line-clamp-2">{report.summary}</div>
                <div className="text-[10px] text-text-muted mt-1">{report.author}</div>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-text-muted shrink-0">
                <Calendar className="w-3 h-3" />
                {report.date}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function Skeleton() {
  return (
    <div className="p-6 pb-24 lg:pb-6 space-y-4">
      <div className="bg-bg-card rounded-xl p-5 border border-border shadow-sm animate-pulse h-32" />
      <div className="bg-bg-card rounded-xl border border-border shadow-sm animate-pulse h-64" />
      <div className="bg-bg-card rounded-xl border border-border shadow-sm animate-pulse h-48" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export function SectionDetail() {
  const { code } = useParams<{ code: string }>()

  const { data, isLoading, error } = useQuery<SectionData>({
    queryKey: ['section-detail', code],
    queryFn: () => fetchSectionData(code!),
    enabled: !!code,
  })

  // Derive cross-section structures from overall progress
  const structures = buildMockStructures(data?.progress_percent ?? 0)

  if (isLoading) return <Skeleton />

  if (error || !data) {
    return (
      <div className="p-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-red transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Link>
        <div className="bg-bg-card rounded-xl p-8 border border-border shadow-sm text-center">
          <p className="text-text-muted">Не удалось загрузить данные участка <span className="font-mono">{code}</span></p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 lg:pb-6 space-y-6">
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted
                   hover:text-accent-red transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Все участки
      </Link>

      {/* Section header */}
      <SectionHeader section={data} />

      {/* Cross-section diagram */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-bg-card rounded-xl border border-border shadow-sm p-5"
      >
        <h3 className="text-sm font-heading font-semibold text-text-primary mb-4">
          Поперечное сечение ВСМ
        </h3>
        <RailwayCrossSection structures={structures} animate />
      </motion.div>

      {/* Work items */}
      {data.work_items?.length > 0 && <WorkItemsTable items={data.work_items} />}

      {/* Recent reports */}
      {data.recent_reports?.length > 0 && <RecentReports reports={data.recent_reports} />}
    </div>
  )
}
