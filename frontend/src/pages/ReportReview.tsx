import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Check, X, Pencil, CheckCheck, Loader2,
  Truck, Hammer, AlertTriangle, Users, Wrench,
  ChevronDown, ChevronUp, Save, Trash2, Database,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  candidate_type: string
  data: Record<string, unknown>
  confidence: number
  accepted: boolean | null
  sort_order: number
}

interface ReportDetail {
  id: number
  report_date: string
  shift: string
  section_code: string
  section_name: string
  source_type: string
  raw_text: string
  status: string
  parse_status: string
  created_at: string
  candidates: Candidate[]
}

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  movement:  { label: 'Перевозка',  icon: Truck,          color: '#3b82f6' },
  work:      { label: 'Работа',     icon: Hammer,         color: '#22c55e' },
  equipment: { label: 'Техника',    icon: Wrench,         color: '#f59e0b' },
  problem:   { label: 'Проблема',   icon: AlertTriangle,  color: '#ef4444' },
  personnel: { label: 'Персонал',   icon: Users,          color: '#8b5cf6' },
}

// ── Confidence bar ─────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-bg-surface rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ── Candidate card ─────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  onAccept,
  onReject,
  onUpdate,
  isConfirmed,
}: {
  candidate: Candidate
  onAccept: () => void
  onReject: () => void
  onUpdate: (data: Record<string, unknown>) => void
  isConfirmed: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const cfg = TYPE_CONFIG[candidate.candidate_type] || TYPE_CONFIG.work
  const Icon = cfg.icon

  const isAccepted = candidate.accepted === true
  const isRejected = candidate.accepted === false
  void (candidate.accepted == null) // isPending — used only for styling

  function startEdit() {
    setEditData(JSON.parse(JSON.stringify(candidate.data)))
    setEditing(true)
    setExpanded(true)
  }

  function saveEdit() {
    onUpdate(editData)
    setEditing(false)
  }

  function renderDataSummary() {
    const d = candidate.data
    switch (candidate.candidate_type) {
      case 'movement': {
        const eq = (d.equipment || {}) as Record<string, string>
        return (
          <div className="space-y-1">
            <div className="text-sm text-text-primary font-medium">
              {String(d.material || '')}
            </div>
            <div className="text-xs text-text-muted">
              {String(d.from_location || '')} &rarr; {String(d.to_location || '')}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono text-text-secondary">{String(d.volume || 0)} {String(d.unit || 'м3')}</span>
              {Number(d.trip_count) > 0 && (
                <span className="text-text-muted">{String(d.trip_count)} рейс.</span>
              )}
            </div>
            {eq.operator_name && (
              <div className="text-xs text-text-muted">
                {eq.operator_name} | {eq.equipment_type} {eq.brand_model}
              </div>
            )}
          </div>
        )
      }
      case 'work': {
        const eq = (d.equipment || {}) as Record<string, string>
        return (
          <div className="space-y-1">
            <div className="text-sm text-text-primary font-medium">
              {String(d.work_name || 'Работа')}
            </div>
            <div className="text-xs text-text-muted">
              {String(d.constructive || '')}
              {d.pk_start ? ` | ${d.pk_start}` : ''}
              {d.pk_end && d.pk_end !== d.pk_start ? ` - ${d.pk_end}` : ''}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono text-text-secondary">{String(d.volume || 0)} {String(d.unit || 'м3')}</span>
              <span className="px-1.5 py-0.5 rounded bg-bg-surface text-text-muted">
                {d.work_group === 'auxiliary' ? 'сопутств.' : 'основная'}
              </span>
            </div>
            {eq.operator_name && (
              <div className="text-xs text-text-muted">
                {eq.operator_name} | {eq.equipment_type} {eq.brand_model}
              </div>
            )}
          </div>
        )
      }
      case 'equipment': {
        return (
          <div className="space-y-1">
            <div className="text-sm text-text-primary font-medium">
              {String(d.equipment_type || '')} {String(d.brand_model || '')}
            </div>
            <div className="text-xs text-text-muted">
              {d.operator_name ? `${String(d.operator_name)} | ` : ''}
              {d.unit_number ? `#${String(d.unit_number)} ` : ''}
              {d.plate_number ? `(${String(d.plate_number)})` : ''}
            </div>
            <div className="text-xs">
              <span className={`px-1.5 py-0.5 rounded ${d.ownership === 'hired' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {d.ownership === 'hired' ? 'наёмная' : 'своя'}
              </span>
              {d.contractor_name ? (
                <span className="text-text-muted ml-2">{String(d.contractor_name)}</span>
              ) : null}
            </div>
          </div>
        )
      }
      case 'problem':
        return (
          <div className="text-sm text-text-primary">{String(d.text || '')}</div>
        )
      case 'personnel':
        return (
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-primary">{String(d.category || '')}</span>
            <span className="font-mono text-lg font-semibold text-text-primary">{String(d.count || 0)}</span>
            <span className="text-xs text-text-muted">чел.</span>
          </div>
        )
      default:
        return <pre className="text-xs text-text-muted">{JSON.stringify(d, null, 2)}</pre>
    }
  }

  function renderEditForm() {
    const entries = Object.entries(editData).filter(([k]) => k !== 'equipment')
    const eqData = (editData.equipment || {}) as Record<string, unknown>
    const eqEntries = Object.entries(eqData)

    return (
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <label className="text-xs text-text-muted w-28 shrink-0">{key}</label>
            <input
              value={typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}
              onChange={e => {
                const newVal = e.target.value
                setEditData(prev => ({
                  ...prev,
                  [key]: key === 'volume' || key === 'trip_count' || key === 'count'
                    ? Number(newVal) || 0
                    : newVal,
                }))
              }}
              className="flex-1 bg-bg-surface border border-border rounded px-2 py-1 text-xs
                         text-text-primary focus:outline-none focus:border-accent-red/50"
            />
          </div>
        ))}
        {eqEntries.length > 0 && (
          <>
            <div className="text-xs text-text-muted font-medium mt-2">Техника:</div>
            {eqEntries.map(([key, val]) => (
              <div key={`eq_${key}`} className="flex items-center gap-2 pl-4">
                <label className="text-xs text-text-muted w-24 shrink-0">{key}</label>
                <input
                  value={String(val ?? '')}
                  onChange={e => {
                    setEditData(prev => ({
                      ...prev,
                      equipment: { ...(prev.equipment as Record<string, unknown> || {}), [key]: e.target.value },
                    }))
                  }}
                  className="flex-1 bg-bg-surface border border-border rounded px-2 py-1 text-xs
                             text-text-primary focus:outline-none focus:border-accent-red/50"
                />
              </div>
            ))}
          </>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setEditing(false)}
            className="text-xs text-text-muted hover:text-text-primary px-3 py-1.5 rounded
                       border border-border transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={saveEdit}
            className="text-xs text-white bg-accent-red hover:bg-red-700 px-3 py-1.5 rounded
                       inline-flex items-center gap-1 transition-colors"
          >
            <Save className="w-3 h-3" />
            Сохранить
          </button>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-bg-card rounded-xl border shadow-sm transition-all ${
        isAccepted
          ? 'border-emerald-300'
          : isRejected
          ? 'border-red-200 opacity-50'
          : 'border-border hover:border-border/80'
      }`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: cfg.color + '20' }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
            </div>
            <div>
              <span className="text-xs font-medium" style={{ color: cfg.color }}>
                {cfg.label}
              </span>
              <ConfidenceBar value={candidate.confidence} />
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Data summary */}
        {renderDataSummary()}

        {/* Expanded edit form */}
        <AnimatePresence>
          {expanded && editing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {renderEditForm()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        {!isConfirmed && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            <button
              onClick={onAccept}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                         text-xs font-medium transition-all ${
                isAccepted
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                  : 'bg-bg-surface text-text-muted hover:text-emerald-600 border border-border'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              {isAccepted ? 'Принято' : 'Принять'}
            </button>
            <button
              onClick={startEdit}
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg
                         text-xs text-text-muted hover:text-text-primary bg-bg-surface border
                         border-border transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onReject}
              className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg
                         text-xs font-medium transition-all ${
                isRejected
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : 'bg-bg-surface text-text-muted hover:text-red-500 border border-border'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────

export function ReportReview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: report, isLoading, isError } = useQuery<ReportDetail>({
    queryKey: ['report-detail', id],
    queryFn: () => fetch(`/api/reports/${id}`).then(r => {
      if (!r.ok) throw new Error('Not found')
      return r.json()
    }),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ candidateId, payload }: {
      candidateId: string
      payload: { data?: Record<string, unknown>; accepted?: boolean }
    }) => {
      const res = await fetch(`/api/reports/${id}/candidates/${candidateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-detail', id] })
    },
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reports/${id}/confirm`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Confirm failed' }))
        throw new Error(err.detail || 'Confirm failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-detail', id] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      return res.json()
    },
    onSuccess: () => {
      navigate('/reports')
    },
  })

  // Batch accept high-confidence candidates
  function batchAcceptHighConfidence() {
    if (!report) return
    report.candidates
      .filter(c => c.confidence >= 0.9 && c.accepted !== true)
      .forEach(c => {
        updateMutation.mutate({ candidateId: c.id, payload: { accepted: true } })
      })
  }

  // Stats
  const stats = useMemo(() => {
    if (!report) return null
    const candidates = report.candidates
    return {
      total: candidates.length,
      accepted: candidates.filter(c => c.accepted === true).length,
      rejected: candidates.filter(c => c.accepted === false).length,
      pending: candidates.filter(c => c.accepted === null).length,
      highConf: candidates.filter(c => c.confidence >= 0.9 && c.accepted !== true).length,
      byType: Object.fromEntries(
        Object.keys(TYPE_CONFIG).map(t => [
          t,
          candidates.filter(c => c.candidate_type === t).length,
        ]),
      ),
    }
  }, [report])

  const isConfirmed = report?.status === 'confirmed'

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-text-muted animate-spin" />
      </div>
    )
  }

  if (isError || !report) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-muted">Отчёт не найден</p>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/reports')}
          className="p-2 rounded-lg bg-bg-card border border-border shadow-sm hover:border-accent-red/40
                     text-text-muted hover:text-text-primary transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-heading font-bold text-text-primary">
            Разбор отчёта #{report.id}
          </h1>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-text-muted font-mono">{report.report_date}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              report.shift === 'day' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
            }`}>
              {report.shift === 'day' ? 'День' : report.shift === 'night' ? 'Ночь' : report.shift}
            </span>
            <span className="text-xs text-text-muted">{report.section_name}</span>
            {isConfirmed && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                Подтверждён
              </span>
            )}
          </div>
        </div>
        {!isConfirmed && (
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-2 rounded-lg bg-bg-card border border-border shadow-sm hover:border-red-300
                       text-text-muted hover:text-red-500 transition-all"
            title="Удалить отчёт"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Stats bar */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-bg-card rounded-xl border border-border shadow-sm p-4 mb-6"
        >
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-text-muted">
              Всего: <span className="font-mono text-text-primary font-semibold">{stats.total}</span>
            </span>
            <span className="text-emerald-600">
              Принято: <span className="font-mono font-semibold">{stats.accepted}</span>
            </span>
            <span className="text-red-500">
              Пропущено: <span className="font-mono font-semibold">{stats.rejected}</span>
            </span>
            <span className="text-text-muted">
              Ожидает: <span className="font-mono font-semibold">{stats.pending}</span>
            </span>
            <div className="flex-1" />
            {!isConfirmed && stats.highConf > 0 && (
              <button
                onClick={batchAcceptHighConfidence}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                           bg-emerald-100 text-emerald-700 text-xs font-medium
                           hover:bg-emerald-200 transition-colors border border-emerald-300"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Принять все &ge;90% ({stats.highConf})
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3">
            {Object.entries(stats.byType).filter(([_, count]) => count > 0).map(([type, count]) => {
              const tcfg = TYPE_CONFIG[type]
              if (!tcfg) return null
              const TIcon = tcfg.icon
              return (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded"
                  style={{ backgroundColor: tcfg.color + '15', color: tcfg.color }}
                >
                  <TIcon className="w-3 h-3" />
                  {tcfg.label}: {count}
                </span>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Split view */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: raw text */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">
            Исходный текст
          </h2>
          <div className="bg-bg-card rounded-xl border border-border shadow-sm p-4 max-h-[calc(100vh-280px)] overflow-y-auto">
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap leading-relaxed">
              {report.raw_text || 'Текст отсутствует'}
            </pre>
          </div>
        </motion.div>

        {/* Right: candidates */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">
            Распознанные записи
          </h2>
          <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {report.candidates.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-text-muted text-sm">
                  Нет распознанных записей.
                </p>
                <p className="text-text-muted text-xs mt-1">
                  Попробуйте загрузить отчёт заново.
                </p>
              </div>
            ) : (
              <AnimatePresence>
                {report.candidates.map(c => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    isConfirmed={isConfirmed}
                    onAccept={() =>
                      updateMutation.mutate({
                        candidateId: c.id,
                        payload: { accepted: c.accepted === true ? undefined : true },
                      })
                    }
                    onReject={() =>
                      updateMutation.mutate({
                        candidateId: c.id,
                        payload: { accepted: c.accepted === false ? undefined : false },
                      })
                    }
                    onUpdate={(data) =>
                      updateMutation.mutate({
                        candidateId: c.id,
                        payload: { data, accepted: true },
                      })
                    }
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      </div>

      {/* Bottom confirm bar */}
      {!isConfirmed && report.candidates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="fixed bottom-0 left-0 right-0 lg:left-64 bg-bg-primary/95 backdrop-blur-sm
                     border-t border-border px-6 py-4 z-40"
        >
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="text-xs text-text-muted">
              {stats && (
                <>
                  Будет импортировано: {' '}
                  <span className="font-mono text-text-primary font-semibold">
                    {stats.accepted + stats.pending}
                  </span>
                  {' '}записей (принятые + ожидающие)
                </>
              )}
            </div>
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              className="inline-flex items-center gap-2 bg-accent-red hover:bg-red-700
                         text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors
                         disabled:opacity-50"
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Импорт...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  Подтвердить и занести в БД
                </>
              )}
            </button>
          </div>
          {confirmMutation.isError && (
            <div className="max-w-4xl mx-auto mt-2">
              <p className="text-xs text-red-500">
                {confirmMutation.error?.message || 'Ошибка импорта'}
              </p>
            </div>
          )}
          {confirmMutation.isSuccess && (
            <div className="max-w-4xl mx-auto mt-2">
              <p className="text-xs text-emerald-600">
                Данные успешно импортированы в базу
              </p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
