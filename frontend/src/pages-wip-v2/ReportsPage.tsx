/**
 * Вкладка «Отчёты» — /reports.
 *
 * Три состояния внутри одной страницы:
 *   1. list    — таблица uploaded daily_reports из /api/wip/reports
 *   2. upload  — dropzone для .txt/.pdf, отправляет в /api/wip/reports/preview
 *   3. preview — человекочитаемый просмотр распарсенной структуры + inline-правки;
 *                «Импортировать» → /api/wip/reports/import.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Check, X, ChevronRight, Plus } from 'lucide-react'

// ── types ───────────────────────────────────────────────────────────────

interface ReportRow {
  id: string
  report_date: string
  shift: string
  source_type: string
  status: string
  parse_status: string
  operator_status: string
  created_at: string
  section_code: string | null
  section_name: string | null
  work_items_count: number
  movements_count: number
  equipment_count: number
}

interface ParsedHeader {
  report_date: string
  shift: string
  section_code: string
  section_name?: string
  author?: string
}

interface AliasesSummary {
  total_items: number
  resolved: number
  unresolved: number
  unresolved_samples: string[]
}

interface ParsedPayload {
  source?: { filename: string; chars: number; lines: number }
  aliases?: AliasesSummary
  header: ParsedHeader
  transport: Record<string, any>[]
  main_works: Record<string, any>[]
  aux_works: Record<string, any>[]
  park: Record<string, any>[]
  problems: string
  personnel: Record<string, any>[]
  raw_text?: string
  _stub?: boolean
}

type AliasKind = 'work_type' | 'material' | 'constructive'

type Section = { code: string; name: string }
type Mode = 'list' | 'upload' | 'preview'
type SortKey = 'date' | 'section' | 'status'
type SortDir = 'asc' | 'desc'

// ── helpers ─────────────────────────────────────────────────────────────

function shiftLabel(s: string) {
  return s === 'day' ? 'День' : s === 'night' ? 'Ночь' : '—'
}

function sourceLabel(s: string) {
  if (s === 'telegram_text') return 'Telegram'
  if (s === 'web_text' || s === 'web_upload') return 'Web'
  return s || '—'
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    draft: 'Черновик',
    review: 'Проверка',
    confirmed: 'Подтверждён',
    rejected: 'Отклонён',
  }
  return map[s] || s
}

function statusTone(s: string): string {
  if (s === 'confirmed') return 'bg-emerald-100 text-emerald-700'
  if (s === 'review') return 'bg-sky-100 text-sky-700'
  if (s === 'rejected') return 'bg-red-100 text-red-700'
  return 'bg-neutral-100 text-neutral-600'
}

// ── main page ───────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [mode, setMode] = useState<Mode>('list')
  const [parsed, setParsed] = useState<ParsedPayload | null>(null)
  const [sourceFilename, setSourceFilename] = useState<string>('')

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <FileText className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Отчёты
        </h1>
        {mode === 'list' && (
          <button
            onClick={() => setMode('upload')}
            className="inline-flex items-center gap-2 bg-accent-red hover:bg-accent-burg text-white
                       px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" />
            Загрузить
          </button>
        )}
        {mode !== 'list' && (
          <button
            onClick={() => { setMode('list'); setParsed(null) }}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            <X className="w-4 h-4" />
            К списку
          </button>
        )}
      </div>

      <div className="p-4 sm:p-6 pb-24 lg:pb-6">
        {mode === 'list' && <ReportsList />}
        {mode === 'upload' && (
          <UploadPane
            onParsed={(p, name) => { setParsed(p); setSourceFilename(name); setMode('preview') }}
          />
        )}
        {mode === 'preview' && parsed && (
          <PreviewPane
            parsed={parsed}
            sourceFilename={sourceFilename}
            onImported={() => { setMode('list'); setParsed(null) }}
          />
        )}
      </div>
    </div>
  )
}

// ── list ────────────────────────────────────────────────────────────────

function ReportsList() {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery<ReportRow[]>({
    queryKey: ['reports-list'],
    queryFn: () => fetch('/api/wip/reports').then(r => r.json()),
  })

  const rows = useMemo(() => {
    const base = data ?? []
    const cmp = (a: ReportRow, b: ReportRow): number => {
      if (sortKey === 'date') return a.report_date.localeCompare(b.report_date)
      if (sortKey === 'section') return (a.section_name ?? '').localeCompare(b.section_name ?? '')
      return a.status.localeCompare(b.status)
    }
    const sorted = [...base].sort(cmp)
    return sortDir === 'asc' ? sorted : sorted.reverse()
  }, [data, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  if (isLoading) {
    return <div className="py-12 text-center text-text-muted text-sm">Загрузка…</div>
  }
  if (isError) {
    return <div className="py-12 text-center text-red-500 text-sm">Ошибка загрузки</div>
  }
  if (!rows.length) {
    return (
      <div className="py-16 text-center">
        <FileText className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted text-sm">Отчётов ещё нет</p>
      </div>
    )
  }

  const sortMark = (k: SortKey) => sortKey !== k ? '' : sortDir === 'asc' ? ' ↑' : ' ↓'

  return (
    <div className="bg-white border border-border rounded-lg overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm font-mono">
        <thead className="bg-bg-surface text-text-muted text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => toggleSort('date')}>
              Дата{sortMark('date')}
            </th>
            <th className="px-3 py-2 text-left">Смена</th>
            <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => toggleSort('section')}>
              Участок{sortMark('section')}
            </th>
            <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => toggleSort('status')}>
              Статус{sortMark('status')}
            </th>
            <th className="px-3 py-2 text-right">Записей</th>
            <th className="px-3 py-2 text-left">Источник</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const total = (r.work_items_count ?? 0) + (r.movements_count ?? 0) + (r.equipment_count ?? 0)
            return (
              <tr
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className="border-t border-border hover:bg-bg-surface/50 cursor-pointer"
              >
                <td className="px-3 py-2 text-text-primary">{r.report_date}</td>
                <td className="px-3 py-2 text-text-secondary">{shiftLabel(r.shift)}</td>
                <td className="px-3 py-2 text-text-secondary">{r.section_name ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusTone(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-text-secondary">{total}</td>
                <td className="px-3 py-2 text-text-muted text-xs">{sourceLabel(r.source_type)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {selectedId && (
        <ReportDetailModal reportId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

// ── upload ──────────────────────────────────────────────────────────────

function UploadPane({ onParsed }: { onParsed: (p: ParsedPayload, filename: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [pastedText, setPastedText] = useState('')

  const previewMutation = useMutation({
    mutationFn: async (input: { file?: File; text?: string; name: string }) => {
      const fd = new FormData()
      if (input.file) {
        fd.append('file', input.file)
      } else if (input.text) {
        const blob = new Blob([input.text], { type: 'text/plain' })
        fd.append('file', blob, input.name || 'pasted.txt')
      }
      const res = await fetch('/api/wip/reports/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка разбора' }))
        throw new Error(e.detail || 'Ошибка разбора')
      }
      return (await res.json()) as ParsedPayload
    },
    onSuccess: (parsed, input) => onParsed(parsed, input.name),
    onError: (e: Error) => setError(e.message),
  })

  const handleFile = useCallback((file: File) => {
    setError(null)
    const name = file.name.toLowerCase()
    if (!name.endsWith('.txt') && !name.endsWith('.pdf')) {
      setError('Только .txt и .pdf')
      return
    }
    previewMutation.mutate({ file, name: file.name })
  }, [previewMutation])

  const handleText = useCallback(() => {
    setError(null)
    const t = pastedText.trim()
    if (!t) {
      setError('Вставьте текст отчёта')
      return
    }
    previewMutation.mutate({ text: t, name: `pasted-${Date.now()}.txt` })
  }, [pastedText, previewMutation])

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4 text-xs">
        <button
          onClick={() => setMode('file')}
          className={`px-3 py-1.5 rounded-md ${mode === 'file' ? 'bg-text-primary text-white' : 'bg-bg-surface text-text-muted'}`}
        >📄 Файл</button>
        <button
          onClick={() => setMode('text')}
          className={`px-3 py-1.5 rounded-md ${mode === 'text' ? 'bg-text-primary text-white' : 'bg-bg-surface text-text-muted'}`}
        >✏️ Текст (вставить)</button>
      </div>

      {mode === 'file' ? (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setIsDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all bg-white
            ${isDragging ? 'border-accent-red bg-red-50' : 'border-border hover:border-accent-red/50'}`}
        >
          <Upload className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-primary font-medium">Перетащите файл или нажмите для выбора</p>
          <p className="text-text-muted text-xs mt-2 font-mono">.txt или .pdf</p>
          <input
            ref={fileInputRef} type="file" accept=".txt,.pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-white p-4">
          <label className="text-xs uppercase tracking-wider text-text-muted block mb-2">
            Вставь текст суточного отчёта (формат «===СЕКЦИЯ===»)
          </label>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            rows={18}
            placeholder={'===Шапка===\nДата - 22.04.2026\nСмена - день\nУчасток - участок №8\n...\n\n===Перевозка===\n-Водитель-\n...'}
            className="w-full text-xs font-mono border border-border rounded-md p-2 resize-y min-h-[240px]"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={handleText}
              disabled={!pastedText.trim() || previewMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-accent-red text-white hover:bg-accent-burg disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Разобрать
            </button>
          </div>
        </div>
      )}

      {previewMutation.isPending && (
        <p className="mt-4 text-center text-text-muted text-sm">Разбираем…</p>
      )}
      {error && (
        <p className="mt-4 text-center text-red-500 text-sm">{error}</p>
      )}
    </div>
  )
}

// ── preview ─────────────────────────────────────────────────────────────

function PreviewPane({
  parsed,
  sourceFilename,
  onImported,
}: {
  parsed: ParsedPayload
  sourceFilename: string
  onImported: () => void
}) {
  const qc = useQueryClient()
  const [payload, setPayload] = useState<ParsedPayload>(parsed)

  const { data: sections } = useQuery<Section[]>({
    queryKey: ['sections-list'],
    queryFn: () => fetch('/api/sections/list').then(r => r.json()),
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      const body = {
        header: payload.header,
        transport: payload.transport,
        main_works: payload.main_works,
        aux_works: payload.aux_works,
        park: payload.park,
        problems: payload.problems,
        personnel: payload.personnel,
        raw_text: payload.raw_text,
        source_type: 'web_upload',
        source_reference: sourceFilename,
      }
      const res = await fetch('/api/wip/reports/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка импорта' }))
        throw new Error(e.detail || 'Ошибка импорта')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-list'] })
      onImported()
    },
  })

  function patchHeader<K extends keyof ParsedHeader>(key: K, value: ParsedHeader[K]) {
    setPayload(p => ({ ...p, header: { ...p.header, [key]: value } }))
  }

  function patchItems(key: 'transport' | 'main_works' | 'aux_works' | 'park' | 'personnel', items: Record<string, any>[]) {
    setPayload(p => ({ ...p, [key]: items }))
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {payload._stub && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Парсер ещё не реализован — показана демо-структура. Проверьте шапку и нажмите «Импортировать»,
          чтобы сохранить хотя бы запись отчёта.
        </div>
      )}

      {/* header editor */}
      <section className="bg-white border border-border rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">Шапка</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-text-muted">Дата</span>
            <input
              type="date"
              value={payload.header.report_date}
              onChange={e => patchHeader('report_date', e.target.value)}
              className="w-full mt-1 bg-bg-surface border border-border rounded px-2 py-1.5 text-sm font-mono
                         focus:outline-none focus:border-accent-red/50"
            />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted">Смена</span>
            <select
              value={payload.header.shift}
              onChange={e => patchHeader('shift', e.target.value)}
              className="w-full mt-1 bg-bg-surface border border-border rounded px-2 py-1.5 text-sm
                         focus:outline-none focus:border-accent-red/50"
            >
              <option value="day">День</option>
              <option value="night">Ночь</option>
              <option value="unknown">—</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-text-muted">Участок</span>
            <select
              value={payload.header.section_code}
              onChange={e => patchHeader('section_code', e.target.value)}
              className="w-full mt-1 bg-bg-surface border border-border rounded px-2 py-1.5 text-sm
                         focus:outline-none focus:border-accent-red/50"
            >
              <option value="">— не задан —</option>
              {sections?.map(s => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* sections */}
      <PreviewSection title="Перевозки" items={payload.transport} fields={['material', 'from_location', 'to_location', 'volume', 'unit']} onItemsChange={items => patchItems('transport', items)} />
      <PreviewSection title="Основные работы" items={payload.main_works} fields={['work_name', 'constructive', 'pk_start', 'pk_end', 'volume', 'unit']} onItemsChange={items => patchItems('main_works', items)} />
      <PreviewSection title="Сопутствующие работы" items={payload.aux_works} fields={['work_name', 'volume', 'unit', 'comment']} onItemsChange={items => patchItems('aux_works', items)} />
      <PreviewSection title="Парк техники" items={payload.park} fields={['equipment_type', 'brand_model', 'plate_number', 'operator_name', 'ownership_type', 'contractor_name']} onItemsChange={items => patchItems('park', items)} />
      <PreviewSection title="Персонал" items={payload.personnel} fields={['category', 'count']} onItemsChange={items => patchItems('personnel', items)} />

      <section className="bg-white border border-border rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">Проблемы</h2>
        <textarea
          value={payload.problems || ''}
          onChange={e => setPayload(p => ({ ...p, problems: e.target.value }))}
          rows={3}
          className="w-full bg-bg-surface border border-border rounded px-2 py-1.5 text-sm font-mono
                     focus:outline-none focus:border-accent-red/50"
        />
      </section>

      {/* import */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {importMutation.isError && (
          <p className="text-red-500 text-sm mr-auto">{importMutation.error?.message}</p>
        )}
        <button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          className="inline-flex items-center gap-2 bg-accent-red hover:bg-accent-burg text-white
                     px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          {importMutation.isPending ? 'Импорт…' : 'Импортировать'}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── preview sub-section ─────────────────────────────────────────────────

function PreviewSection({
  title,
  items,
  fields,
  onItemsChange,
}: {
  title: string
  items: Record<string, any>[]
  fields: string[]
  onItemsChange: (items: Record<string, any>[]) => void
}) {
  const [editing, setEditing] = useState<{ row: number; field: string; value: string } | null>(null)

  function coercePreviewValue(field: string, value: string) {
    if (value.trim() === '') return null
    if (['volume', 'count', 'pk_start', 'pk_end'].includes(field)) {
      const num = Number(value.replace(',', '.'))
      return Number.isFinite(num) ? num : value
    }
    return value
  }

  function updateCell(rowIndex: number, field: string, value: string) {
    onItemsChange(items.map((row, idx) => (
      idx === rowIndex ? { ...row, [field]: coercePreviewValue(field, value) } : row
    )))
    setEditing(null)
  }

  function addRow() {
    onItemsChange([...items, Object.fromEntries(fields.map(field => [field, null]))])
  }

  function removeRow(rowIndex: number) {
    onItemsChange(items.filter((_, idx) => idx !== rowIndex))
  }

  return (
    <section className="bg-white border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-heading font-semibold text-text-primary flex-1">
          {title} <span className="text-text-muted font-normal">({items.length})</span>
        </h2>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-text-secondary hover:bg-bg-surface"
        >
          <Plus className="w-3 h-3" />
          Строка
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">Нет записей</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-text-muted text-left">
                {fields.map(f => (
                  <th key={f} className="px-2 py-1 font-medium">{f}</th>
                ))}
                <th className="w-8 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border/50">
                  {fields.map(f => {
                    const isEditing = editing?.row === i && editing.field === f
                    return (
                      <td
                        key={f}
                        className="px-2 py-1 text-text-secondary min-w-[120px] cursor-text"
                        onDoubleClick={() => setEditing({ row: i, field: f, value: it[f] != null ? String(it[f]) : '' })}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editing.value}
                            onChange={e => setEditing({ ...editing, value: e.target.value })}
                            onBlur={() => updateCell(i, f, editing.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') updateCell(i, f, editing.value)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            className="w-full border border-accent-red/40 rounded px-1 py-0.5 bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-red"
                          />
                        ) : (
                          it[f] != null && it[f] !== '' ? String(it[f]) : '—'
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-red-50 text-text-muted hover:text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── detail modal ────────────────────────────────────────────────────────

interface PreviewResponse {
  available: boolean
  reason?: string
  meta: {
    id: string
    report_date: string | null
    shift: string | null
    section_code: string | null
    section_name: string | null
    source_type: string | null
    source_reference: string | null
  }
  parsed?: ParsedPayload
}

function ReportDetailModal({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data, isLoading, isError } = useQuery<PreviewResponse>({
    queryKey: ['report-preview', reportId],
    queryFn: () => fetch(`/api/wip/reports/${reportId}/preview`).then(r => r.json()),
  })

  const meta = data?.meta
  const parsed = data?.parsed
  const title = meta
    ? `Отчёт ${meta.report_date ?? '—'} / смена ${shiftLabel(meta.shift ?? '')} / ${meta.section_name ?? '—'}`
    : 'Отчёт'

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full flex flex-col"
        style={{ maxWidth: '90vw', maxHeight: '90vh', height: '90vh' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-accent-red shrink-0" />
            <h2 className="text-sm font-heading font-semibold text-text-primary truncate">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 min-h-0 overflow-hidden">
          {/* LEFT — extracted */}
          <div className="overflow-y-auto overflow-x-hidden p-4 border-r border-border min-h-0"
               style={{ WebkitOverflowScrolling: 'touch' }}>
            <h3 className="text-xs uppercase tracking-wide text-text-muted mb-3 sticky top-0 bg-white py-1 z-10">
              Извлечённые параметры
            </h3>
            {isLoading && <p className="text-text-muted text-sm">Загрузка…</p>}
            {isError && <p className="text-red-500 text-sm">Ошибка загрузки</p>}
            {data && !data.available && (
              <p className="text-text-muted text-sm">{data.reason}</p>
            )}
            {parsed && <ExtractedView parsed={parsed} />}
          </div>

          {/* RIGHT — raw highlighted */}
          <div className="overflow-y-auto overflow-x-hidden p-4 bg-bg-surface min-h-0 border-t lg:border-t-0 border-border"
               style={{ WebkitOverflowScrolling: 'touch' }}>
            <h3 className="text-xs uppercase tracking-wide text-text-muted mb-3 sticky top-0 bg-bg-surface py-1 z-10">
              Распарсенный исходник
            </h3>
            {parsed?.raw_text
              ? <HighlightedRaw text={parsed.raw_text} />
              : <p className="text-text-muted text-sm">Исходный текст недоступен</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExtractedView({ parsed }: { parsed: ParsedPayload }) {
  const h = parsed.header as any
  const park = parsed.park || []
  const parkByType = useMemo(() => {
    const acc: Record<string, { working: number; repair: number }> = {}
    for (const p of park) {
      const t = (p.equipment_type as string) || '—'
      if (!acc[t]) acc[t] = { working: 0, repair: 0 }
      if ((p.status as string) === 'working') acc[t].working++
      else acc[t].repair++
    }
    return acc
  }, [park])

  return (
    <div className="space-y-4 text-sm">
      {parsed.aliases && <AliasSummaryBar summary={parsed.aliases} />}

      <div>
        <div className="font-semibold text-text-primary">
          {h.report_date} · {shiftLabel(h.shift)} · {h.section_name || h.section_code || '—'}
        </div>
        {h.constructives && (
          <div className="text-xs text-text-muted font-mono mt-0.5">Конструктивы: {h.constructives}</div>
        )}
      </div>

      {/* Transport — drivers */}
      <section>
        <h4 className="text-xs font-semibold text-text-primary mb-1.5">
          Перевозка <span className="text-text-muted font-normal">({(parsed.transport || []).length})</span>
        </h4>
        <div className="space-y-2">
          {(parsed.transport as any[]).map((d, i) => (
            <div key={i} className="border border-border rounded px-2 py-1.5 bg-bg-surface/40">
              <div className="font-medium text-text-primary">{d.driver}</div>
              {d.vehicle && (
                <div className="text-xs text-text-secondary font-mono">
                  {d.vehicle} ({d.plate}); {d.owner}
                </div>
              )}
              {(d.trips || []).length > 0 && (
                <ul className="mt-1 text-xs text-text-secondary space-y-1">
                  {d.trips.map((t: any, j: number) => (
                    <li key={j} className="font-mono flex flex-wrap items-center gap-1">
                      <AliasTerm
                        text={t.material}
                        code={t.material_code}
                        kind="material"
                        tone="amber"
                      />
                      {t.from && t.to && (
                        <>
                          <span className="text-text-muted">·</span>
                          <AliasTerm text={t.from} code={t.from_object_code} kind="constructive" />
                          <span className="text-text-muted">→</span>
                          <AliasTerm text={t.to} code={t.to_object_code} kind="constructive" />
                        </>
                      )}
                      {t.volume != null && <span className="text-text-muted">· {t.volume} м³</span>}
                      {t.trips != null && <span className="text-text-muted">/ {t.trips} рейс.</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Main works */}
      <WorksSection title="Основные работы" items={parsed.main_works as any[]} />
      <WorksSection title="Сопутствующие работы" items={parsed.aux_works as any[]} />

      {/* Park counts */}
      <section>
        <h4 className="text-xs font-semibold text-text-primary mb-1.5">
          Парк техники <span className="text-text-muted font-normal">({park.length})</span>
        </h4>
        <ul className="text-xs font-mono space-y-0.5">
          {Object.entries(parkByType).map(([t, c]) => (
            <li key={t} className="text-text-secondary">
              {t}: <span className="text-emerald-700">{c.working} в работе</span>
              {c.repair > 0 && <span className="text-red-600"> · {c.repair} ремонт</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* Problems */}
      {parsed.problems && (
        <section>
          <h4 className="text-xs font-semibold text-text-primary mb-1.5">Проблемные вопросы</h4>
          <p className="text-xs text-text-secondary whitespace-pre-wrap">{parsed.problems}</p>
        </section>
      )}

      {/* Personnel */}
      {(parsed.personnel || []).length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-text-primary mb-1.5">Персонал</h4>
          <ul className="text-xs font-mono space-y-0.5">
            {(parsed.personnel as any[]).map((p, i) => (
              <li key={i} className="text-text-secondary">{p.category}: {p.count}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function WorksSection({ title, items }: { title: string; items: any[] }) {
  const grouped = useMemo(() => {
    const acc: Record<string, any[]> = {}
    for (const w of items) {
      const k = (w.constructive as string) || '—'
      if (!acc[k]) acc[k] = []
      acc[k].push(w)
    }
    return acc
  }, [items])

  if (!items.length) return null
  return (
    <section>
      <h4 className="text-xs font-semibold text-text-primary mb-1.5">
        {title} <span className="text-text-muted font-normal">({items.length})</span>
      </h4>
      <div className="space-y-2">
        {Object.entries(grouped).map(([constr, arr]) => {
          const firstWithCode = arr.find(w => w.constructive === constr)
          const constrCode = firstWithCode?.constructive_code ?? null
          return (
            <div key={constr}>
              <div className="text-xs font-mono mb-0.5">
                <AliasTerm text={constr} code={constrCode} kind="constructive" tone="pink" />
              </div>
              <ul className="space-y-1">
                {arr.map((w, i) => {
                  const pkA = w.pk_rail_start != null && w.pk_rail_end != null
                    ? `ПК ${w.pk_rail_start}–${w.pk_rail_end}` : null
                  return (
                    <li key={i} className="border border-border rounded px-2 py-1 text-xs bg-bg-surface/40">
                      <div className="text-text-primary">
                        <AliasTerm text={w.work_name} code={w.work_type_code} kind="work_type" />
                      </div>
                      <div className="text-text-secondary font-mono">
                        {w.operator && <>{w.operator}</>}
                        {w.vehicle && <> · {w.vehicle} ({w.plate})</>}
                      </div>
                      <div className="text-text-muted font-mono">
                        {pkA && <span className="text-purple-700">{pkA}</span>}
                        {w.volume != null && <> · {w.volume} {w.unit || ''}</>}
                        {w.volume_note && <> ({w.volume_note})</>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── alias summary + inline add ──────────────────────────────────────────

function AliasSummaryBar({ summary }: { summary: AliasesSummary }) {
  const { total_items, resolved, unresolved, unresolved_samples } = summary
  const ok = unresolved === 0
  return (
    <div
      title={unresolved_samples.length ? 'Требуют добавления:\n' + unresolved_samples.join('\n') : ''}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-mono flex items-center gap-2 ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
          : 'border-red-300 bg-red-50 text-accent-red'
      }`}
    >
      <span className="font-semibold">Алиасы:</span>
      <span>✓ {resolved} из {total_items} распознано</span>
      {unresolved > 0 && <span>· {unresolved} требуют добавления</span>}
    </div>
  )
}

function AliasTerm({
  text,
  code,
  kind,
  tone,
}: {
  text: string | null | undefined
  code: string | null | undefined
  kind: AliasKind
  tone?: 'amber' | 'pink'
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  if (!text) return <span className="text-text-muted">—</span>

  if (code) {
    const toneCls =
      tone === 'amber' ? 'text-amber-700'
        : tone === 'pink' ? 'text-pink-700'
        : 'text-text-primary'
    return <span className={toneCls}>{text}</span>
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <span className="bg-red-50 text-accent-red border border-red-300 rounded px-1">
        {text}
      </span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-0.5 text-[10px] text-accent-red hover:text-accent-burg
                   border border-red-200 hover:border-accent-red rounded px-1 py-0.5 bg-white"
        title="Добавить в словарь алиасов"
      >
        <Plus className="w-2.5 h-2.5" />
        в словарь
      </button>
      {open && (
        <AliasAddPopover
          initialText={text}
          initialKind={kind}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            // Invalidate everything that depends on alias resolution.
            qc.invalidateQueries({ queryKey: ['aliases-list'] })
            qc.invalidateQueries({ queryKey: ['report-preview'] })
          }}
        />
      )}
    </span>
  )
}

function AliasAddPopover({
  initialText,
  initialKind,
  onClose,
  onSaved,
}: {
  initialText: string
  initialKind: AliasKind
  onClose: () => void
  onSaved: () => void
}) {
  const [aliasText, setAliasText] = useState(initialText)
  const [kind, setKind] = useState<AliasKind>(initialKind)
  const [canonicalCode, setCanonicalCode] = useState('')

  const placeholderByKind: Record<AliasKind, string> = {
    work_type: 'AREA_GRADING',
    material: 'SAND',
    constructive: 'Притрассовая дорога №4.8',
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/wip/settings/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_code: canonicalCode.trim(),
          alias_text: aliasText.trim(),
          kind,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка сохранения' }))
        throw new Error(e.detail || 'Ошибка сохранения')
      }
      return res.json()
    },
    onSuccess: () => onSaved(),
  })

  return (
    <div
      onClick={e => e.stopPropagation()}
      className="absolute z-20 top-full left-0 mt-1 w-72 bg-white border border-border rounded-md
                 shadow-lg p-2 text-xs font-sans"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-text-primary">Новый алиас</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Закрыть">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <label className="block mb-1.5">
        <span className="text-text-muted">alias_text</span>
        <input
          type="text"
          value={aliasText}
          onChange={e => setAliasText(e.target.value)}
          className="w-full mt-0.5 bg-bg-surface border border-border rounded px-1.5 py-1 font-mono
                     focus:outline-none focus:border-accent-red/50"
        />
      </label>
      <label className="block mb-1.5">
        <span className="text-text-muted">kind</span>
        <select
          value={kind}
          onChange={e => setKind(e.target.value as AliasKind)}
          className="w-full mt-0.5 bg-bg-surface border border-border rounded px-1.5 py-1
                     focus:outline-none focus:border-accent-red/50"
        >
          <option value="work_type">work_type</option>
          <option value="material">material</option>
          <option value="constructive">constructive</option>
        </select>
      </label>
      <label className="block mb-2">
        <span className="text-text-muted">canonical_code</span>
        <input
          type="text"
          value={canonicalCode}
          onChange={e => setCanonicalCode(e.target.value)}
          placeholder={placeholderByKind[kind]}
          className="w-full mt-0.5 bg-bg-surface border border-border rounded px-1.5 py-1 font-mono
                     focus:outline-none focus:border-accent-red/50"
        />
      </label>
      {saveMutation.isError && (
        <p className="text-red-500 text-[11px] mb-1.5">{(saveMutation.error as Error)?.message}</p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onClose}
          className="px-2 py-1 text-text-muted hover:text-text-primary"
        >
          Отмена
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!canonicalCode.trim() || !aliasText.trim() || saveMutation.isPending}
          className="inline-flex items-center gap-1 bg-accent-red hover:bg-accent-burg text-white
                     px-2 py-1 rounded disabled:opacity-50"
        >
          <Check className="w-3 h-3" />
          {saveMutation.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

/**
 * Highlight recognized fragments in the raw text.
 * Lines matched per regex; rendered as <pre> with per-line coloured background.
 */
function HighlightedRaw({ text }: { text: string }) {
  const driverRe = /^-\s*(.+?)\s*-\s*$/
  const constrRe = /^-\s*(АД\s*[\d\.]+(?:\s*№\s*\d+(?:\.\d+)?)?)\s*-\s*$/i
  const vehicleRe = /^(.+?)\s*\(([^)]+)\);\s*(.+)$/
  const matRe = /^\/(.+?)\/\s*$/
  const pkLine = /ПК\s*\d+\+\d/i

  const lines = text.split('\n')
  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
      {lines.map((line, i) => {
        let cls = ''
        if (constrRe.test(line))       cls = 'bg-pink-100 text-pink-900'
        else if (driverRe.test(line))  cls = 'bg-sky-100 text-sky-900'
        else if (matRe.test(line))     cls = 'bg-amber-100 text-amber-900'
        else if (vehicleRe.test(line)) cls = 'bg-emerald-100 text-emerald-900'
        else if (pkLine.test(line))    cls = 'bg-purple-100 text-purple-900'
        return (
          <div key={i} className={cls ? `${cls} px-1 rounded-sm` : ''}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}
