import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, ChevronLeft, ChevronRight,
  Clock, CheckCircle2, AlertCircle, Loader2, FileX2, Eye,
} from 'lucide-react'

interface ReportItem {
  id: number
  report_date: string
  shift: string
  section_code: string
  section_name: string
  source_type: string
  status: string
  parse_status: string
  created_at: string
  candidates_count: number
}

interface ReportsResponse {
  items: ReportItem[]
  total: number
  page: number
  per_page: number
  pages: number
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: 'Черновик',     color: '#737373', icon: Clock },
  parsing:   { label: 'Разбор...',    color: '#f59e0b', icon: Loader2 },
  review:    { label: 'На проверке',  color: '#3b82f6', icon: Eye },
  confirmed: { label: 'Подтверждён',  color: '#22c55e', icon: CheckCircle2 },
  rejected:  { label: 'Отклонён',     color: '#ef4444', icon: AlertCircle },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft
  const Icon = cfg.icon
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
    >
      <Icon className={`w-3.5 h-3.5 ${status === 'parsing' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  )
}

function ShiftBadge({ shift }: { shift: string }) {
  const isDay = shift === 'day'
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${isDay ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
      {isDay ? 'День' : shift === 'night' ? 'Ночь' : shift}
    </span>
  )
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sectionFilter, setSectionFilter] = useState(searchParams.get('section') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '')
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '')
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1)

  const { data: sections } = useQuery<{ code: string; name: string }[]>({
    queryKey: ['sections-list'],
    queryFn: () => fetch('/api/sections/list').then(r => r.json()),
  })

  const params = new URLSearchParams()
  if (sectionFilter) params.set('section', sectionFilter)
  if (statusFilter) params.set('status', statusFilter)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  params.set('page', String(page))
  params.set('per_page', '15')

  const { data, isLoading, isError } = useQuery<ReportsResponse>({
    queryKey: ['reports', sectionFilter, statusFilter, dateFrom, dateTo, page],
    queryFn: () => fetch(`/api/reports?${params}`).then(r => r.json()),
  })

  function applyFilters() {
    setPage(1)
    const sp = new URLSearchParams()
    if (sectionFilter) sp.set('section', sectionFilter)
    if (statusFilter) sp.set('status', statusFilter)
    if (dateFrom) sp.set('date_from', dateFrom)
    if (dateTo) sp.set('date_to', dateTo)
    setSearchParams(sp)
  }

  return (
    <div className="p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-heading font-bold text-text-primary">
          Отчёты
        </h1>
        <Link
          to="/reports/upload"
          className="inline-flex items-center gap-2 bg-accent-red hover:bg-red-700 text-white
                     px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Загрузить
        </Link>
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-card rounded-xl border border-border shadow-sm p-4 mb-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-text-muted mb-1 block">Участок</label>
            <select
              value={sectionFilter}
              onChange={e => setSectionFilter(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50"
            >
              <option value="">Все участки</option>
              {sections?.map(s => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Статус</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50"
            >
              <option value="">Все статусы</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Дата с</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50
                         [color-scheme:light]"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Дата по</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm
                         text-text-primary focus:outline-none focus:border-accent-red/50
                         [color-scheme:light]"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={applyFilters}
              className="w-full bg-bg-surface hover:bg-border border border-border rounded-lg
                         px-4 py-2 text-sm text-text-primary transition-colors
                         inline-flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" />
              Найти
            </button>
          </div>
        </div>
      </motion.div>

      {/* Table */}
      <div className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-text-muted">
            Ошибка загрузки данных
          </div>
        ) : !data?.items.length ? (
          <div className="p-12 text-center">
            <FileX2 className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted">Отчёты не найдены</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted text-left">
                  <th className="px-4 py-3 font-medium">Дата</th>
                  <th className="px-4 py-3 font-medium">Смена</th>
                  <th className="px-4 py-3 font-medium">Участок</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium text-right">Записей</th>
                  <th className="px-4 py-3 font-medium">Источник</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.items.map((r, i) => (
                    <motion.tr
                      key={r.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border/50 hover:bg-bg-surface/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-text-primary">
                        {r.report_date}
                      </td>
                      <td className="px-4 py-3">
                        <ShiftBadge shift={r.shift} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {r.section_name}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-secondary">
                        {r.candidates_count}
                      </td>
                      <td className="px-4 py-3 text-text-muted text-xs">
                        {r.source_type === 'web_text' ? 'Web' : r.source_type === 'telegram_text' ? 'Telegram' : r.source_type}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={
                            r.status === 'draft'
                              ? `/reports/${r.id}/review`
                              : r.status === 'review'
                              ? `/reports/${r.id}/review`
                              : `/reports/${r.id}/review`
                          }
                          className="text-accent-red hover:text-red-700 text-xs font-medium transition-colors"
                        >
                          {r.status === 'confirmed' ? 'Просмотр' : 'Открыть'}
                        </Link>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-text-muted">
              {data.total} отчётов, стр. {data.page} из {data.pages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg bg-bg-surface border border-border text-text-muted
                           hover:text-text-primary disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(data.pages, p + 1))}
                disabled={page >= data.pages}
                className="p-1.5 rounded-lg bg-bg-surface border border-border text-text-muted
                           hover:text-text-primary disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
