/**
 * Вкладка «Отчёты» — /reports.
 *
 * Три состояния внутри одной страницы:
 *   1. list    — таблица uploaded daily_reports из /api/wip/reports
 *   2. upload  — dropzone для .txt/.pdf/.xlsx, отправляет в /api/wip/reports/preview
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
  constructives?: string
}

interface AliasesSummary {
  total_items: number
  resolved: number
  unresolved: number
  unresolved_samples: string[]
}

interface ReferenceSuggestion {
  code: string
  label: string
  score?: number
  source?: string
  table?: string
  default_unit?: string
  work_group?: string
  productivity_enabled?: boolean
  object_type_code?: string
  constructive_code?: string
  constructive_name?: string
}

interface ObjectTypeMeta {
  code: string
  name: string
  map_enabled?: boolean
  work_accounting_enabled?: boolean
  material_accounting_enabled?: boolean
  is_linear?: boolean
  accounting_note?: string | null
}

interface ReferenceMeta {
  object_types: ObjectTypeMeta[]
  constructives: Array<{ code: string; name: string }>
  work_groups: string[]
}

type PreviewValue = string | number | boolean | null | undefined | PreviewItem[] | ReferenceSuggestion[] | Record<string, unknown>
type PreviewItem = Record<string, PreviewValue>

interface TransportTrip extends PreviewItem {
  material?: string
  material_code?: string
  material_suggestions?: ReferenceSuggestion[]
  from?: string
  from_object_code?: string
  from_object_suggestions?: ReferenceSuggestion[]
  to?: string
  to_object_code?: string
  to_object_suggestions?: ReferenceSuggestion[]
  volume?: number | string | null
  trips?: number | string | null
}

interface TransportItem extends PreviewItem {
  driver?: string
  vehicle?: string
  plate?: string
  plate_number?: string
  unit_number?: string
  owner?: string
  trips?: TransportTrip[]
}

interface WorkPreviewItem extends PreviewItem {
  constructive?: string
  constructive_code?: string
  object_code?: string
  object_suggestions?: ReferenceSuggestion[]
  work_name?: string
  work_type_code?: string
  work_type_suggestions?: ReferenceSuggestion[]
  operator?: string
  operator_name?: string
  vehicle?: string
  plate?: string
  plate_number?: string
  unit_number?: string
  pk_rail_start?: string | number | null
  pk_rail_end?: string | number | null
  pk_rail_raw?: string | null
  pk_ad_raw?: string | null
  volume?: string | number | null
  unit?: string
  volume_note?: string
  equipment?: PreviewItem[]
}

interface ParkPreviewItem extends PreviewItem {
  equipment_type?: string
  status?: string
}

interface PersonnelPreviewItem extends PreviewItem {
  category?: string
  count?: string | number | null
}

interface StockpilePreviewItem extends PreviewItem {
  name?: string
  material?: string
  material_code?: string
  material_suggestions?: ReferenceSuggestion[]
  pk_raw_text?: string
  volume?: string | number | null
  unit?: string
  needs_create?: boolean
  existing_object_name?: string
}

interface PileDrivingItem extends PreviewItem {
  field_id?: string | null
  field_code?: string
  field_type?: string
  pk_start?: number | string | null
  pk_end?: number | string | null
  pk_text?: string
  pile_kind?: 'main' | 'test' | string
  count?: number | string | null
  pile_type?: string
  pile_length_label?: string
  is_composite_complete?: boolean
  comment?: string
}

interface PileFieldOption {
  id: string
  field_code: string
  field_type: string
  pile_type: string
  pk_start: number
  pk_end: number
  pk_label: string
  pile_length_label: string
  section_code: string | null
}

interface ParsedPayload {
  source?: { filename: string; chars: number; lines: number }
  aliases?: AliasesSummary
  header: ParsedHeader
  human_summary?: {
    constructives?: string
    delivery_info?: string
    global_comments?: string[]
  }
  transport: TransportItem[]
  main_works: WorkPreviewItem[]
  aux_works: WorkPreviewItem[]
  park: ParkPreviewItem[]
  problems: string
  personnel: PersonnelPreviewItem[]
  stockpiles?: StockpilePreviewItem[]
  piles?: PileDrivingItem[]
  warnings?: string[]
  review_actions?: { stockpiles_to_create?: StockpilePreviewItem[] }
  raw_text?: string
  _stub?: boolean
}

type AliasKind = 'work_type' | 'material' | 'constructive' | 'object'

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
    if (!name.endsWith('.txt') && !name.endsWith('.pdf') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setError('Только .txt, .pdf, .xlsx или .xlsm')
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
          <p className="text-text-muted text-xs mt-2 font-mono">.txt, .pdf, .xlsx или .xlsm</p>
          <input
            ref={fileInputRef} type="file" accept=".txt,.pdf,.xlsx,.xlsm" className="hidden"
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
        stockpiles: payload.stockpiles || [],
        piles: payload.piles || [],
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

  function patchItems<K extends 'transport' | 'main_works' | 'aux_works' | 'park' | 'personnel' | 'stockpiles' | 'piles'>(
    key: K,
    items: ParsedPayload[K],
  ) {
    setPayload(p => ({ ...p, [key]: items }))
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      {payload._stub && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Парсер ещё не реализован — показана демо-структура. Проверьте шапку и нажмите «Импортировать»,
          чтобы сохранить хотя бы запись отчёта.
        </div>
      )}

      {/* header editor */}
      <section className="bg-white border border-border rounded-lg p-4">
        <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">Быстрая проверка</h2>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-text-muted mb-1">Конструктивы</div>
            <div className="font-mono text-text-secondary whitespace-pre-wrap">{payload.human_summary?.constructives || payload.header.section_name || '—'}</div>
          </div>
          <div>
            <div className="text-text-muted mb-1">Информация по завозу</div>
            <div className="font-mono text-text-secondary whitespace-pre-wrap">{payload.human_summary?.delivery_info || '—'}</div>
          </div>
        </div>
        {(payload.warnings || []).length > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2">
            <div className="text-xs font-semibold text-amber-800 mb-1">Требует внимания перед импортом</div>
            <ul className="text-xs text-amber-800 font-mono space-y-0.5">
              {(payload.warnings || []).map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          </div>
        )}
      </section>

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
      <TransportPreviewSection sectionCode={payload.header.section_code} items={payload.transport} onItemsChange={items => patchItems('transport', items)} />
      <WorksPreviewSection sectionCode={payload.header.section_code} title="Основные работы" items={payload.main_works} onItemsChange={items => patchItems('main_works', items)} />
      <WorksPreviewSection sectionCode={payload.header.section_code} title="Сопутствующие работы" items={payload.aux_works} onItemsChange={items => patchItems('aux_works', items)} />
      <PreviewSection title="Парк техники" items={payload.park} fields={['equipment_type', 'brand_model', 'unit_number', 'plate_number', 'operator_name', 'owner', 'status']} onItemsChange={items => patchItems('park', items)} />
      <PreviewSection title="Персонал" items={payload.personnel} fields={['category', 'count']} onItemsChange={items => patchItems('personnel', items)} />
      <PreviewSection title="Накопители" items={payload.stockpiles || []} fields={['name', 'material', 'pk_raw_text', 'rounded_pk', 'volume', 'unit', 'action']} onItemsChange={items => patchItems('stockpiles', items)} />
      <PileDrivingSection sectionCode={payload.header.section_code} items={payload.piles || []} onItemsChange={items => patchItems('piles', items)} />

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

function PreviewSection<T extends PreviewItem>({
  title,
  items,
  fields,
  onItemsChange,
}: {
  title: string
  items: T[]
  fields: string[]
  onItemsChange: (items: T[]) => void
}) {
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
      idx === rowIndex ? { ...row, [field]: coercePreviewValue(field, value) } as T : row
    )))
  }

  function addRow() {
    onItemsChange([...items, Object.fromEntries(fields.map(field => [field, null])) as T])
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
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
                {fields.map(f => (
                  <th key={f} className="px-1.5 py-1 font-medium">{f}</th>
                ))}
                <th className="w-8 px-1.5 py-1" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border/50">
                  {fields.map(f => (
                    <td key={f} className="px-1.5 py-1 min-w-[120px]">
                      <input
                        value={it[f] != null && it[f] !== '' ? String(it[f]) : ''}
                        onChange={e => updateCell(i, f, e.target.value)}
                        placeholder="—"
                        className={inputCls}
                      />
                    </td>
                  ))}
                  <td className="px-1.5 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-red-50 text-text-muted hover:text-red-600"
                      aria-label="Удалить строку"
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

function ReferenceSelect({
  value,
  suggestions,
  kind,
  sectionCode,
  sourceText,
  defaultProductivityEnabled = true,
  placeholder,
  onChange,
}: {
  value?: string | null
  suggestions?: ReferenceSuggestion[]
  kind: AliasKind
  sectionCode?: string | null
  sourceText?: string | null
  defaultProductivityEnabled?: boolean
  placeholder: string
  onChange: (code: string, suggestion?: ReferenceSuggestion) => void
}) {
  const [searchText, setSearchText] = useState('')
  const [remoteOptions, setRemoteOptions] = useState<ReferenceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'create' | 'alias' | null>(null)
  const baseOptions = suggestions ?? []

  const options = useMemo(() => {
    const byCode = new Map<string, ReferenceSuggestion>()
    for (const item of baseOptions) {
      if (item.code) byCode.set(item.code, item)
    }
    for (const item of remoteOptions) {
      if (item.code) byCode.set(item.code, item)
    }
    if (value && !byCode.has(value)) {
      byCode.set(value, { code: value, label: value, source: 'selected' })
    }
    return Array.from(byCode.values())
  }, [baseOptions, remoteOptions, value])

  const selected = value ? options.find(s => s.code === value) : undefined

  useEffect(() => {
    if (selected && !open) {
      setSearchText(selected.label || selected.code)
    }
    if (!value && !open) {
      setSearchText('')
    }
  }, [selected?.code, selected?.label, value, open])

  useEffect(() => {
    const q = searchText.trim()
    if (!open || q.length < 2) {
      setRemoteOptions([])
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({
        kind,
        q,
        limit: '12',
      })
      if (sectionCode) params.set('section', sectionCode)
      try {
        const res = await fetch(`/api/wip/reports/reference-search?${params.toString()}`, { signal: ctrl.signal })
        if (!res.ok) return
        const data = await res.json()
        setRemoteOptions(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!ctrl.signal.aborted) setRemoteOptions([])
      }
    }, 180)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [kind, open, searchText, sectionCode])

  function choose(s: ReferenceSuggestion) {
    onChange(s.code, s)
    setSearchText(s.label || s.code)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        value={searchText}
        placeholder={placeholder}
        title={selected?.label || searchText || placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={e => {
          const next = e.target.value
          setSearchText(next)
          setOpen(true)
          if (!next.trim()) onChange('', undefined)
        }}
        className={inputCls}
      />
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-white shadow-lg">
          {options.map(s => (
            <button
              key={s.code}
              type="button"
              onMouseDown={e => {
                e.preventDefault()
                choose(s)
              }}
              className={`block w-full px-2 py-1.5 text-left text-xs hover:bg-bg-surface ${
                s.code === value ? 'bg-bg-surface text-text-primary' : 'text-text-secondary'
              }`}
            >
              <span className="block whitespace-normal break-words font-medium leading-snug">{s.label}</span>
              <span className="block whitespace-normal break-words text-[10px] text-text-muted">
                {s.code}{s.score != null ? ` · ${Math.round(s.score * 100)}%` : ''}{s.table ? ` · ${s.table}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setDialog('create')}
          className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-text-muted hover:border-accent-red/40 hover:text-accent-red"
        >
          <Plus className="w-2.5 h-2.5" />
          Добавить в БД
        </button>
        {value && (sourceText || searchText) && (
          <button
            type="button"
            onClick={() => setDialog('alias')}
            className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-text-muted hover:border-accent-red/40 hover:text-accent-red"
          >
            <Plus className="w-2.5 h-2.5" />
            Алиас
          </button>
        )}
      </div>
      {dialog === 'create' && (
        <ReferenceCreateModal
          kind={kind}
          sourceText={sourceText || searchText}
          sectionCode={sectionCode}
          defaultProductivityEnabled={defaultProductivityEnabled}
          onClose={() => setDialog(null)}
          onSaved={suggestion => {
            choose(suggestion)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'alias' && value && (
        <ReferenceAliasModal
          kind={kind}
          aliasText={sourceText || searchText}
          canonicalCode={value}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function CandidateHint({ suggestions }: { suggestions?: ReferenceSuggestion[] }) {
  const items = (suggestions ?? []).slice(0, 3)
  if (!items.length) return null
  return (
    <div className="mt-1 space-y-1">
      {items.map(s => (
        <div
          key={s.code}
          className="rounded border border-border bg-white px-2 py-1 text-[11px] text-text-muted"
          title={s.table || undefined}
        >
          <div className="whitespace-normal break-words leading-snug text-text-secondary">{s.label}</div>
          <div className="mt-0.5 whitespace-normal break-words text-[10px]">{s.code}{s.score != null ? ` · ${Math.round(s.score * 100)}%` : ''}</div>
        </div>
      ))}
    </div>
  )
}

function extractPkText(value?: string | null) {
  const text = value || ''
  const withPk = text.match(/ПК\s*\d{3,5}(?:\s*\+\s*\d+(?:[,.]\d+)?)?/i)
  if (withPk) return withPk[0].replace(/\s+/g, ' ').trim()
  const bare = text.match(/\b\d{4}(?:\s*\+\s*\d+(?:[,.]\d+)?)?\b/)
  return bare ? `ПК ${bare[0].replace(/\s+/g, '')}` : ''
}

function pkCodePart(pkText: string) {
  return pkText.match(/(\d{3,5})/)?.[1] || ''
}

function inferObjectDefaults(sourceText?: string | null) {
  const text = (sourceText || '').toLowerCase()
  if (text.includes('накоп')) return { objectTypeCode: 'STOCKPILE', constructiveCode: 'STOCK' }
  if (text.includes('карьер')) return { objectTypeCode: 'BORROW_PIT', constructiveCode: 'STU' }
  if (text.includes('отвал')) return { objectTypeCode: 'TEMP_DUMP', constructiveCode: 'STU' }
  if (text.includes('площад') || text.includes('иссо') || text.includes('проезд')) return { objectTypeCode: 'SERVICE_ROAD', constructiveCode: 'ASP' }
  if (text.includes('дорог') || text.includes('ад') || text.includes('впд')) return { objectTypeCode: 'TEMP_ROAD', constructiveCode: 'VPD' }
  return { objectTypeCode: 'OTHER', constructiveCode: 'STU' }
}

function suggestedReferenceName(kind: AliasKind, sourceText?: string | null) {
  const text = (sourceText || '').trim()
  const pk = extractPkText(text)
  if (kind === 'object' && pk && /площад|иссо|проезд/i.test(text)) {
    return `Устройство площадки и проезда к ИССО ${pk.replace(/ПК\s*/i, 'ПК ')}`
  }
  return text
}

function suggestedReferenceCode(kind: AliasKind, sourceText?: string | null, constructiveCode?: string) {
  const pk = pkCodePart(extractPkText(sourceText))
  if (kind === 'object' && pk) return `${constructiveCode || 'OBJ'}_${pk}`
  return ''
}

function suggestedObjectTypeDraft(sourceText?: string | null) {
  const text = (sourceText || '').toLowerCase()
  if ((text.includes('старт') || text.includes('погруж') || text.includes('сва')) && text.includes('площад')) {
    return {
      code: 'PILE_DRIVING_PAD',
      name: 'Стартовая площадка погружения свай',
    }
  }
  return { code: '', name: '' }
}

function ReferenceCreateModal({
  kind,
  sourceText,
  sectionCode,
  defaultProductivityEnabled = true,
  onClose,
  onSaved,
}: {
  kind: AliasKind
  sourceText?: string | null
  sectionCode?: string | null
  defaultProductivityEnabled?: boolean
  onClose: () => void
  onSaved: (suggestion: ReferenceSuggestion) => void
}) {
  const qc = useQueryClient()
  const objectDefaults = useMemo(() => inferObjectDefaults(sourceText), [sourceText])
  const initialName = suggestedReferenceName(kind, sourceText)
  const initialPk = extractPkText(sourceText)
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState(suggestedReferenceCode(kind, sourceText, objectDefaults.constructiveCode))
  const [aliasText, setAliasText] = useState((sourceText || '').trim())
  const [defaultUnit, setDefaultUnit] = useState(kind === 'work_type' || kind === 'material' ? 'м3' : '')
  const [workGroup, setWorkGroup] = useState('')
  const [productivityEnabled, setProductivityEnabled] = useState(defaultProductivityEnabled)
  const [objectTypeCode, setObjectTypeCode] = useState(objectDefaults.objectTypeCode)
  const [constructiveCode, setConstructiveCode] = useState(objectDefaults.constructiveCode)
  const [objectTypeDialogOpen, setObjectTypeDialogOpen] = useState(false)
  const [pkStart, setPkStart] = useState(initialPk)
  const [pkEnd, setPkEnd] = useState(initialPk)
  const [comment, setComment] = useState(sectionCode ? `created from report preview, ${sectionCode}` : 'created from report preview')

  const { data: meta } = useQuery<ReferenceMeta>({
    queryKey: ['report-reference-meta'],
    queryFn: () => fetch('/api/wip/reports/reference-meta').then(r => r.json()),
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/wip/reports/reference-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          code: code.trim() || null,
          name: name.trim(),
          alias_text: aliasText.trim() || null,
          default_unit: defaultUnit.trim() || null,
          work_group: workGroup.trim() || null,
          productivity_enabled: productivityEnabled,
          object_type_code: objectTypeCode,
          constructive_code: constructiveCode || null,
          pk_start: pkStart.trim() || null,
          pk_end: pkEnd.trim() || null,
          pk_raw_text: pkStart.trim() || null,
          comment: comment.trim() || null,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка создания' }))
        throw new Error(e.detail || 'Ошибка создания')
      }
      return (await res.json()) as ReferenceSuggestion
    },
    onSuccess: suggestion => {
      qc.invalidateQueries({ queryKey: ['aliases-list'] })
      onSaved(suggestion)
    },
  })

  const titleByKind: Record<AliasKind, string> = {
    work_type: 'Добавить работу в БД',
    material: 'Добавить материал в БД',
    object: 'Добавить объект / направление в БД',
    constructive: 'Добавить конструктив в БД',
  }
  const objectTypeOptions = (() => {
    const rows = meta?.object_types || []
    if (objectTypeCode && !rows.some(t => t.code === objectTypeCode)) {
      return [{ code: objectTypeCode, name: objectTypeCode }, ...rows]
    }
    return rows.length ? rows : [{ code: objectTypeCode || 'OTHER', name: objectTypeCode || 'OTHER' }]
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => e.stopPropagation()}>
      <div className="w-full max-w-xl rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-heading font-semibold text-text-primary">{titleByKind[kind]}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-3">
            <label className="block min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Код</span>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="можно пустым" className={inputCls} />
            </label>
            <label className="block min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Название</span>
              <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            </label>
          </div>

          {(kind === 'work_type' || kind === 'material') && (
            <div className="grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)] gap-3">
              <label className="block min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">Ед.</span>
                <input value={defaultUnit} onChange={e => setDefaultUnit(e.target.value)} className={inputCls} />
              </label>
              {kind === 'work_type' && (
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Группа работ</span>
                  <input list="work-groups" value={workGroup} onChange={e => setWorkGroup(e.target.value)} className={inputCls} />
                  <datalist id="work-groups">
                    {(meta?.work_groups || []).map(group => <option key={group} value={group} />)}
                  </datalist>
                </label>
              )}
            </div>
          )}

          {kind === 'work_type' && (
            <label className="inline-flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={productivityEnabled}
                onChange={e => setProductivityEnabled(e.target.checked)}
              />
              Учитывать в расчете производительности
            </label>
          )}

          {kind === 'object' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-text-muted">
                    <span>Тип объекта</span>
                    <button
                      type="button"
                      onClick={e => {
                        e.preventDefault()
                        setObjectTypeDialogOpen(true)
                      }}
                      className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 font-medium normal-case tracking-normal text-text-muted hover:border-accent-red/40 hover:text-accent-red"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      Новый тип
                    </button>
                  </span>
                  <select value={objectTypeCode} onChange={e => setObjectTypeCode(e.target.value)} className={inputCls}>
                    {objectTypeOptions.map(t => (
                      <option key={t.code} value={t.code}>{t.name} · {t.code}</option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Конструктив</span>
                  <select value={constructiveCode} onChange={e => {
                    const next = e.target.value
                    setConstructiveCode(next)
                    if (!code.trim() && pkCodePart(extractPkText(sourceText))) {
                      setCode(suggestedReferenceCode(kind, sourceText, next))
                    }
                  }} className={inputCls}>
                    {(meta?.constructives || [{ code: constructiveCode, name: constructiveCode }]).map(c => (
                      <option key={c.code} value={c.code}>{c.name} · {c.code}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">ПК начало</span>
                  <input value={pkStart} onChange={e => setPkStart(e.target.value)} placeholder="ПК2750 или ПК2750+00" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">ПК конец</span>
                  <input value={pkEnd} onChange={e => setPkEnd(e.target.value)} placeholder="если не задан, будет как начало" className={inputCls} />
                </label>
              </div>
              <label className="block min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">Комментарий</span>
                <input value={comment} onChange={e => setComment(e.target.value)} className={inputCls} />
              </label>
            </>
          )}

          <label className="block min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Фраза из отчёта для алиаса</span>
            <input value={aliasText} onChange={e => setAliasText(e.target.value)} placeholder="можно пустым" className={inputCls} />
          </label>

          {createMutation.isError && (
            <p className="text-xs text-red-600">{(createMutation.error as Error)?.message}</p>
          )}
        </div>
        {kind === 'object' && objectTypeDialogOpen && (
          <ObjectTypeCreateModal
            sourceText={sourceText}
            onClose={() => setObjectTypeDialogOpen(false)}
            onSaved={type => {
              setObjectTypeCode(type.code)
              setObjectTypeDialogOpen(false)
            }}
          />
        )}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Отмена</button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-red px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-burg disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {createMutation.isPending ? 'Создаем…' : 'Создать и выбрать'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ObjectTypeCreateModal({
  sourceText,
  onClose,
  onSaved,
}: {
  sourceText?: string | null
  onClose: () => void
  onSaved: (type: ObjectTypeMeta) => void
}) {
  const qc = useQueryClient()
  const draft = useMemo(() => suggestedObjectTypeDraft(sourceText), [sourceText])
  const [code, setCode] = useState(draft.code)
  const [name, setName] = useState(draft.name)
  const [mapEnabled, setMapEnabled] = useState(true)
  const [workAccountingEnabled, setWorkAccountingEnabled] = useState(true)
  const [materialAccountingEnabled, setMaterialAccountingEnabled] = useState(false)
  const [isLinear, setIsLinear] = useState(false)
  const [accountingNote, setAccountingNote] = useState('created from report preview')

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/wip/reports/object-type-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          map_enabled: mapEnabled,
          work_accounting_enabled: workAccountingEnabled,
          material_accounting_enabled: materialAccountingEnabled,
          is_linear: isLinear,
          accounting_note: accountingNote.trim() || null,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка создания типа объекта' }))
        throw new Error(e.detail || 'Ошибка создания типа объекта')
      }
      return (await res.json()) as ObjectTypeMeta
    },
    onSuccess: type => {
      qc.invalidateQueries({ queryKey: ['report-reference-meta'] })
      onSaved(type)
    },
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => e.stopPropagation()}>
      <div className="w-full max-w-lg rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-heading font-semibold text-text-primary">Добавить тип объекта</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-3">
            <label className="block min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Код типа</span>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="PILE_DRIVING_PAD" className={inputCls} />
            </label>
            <label className="block min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Название</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Стартовая площадка погружения свай" className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-secondary">
            <label className="inline-flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5">
              <input type="checkbox" checked={mapEnabled} onChange={e => setMapEnabled(e.target.checked)} />
              На карте
            </label>
            <label className="inline-flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5">
              <input type="checkbox" checked={workAccountingEnabled} onChange={e => setWorkAccountingEnabled(e.target.checked)} />
              Учет работ
            </label>
            <label className="inline-flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5">
              <input type="checkbox" checked={materialAccountingEnabled} onChange={e => setMaterialAccountingEnabled(e.target.checked)} />
              Учет материалов
            </label>
            <label className="inline-flex items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5">
              <input type="checkbox" checked={isLinear} onChange={e => setIsLinear(e.target.checked)} />
              Линейный объект
            </label>
          </div>
          <label className="block min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Примечание</span>
            <input value={accountingNote} onChange={e => setAccountingNote(e.target.value)} className={inputCls} />
          </label>
          {createMutation.isError && (
            <p className="text-xs text-red-600">{(createMutation.error as Error)?.message}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Отмена</button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!code.trim() || !name.trim() || createMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-red px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-burg disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {createMutation.isPending ? 'Создаем…' : 'Создать тип'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReferenceAliasModal({
  kind,
  aliasText,
  canonicalCode,
  onClose,
  onSaved,
}: {
  kind: AliasKind
  aliasText?: string | null
  canonicalCode: string
  onClose: () => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const [alias, setAlias] = useState((aliasText || '').trim())

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/wip/settings/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_code: canonicalCode,
          alias_text: alias.trim(),
          kind,
          notes: 'created from report preview',
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: 'Ошибка сохранения алиаса' }))
        throw new Error(e.detail || 'Ошибка сохранения алиаса')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aliases-list'] })
      onSaved()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => e.stopPropagation()}>
      <div className="w-full max-w-md rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-heading font-semibold text-text-primary">Связать алиас</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <label className="block min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Фраза из отчёта</span>
            <input value={alias} onChange={e => setAlias(e.target.value)} className={inputCls} />
          </label>
          <div className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-secondary">
            {kind} → <span className="font-mono text-text-primary">{canonicalCode}</span>
          </div>
          {saveMutation.isError && (
            <p className="text-xs text-red-600">{(saveMutation.error as Error)?.message}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Отмена</button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!alias.trim() || saveMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-red px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-burg disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {saveMutation.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WorksPreviewSection({
  sectionCode,
  title,
  items,
  onItemsChange,
}: {
  sectionCode?: string | null
  title: string
  items: WorkPreviewItem[]
  onItemsChange: (items: WorkPreviewItem[]) => void
}) {
  function updateRow(index: number, patch: Partial<WorkPreviewItem>) {
    onItemsChange(items.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  function addRow() {
    onItemsChange([
      ...items,
      {
        work_name: '',
        constructive: '',
        work_type_code: '',
        object_code: '',
        constructive_code: '',
        volume: '',
        unit: 'м3',
        pk_rail_start: '',
        pk_rail_end: '',
        pk_rail_raw: '',
        pk_ad_raw: '',
        equipment: [],
      },
    ])
  }
  function removeRow(index: number) {
    onItemsChange(items.filter((_, i) => i !== index))
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
        <div className="space-y-3">
          {items.map((row, i) => (
            <div key={i} className="rounded-md border border-border bg-bg-surface/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wide text-text-muted">Строка {i + 1}</div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-text-muted hover:text-red-600"
                  aria-label="Удалить строку"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Работа из отчёта</span>
                  <input value={row.work_name || ''} onChange={e => updateRow(i, { work_name: e.target.value })} className={inputCls} />
                  <CandidateHint suggestions={row.work_type_suggestions} />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Объект из отчёта</span>
                  <input value={row.constructive || ''} onChange={e => updateRow(i, { constructive: e.target.value })} className={inputCls} />
                  <CandidateHint suggestions={row.object_suggestions} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_100px] gap-3 items-start">
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Тип работы БД</span>
                  <ReferenceSelect
                    value={row.work_type_code}
                    suggestions={row.work_type_suggestions}
                    kind="work_type"
                    sectionCode={sectionCode}
                    sourceText={row.work_name}
                    defaultProductivityEnabled={title !== 'Сопутствующие работы'}
                    placeholder="— выбрать —"
                    onChange={(code, suggestion) => updateRow(i, {
                      work_type_code: code,
                      unit: row.unit || suggestion?.default_unit || 'м3',
                    })}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Объект БД</span>
                  <ReferenceSelect
                    value={row.object_code || row.constructive_code}
                    suggestions={row.object_suggestions}
                    kind="object"
                    sectionCode={sectionCode}
                    sourceText={row.constructive}
                    placeholder="— выбрать —"
                    onChange={code => updateRow(i, { object_code: code, constructive_code: code })}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Объём</span>
                  <input value={row.volume ?? ''} onChange={e => updateRow(i, { volume: e.target.value })} className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Ед.</span>
                  <input value={row.unit || ''} onChange={e => updateRow(i, { unit: e.target.value })} className={inputCls} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">ПК ВСЖМ начало</span>
                  <input
                    value={row.pk_rail_start ?? ''}
                    onChange={e => updateRow(i, { pk_rail_start: e.target.value })}
                    placeholder="ПК2702+00"
                    className={inputCls}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">ПК ВСЖМ конец</span>
                  <input
                    value={row.pk_rail_end ?? ''}
                    onChange={e => updateRow(i, { pk_rail_end: e.target.value })}
                    placeholder="если пусто, будет как начало"
                    className={inputCls}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">ПК АД / примечание</span>
                  <input
                    value={row.pk_ad_raw || ''}
                    onChange={e => updateRow(i, { pk_ad_raw: e.target.value })}
                    placeholder="при наличии"
                    className={inputCls}
                  />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                <input value={row.operator || row.operator_name || ''} onChange={e => updateRow(i, { operator: e.target.value, operator_name: e.target.value })} placeholder="ФИО" className={inputCls} />
                <input value={row.vehicle || ''} onChange={e => updateRow(i, { vehicle: e.target.value })} placeholder="Техника" className={inputCls} />
                <input value={row.unit_number || ''} onChange={e => updateRow(i, { unit_number: e.target.value })} placeholder="Бортовой №" className={inputCls} />
                <input value={row.plate_number || row.plate || ''} onChange={e => updateRow(i, { plate_number: e.target.value, plate: e.target.value })} placeholder="Госномер" className={inputCls} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TransportPreviewSection({
  sectionCode,
  items,
  onItemsChange,
}: {
  sectionCode?: string | null
  items: TransportItem[]
  onItemsChange: (items: TransportItem[]) => void
}) {
  function updateDriver(index: number, patch: Partial<TransportItem>) {
    onItemsChange(items.map((driver, i) => i === index ? { ...driver, ...patch } : driver))
  }
  function updateTrip(driverIndex: number, tripIndex: number, patch: Partial<TransportTrip>) {
    onItemsChange(items.map((driver, i) => {
      if (i !== driverIndex) return driver
      const trips = (driver.trips || []).map((trip, j) => j === tripIndex ? { ...trip, ...patch } : trip)
      return { ...driver, trips }
    }))
  }
  function addDriver() {
    onItemsChange([...items, { driver: '', vehicle: '', unit_number: '', plate_number: '', plate: '', owner: '', trips: [] }])
  }
  function addTrip(driverIndex: number) {
    onItemsChange(items.map((driver, i) => i === driverIndex
      ? { ...driver, trips: [...(driver.trips || []), { material: '', from: '', to: '', volume: '', unit: 'м3', trips: '' }] }
      : driver))
  }
  function removeTrip(driverIndex: number, tripIndex: number) {
    onItemsChange(items.map((driver, i) => i === driverIndex
      ? { ...driver, trips: (driver.trips || []).filter((_, j) => j !== tripIndex) }
      : driver))
  }
  function removeDriver(driverIndex: number) {
    onItemsChange(items.filter((_, i) => i !== driverIndex))
  }

  return (
    <section className="bg-white border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-heading font-semibold text-text-primary flex-1">
          Перевозки <span className="text-text-muted font-normal">({items.reduce((sum, d) => sum + (d.trips || []).length, 0)} рейс-строк)</span>
        </h2>
        <button type="button" onClick={addDriver} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-text-secondary hover:bg-bg-surface">
          <Plus className="w-3 h-3" />
          Самосвал
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">Нет записей</p>
      ) : (
        <div className="space-y-3">
          {items.map((driver, driverIndex) => (
            <div key={driverIndex} className="rounded-md border border-border bg-bg-surface/40 p-3">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-2">
                <input value={driver.driver || ''} onChange={e => updateDriver(driverIndex, { driver: e.target.value, operator_name: e.target.value })} placeholder="ФИО" className={inputCls} />
                <input value={driver.vehicle || ''} onChange={e => updateDriver(driverIndex, { vehicle: e.target.value })} placeholder="Техника" className={inputCls} />
                <input value={driver.unit_number || ''} onChange={e => updateDriver(driverIndex, { unit_number: e.target.value })} placeholder="Бортовой №" className={inputCls} />
                <input value={driver.plate_number || driver.plate || ''} onChange={e => updateDriver(driverIndex, { plate: e.target.value, plate_number: e.target.value })} placeholder="Госномер" className={inputCls} />
                <input value={driver.owner || ''} onChange={e => updateDriver(driverIndex, { owner: e.target.value })} placeholder="Принадлежность" className={inputCls} />
              </div>
              <div className="space-y-2">
                {(driver.trips || []).map((trip, tripIndex) => (
                  <div key={tripIndex} className="rounded-md border border-border/70 bg-white p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">Рейс {tripIndex + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeTrip(driverIndex, tripIndex)}
                        className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-text-muted hover:text-red-600"
                        aria-label="Удалить рейс"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Материал из отчёта</span>
                        <input value={trip.material || ''} onChange={e => updateTrip(driverIndex, tripIndex, { material: e.target.value })} className={inputCls} />
                        <ReferenceSelect
                          value={trip.material_code}
                          suggestions={trip.material_suggestions}
                          kind="material"
                          sectionCode={sectionCode}
                          sourceText={trip.material}
                          placeholder="материал БД"
                          onChange={code => updateTrip(driverIndex, tripIndex, { material_code: code })}
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Откуда</span>
                        <input value={trip.from || ''} onChange={e => updateTrip(driverIndex, tripIndex, { from: e.target.value, from_location: e.target.value })} className={inputCls} />
                        <ReferenceSelect
                          value={trip.from_object_code}
                          suggestions={trip.from_object_suggestions}
                          kind="object"
                          sectionCode={sectionCode}
                          sourceText={trip.from}
                          placeholder="объект БД"
                          onChange={code => updateTrip(driverIndex, tripIndex, { from_object_code: code })}
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Куда</span>
                        <input value={trip.to || ''} onChange={e => updateTrip(driverIndex, tripIndex, { to: e.target.value, to_location: e.target.value })} className={inputCls} />
                        <ReferenceSelect
                          value={trip.to_object_code}
                          suggestions={trip.to_object_suggestions}
                          kind="object"
                          sectionCode={sectionCode}
                          sourceText={trip.to}
                          placeholder="объект БД"
                          onChange={code => updateTrip(driverIndex, tripIndex, { to_object_code: code })}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-[140px_100px_100px] gap-2">
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Объём</span>
                        <input value={trip.volume ?? ''} onChange={e => updateTrip(driverIndex, tripIndex, { volume: e.target.value })} className={inputCls} />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Ед.</span>
                        <input value={(trip.unit as string) || 'м3'} onChange={e => updateTrip(driverIndex, tripIndex, { unit: e.target.value })} className={inputCls} />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">Рейсы</span>
                        <input value={trip.trips ?? ''} onChange={e => updateTrip(driverIndex, tripIndex, { trips: e.target.value, trip_count: e.target.value })} className={inputCls} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <button type="button" onClick={() => addTrip(driverIndex)} className="text-[11px] font-semibold text-accent-red hover:underline">+ рейс</button>
                <button type="button" onClick={() => removeDriver(driverIndex)} className="text-[11px] font-semibold text-text-muted hover:text-red-600">удалить самосвал</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function PileDrivingSection({
  sectionCode,
  items,
  onItemsChange,
}: {
  sectionCode: string
  items: PileDrivingItem[]
  onItemsChange: (items: PileDrivingItem[]) => void
}) {
  const { data } = useQuery<{ rows: PileFieldOption[] }>({
    queryKey: ['report-pile-fields', sectionCode],
    queryFn: () => fetch(`/api/wip/reports/pile-fields${sectionCode ? `?section=${encodeURIComponent(sectionCode)}` : ''}`).then(r => r.json()),
  })
  const fields = data?.rows ?? []

  function applyField(row: PileDrivingItem, fieldId: string): PileDrivingItem {
    const field = fields.find(f => f.id === fieldId)
    if (!field) return { ...row, field_id: fieldId }
    return {
      ...row,
      field_id: field.id,
      field_code: field.field_code,
      field_type: field.field_type,
      pile_kind: field.field_type === 'test' ? 'test' : row.pile_kind || 'main',
      pk_start: field.pk_start,
      pk_end: field.pk_end,
      pk_text: field.pk_label,
      pile_type: field.pile_type,
      pile_length_label: field.pile_length_label,
    }
  }
  function updateRow(index: number, patch: Partial<PileDrivingItem>) {
    onItemsChange(items.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  function addRow() {
    onItemsChange([...items, { field_id: '', field_code: '', pile_kind: 'main', count: '', pile_type: '', pile_length_label: '', is_composite_complete: false }])
  }
  function removeRow(index: number) {
    onItemsChange(items.filter((_, i) => i !== index))
  }

  return (
    <section className="bg-white border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-heading font-semibold text-text-primary flex-1">
          Забивка свай <span className="text-text-muted font-normal">({items.length})</span>
        </h2>
        <button type="button" onClick={addRow} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] font-medium text-text-secondary hover:bg-bg-surface">
          <Plus className="w-3 h-3" />
          Строка
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">Можно добавить строки вручную после проверки отчёта.</p>
      ) : (
        <div className="space-y-3">
          {items.map((row, i) => (
            <div key={i} className="rounded-md border border-border bg-bg-surface/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wide text-text-muted">Строка {i + 1}</div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-text-muted hover:text-red-600"
                  aria-label="Удалить строку"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_140px_110px_180px_160px] gap-3 items-start">
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Поле / пикет</span>
                    <select value={row.field_id || ''} onChange={e => onItemsChange(items.map((item, idx) => idx === i ? applyField(item, e.target.value) : item))} className={inputCls}>
                      <option value="">— выбрать поле —</option>
                      {fields.map(field => (
                        <option key={field.id} value={field.id}>{field.field_code} · {field.pk_label}</option>
                      ))}
                    </select>
                    {row.pk_text && <div className="mt-1 text-[10px] text-text-muted break-words">{row.pk_text}</div>}
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Тип</span>
                    <select value={row.pile_kind || 'main'} onChange={e => updateRow(i, { pile_kind: e.target.value })} className={inputCls}>
                      <option value="main">основные</option>
                      <option value="test">пробные</option>
                    </select>
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Свай</span>
                  <input value={row.count ?? ''} onChange={e => updateRow(i, { count: e.target.value })} className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Длина</span>
                    <div className="rounded border border-border bg-bg-surface px-2 py-1.5 text-text-secondary break-words">
                      {row.pile_length_label || row.pile_type || '—'}
                    </div>
                </label>
                <label className="flex min-w-0 items-center gap-2 pt-5 text-xs text-text-secondary">
                    <input type="checkbox" checked={Boolean(row.is_composite_complete)} onChange={e => updateRow(i, { is_composite_complete: e.target.checked })} className="h-4 w-4 accent-red-700" />
                    <span>Составная готова</span>
                </label>
              </div>
              <label className="mt-3 block min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">Комментарий</span>
                <input value={row.comment || ''} onChange={e => updateRow(i, { comment: e.target.value })} className={inputCls} />
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const inputCls = "w-full rounded border border-border bg-white px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-red/50"

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
            <h2 className="text-sm font-heading font-semibold text-text-primary leading-tight break-words">{title}</h2>
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
  const h = parsed.header
  const park = useMemo(() => parsed.park ?? [], [parsed.park])
  const parkByType = useMemo(() => {
    const acc: Record<string, { working: number; repair: number }> = {}
    for (const p of park) {
      const t = p.equipment_type || '—'
      if (!acc[t]) acc[t] = { working: 0, repair: 0 }
      if (p.status === 'working') acc[t].working++
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
        {(parsed.human_summary?.constructives || h.constructives) && (
          <div className="text-xs text-text-muted font-mono mt-0.5">Конструктивы: {parsed.human_summary?.constructives || h.constructives}</div>
        )}
        {parsed.human_summary?.delivery_info && (
          <div className="text-xs text-text-muted font-mono mt-0.5">Завоз: {parsed.human_summary.delivery_info}</div>
        )}
        {(parsed.warnings || []).length > 0 && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
            {(parsed.warnings || []).map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}
      </div>

      {/* Transport — drivers */}
      <section>
        <h4 className="text-xs font-semibold text-text-primary mb-1.5">
          Перевозка <span className="text-text-muted font-normal">({(parsed.transport || []).length})</span>
        </h4>
        <div className="space-y-2">
          {parsed.transport.map((d, i) => (
            <div key={i} className="border border-border rounded px-2 py-1.5 bg-bg-surface/40">
              <div className="font-medium text-text-primary">{d.driver}</div>
              {d.vehicle && (
                <div className="text-xs text-text-secondary font-mono">
                  {d.vehicle} (б/н {d.unit_number || '—'}; г/н {d.plate_number || d.plate || '—'}); {d.owner}
                </div>
              )}
              {(d.trips || []).length > 0 && (
                <ul className="mt-1 text-xs text-text-secondary space-y-1">
                  {(d.trips || []).map((t, j) => (
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
                          <AliasTerm text={t.from} code={t.from_object_code} kind="object" />
                          <span className="text-text-muted">→</span>
                          <AliasTerm text={t.to} code={t.to_object_code} kind="object" />
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
      <WorksSection title="Основные работы" items={parsed.main_works} />
      <WorksSection title="Сопутствующие работы" items={parsed.aux_works} />

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
            {parsed.personnel.map((p, i) => (
              <li key={i} className="text-text-secondary">{p.category}: {p.count}</li>
            ))}
          </ul>
        </section>
      )}

      {(parsed.stockpiles || []).length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-text-primary mb-1.5">Накопители</h4>
          <ul className="text-xs font-mono space-y-1">
            {(parsed.stockpiles || []).map((s, i) => (
              <li key={i} className="text-text-secondary">
                {s.name} · {s.pk_raw_text || 'ПК н/д'} · {s.volume ?? '—'} {s.unit || ''}
                {s.needs_create && <span className="text-amber-700"> · будет создан после подтверждения</span>}
                {s.existing_object_name && <span className="text-emerald-700"> · найден: {s.existing_object_name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(parsed.piles || []).length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-text-primary mb-1.5">Забивка свай</h4>
          <ul className="text-xs font-mono space-y-1">
            {(parsed.piles || []).map((p, i) => (
              <li key={i} className="text-text-secondary">
                {p.field_code || 'поле н/д'} · {p.pile_kind === 'test' ? 'пробные' : 'основные'} · {p.count ?? '—'} шт · {p.pile_length_label || p.pile_type || 'длина н/д'}
                {p.is_composite_complete && <span className="text-emerald-700"> · составная готова</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function WorksSection({ title, items }: { title: string; items: WorkPreviewItem[] }) {
  const grouped = useMemo(() => {
    const acc: Record<string, WorkPreviewItem[]> = {}
    for (const w of items) {
      const k = w.constructive || '—'
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
          const objectCode = firstWithCode?.object_code ?? firstWithCode?.constructive_code ?? null
          return (
            <div key={constr}>
              <div className="text-xs font-mono mb-0.5">
                <AliasTerm text={constr} code={objectCode} kind="object" tone="pink" />
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
                        {w.vehicle && <> · {w.vehicle} (б/н {w.unit_number || '—'}; г/н {w.plate_number || w.plate || '—'})</>}
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
    object: 'VPD_048',
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
          <option value="object">object</option>
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
  const constrRe = /^-\s*(АД\s*[\d.]+(?:\s*№\s*\d+(?:\.\d+)?)?)\s*-\s*$/i
  const vehicleRe = /^(.+?)\s*\(([^)]+)\);\s*(.+)$/
  const matRe = /^\/(.+?)\/\s*$/
  const pkLine = /ПК\s*\d+[+]\d/i

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
