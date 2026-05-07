/**
 * Страница «Настройки».
 * Блок 1 — справочник нормативов производительности (4 категории, батч-сохранение per-группа).
 * Блок 2 — словарь алиасов работ/материалов (CRUD).
 *
 * Данные берутся из /api/wip/settings/norms и /api/wip/settings/aliases.
 * Мутации инвалидируют react-query ключи, чтобы следующий запрос перечитал свежее.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings as SettingsIcon, Save, Trash2, Plus, Pencil, Check, X } from 'lucide-react'

// ── types ─────────────────────────────────────────────────────────────────

interface WorkTypeNorm {
  equipment_type: string
  work_type_code: string
  name: string | null
  norm: number
  unit: string | null
  code: string | null
  productivity_enabled: boolean
}
interface SandSectionNorm {
  section: number
  trips: number
  m3_per_trip: number
}
interface GenericNorm { norm_m3_per_shift: number }
interface NormsData {
  work_types: WorkTypeNorm[]
  sand_pit: SandSectionNorm[]
  sand_stockpile: SandSectionNorm[]
  generic: GenericNorm
}

interface AliasRow {
  id: string
  canonical_code: string
  alias_text: string
  kind: 'work_type' | 'material' | 'constructive'
  notes: string | null
  created_at: string | null
}

const ALIAS_KINDS: AliasRow['kind'][] = ['work_type', 'material', 'constructive']
const ALIAS_KIND_LABELS: Record<AliasRow['kind'], string> = {
  work_type: 'Работа',
  material: 'Материал',
  constructive: 'Конструктив',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── small UI helpers ──────────────────────────────────────────────────────

function Section(props: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-white border border-border rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-[15px] font-heading font-bold text-text-primary">{props.title}</h2>
          {props.subtitle && (
            <p className="text-[11px] text-text-muted mt-0.5">{props.subtitle}</p>
          )}
        </div>
        {props.right}
      </div>
      <div className="p-4">{props.children}</div>
    </section>
  )
}

function SaveButton({ onClick, disabled, loading, label = 'Сохранить' }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-accent-red text-white hover:bg-accent-burg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      <Save className="w-3.5 h-3.5" />
      {loading ? 'Сохранение…' : label}
    </button>
  )
}

// ── Norms blocks ──────────────────────────────────────────────────────────

function WorkTypesTable({ rows, onSave, saving }: {
  rows: WorkTypeNorm[]
  onSave: (rows: WorkTypeNorm[]) => void
  saving: boolean
}) {
  // Стандартная сортировка: по типу техники (экск → бульд → автогр → каток → самосвал → прочее),
  // внутри — по коду норматива.
  const ET_ORDER: Record<string, number> = {
    'экскаватор': 1, 'бульдозер': 2, 'автогрейдер': 3, 'каток': 4, 'самосвал': 5,
  }
  const sortRows = (arr: WorkTypeNorm[]): WorkTypeNorm[] =>
    [...arr].sort((a, b) => {
      const da = ET_ORDER[(a.equipment_type || '').toLowerCase()] ?? 99
      const db = ET_ORDER[(b.equipment_type || '').toLowerCase()] ?? 99
      if (da !== db) return da - db
      return (a.code || '').localeCompare(b.code || '')
    })
  const sortedRows = sortRows(rows)
  const [draft, setDraft] = useState<WorkTypeNorm[]>(() => sortedRows)
  const dirty = JSON.stringify(draft) !== JSON.stringify(sortedRows)

  function update(i: number, patch: Partial<WorkTypeNorm>) {
    setDraft(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-surface">
            <tr className="text-text-muted uppercase tracking-wider text-[10px] border-b border-border">
              <th className="text-left py-2 px-2 font-semibold">Код</th>
              <th className="text-left py-2 px-2 font-semibold">Работа</th>
              <th className="text-left py-2 px-2 font-semibold">Ед.</th>
              <th className="text-right py-2 px-2 font-semibold">Норма, ед./смена</th>
              <th className="text-center py-2 px-2 font-semibold">Учитывать</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={`${r.equipment_type}|${r.work_type_code}`} className="border-b border-border/60">
                <td className="py-1.5 px-2 font-mono text-text-secondary whitespace-nowrap">{r.code ?? '—'}</td>
                <td className="py-1.5 px-2">
                  <div className="font-semibold text-text-primary">{r.name || r.work_type_code}</div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider">{r.equipment_type}</div>
                </td>
                <td className="py-1.5 px-2">
                  <input
                    type="text" value={r.unit ?? ''}
                    onChange={e => update(i, { unit: e.target.value })}
                    className="w-14 text-[12px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-red"
                  />
                </td>
                <td className="py-1.5 px-2 text-right">
                  <input
                    type="number" step="0.1" value={r.norm}
                    onChange={e => update(i, { norm: Number(e.target.value) })}
                    className="w-24 text-right font-mono text-[12px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-red"
                  />
                </td>
                <td className="py-1.5 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={r.productivity_enabled !== false}
                    onChange={e => update(i, { productivity_enabled: e.target.checked })}
                    className="h-4 w-4 accent-red-700"
                    title="Если выключено, факт этой работы не попадет в расчет производительности техники"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <SaveButton onClick={() => onSave(draft)} disabled={!dirty} loading={saving} />
      </div>
    </div>
  )
}

function SandSectionTable({ rows, title, onSave, saving }: {
  rows: SandSectionNorm[]
  title: string
  onSave: (rows: SandSectionNorm[]) => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<SandSectionNorm[]>(rows)
  useEffect(() => { setDraft(rows) }, [rows])
  const dirty = JSON.stringify(draft) !== JSON.stringify(rows)

  function update(i: number, patch: Partial<SandSectionNorm>) {
    setDraft(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-text-muted">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-surface">
            <tr className="text-text-muted uppercase tracking-wider text-[10px] border-b border-border">
              <th className="text-left py-2 px-2 font-semibold">Участок</th>
              <th className="text-right py-2 px-2 font-semibold">Рейсов / смена</th>
              <th className="text-right py-2 px-2 font-semibold">м³ / рейс</th>
              <th className="text-right py-2 px-2 font-semibold">Норма смены (м³)</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={r.section} className="border-b border-border/60">
                <td className="py-1.5 px-2 font-mono font-semibold">№{r.section}</td>
                <td className="py-1.5 px-2 text-right">
                  <input
                    type="number" step="1" value={r.trips}
                    onChange={e => update(i, { trips: Number(e.target.value) })}
                    className="w-20 text-right font-mono text-[12px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-red"
                  />
                </td>
                <td className="py-1.5 px-2 text-right">
                  <input
                    type="number" step="0.5" value={r.m3_per_trip}
                    onChange={e => update(i, { m3_per_trip: Number(e.target.value) })}
                    className="w-20 text-right font-mono text-[12px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-red"
                  />
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-text-muted">
                  {Math.round((r.trips || 0) * (r.m3_per_trip || 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <SaveButton onClick={() => onSave(draft)} disabled={!dirty} loading={saving} />
      </div>
    </div>
  )
}

function GenericTruckBlock({ value, onSave, saving }: {
  value: number
  onSave: (v: number) => void
  saving: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const dirty = draft !== value

  return (
    <div className="flex items-end gap-3">
      <div>
        <label className="block text-[11px] text-text-muted mb-1">Норма, м³ / смена / ед.</label>
        <input
          type="number" step="1" value={draft}
          onChange={e => setDraft(Number(e.target.value))}
          className="w-32 text-right font-mono text-[13px] border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent-red"
        />
      </div>
      <SaveButton onClick={() => onSave(draft)} disabled={!dirty} loading={saving} />
      <p className="text-[11px] text-text-muted flex-1">
        Применяется к «прочей перевозке»: торф, ЩПС/ЩПГС, щебень, перемещение накопитель↔накопитель и т. д.
      </p>
    </div>
  )
}

// ── Aliases block ─────────────────────────────────────────────────────────

function AliasesBlock() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ rows: AliasRow[] }>({
    queryKey: ['wip', 'settings', 'aliases'],
    queryFn: () => fetch('/api/wip/settings/aliases').then(r => r.json()),
    staleTime: 60_000,
  })

  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<AliasRow>>({})
  const [newRow, setNewRow] = useState<Partial<AliasRow>>({
    canonical_code: '', alias_text: '', kind: 'work_type', notes: '',
  })
  const [err, setErr] = useState<string | null>(null)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['wip', 'settings', 'aliases'] })
  }

  const createMut = useMutation({
    mutationFn: async (body: Partial<AliasRow>) => {
      const r = await fetch('/api/wip/settings/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: 'Ошибка' }))).detail || 'Ошибка')
      return r.json()
    },
    onSuccess: () => {
      setNewRow({ canonical_code: '', alias_text: '', kind: 'work_type', notes: '' })
      setErr(null)
      invalidate()
    },
    onError: (e: unknown) => setErr(errorMessage(e)),
  })

  const patchMut = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<AliasRow> }) => {
      const r = await fetch(`/api/wip/settings/aliases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: 'Ошибка' }))).detail || 'Ошибка')
      return r.json()
    },
    onSuccess: () => { setEditId(null); setEditDraft({}); invalidate() },
    onError: (e: unknown) => setErr(errorMessage(e)),
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/wip/settings/aliases/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Не удалось удалить')
      return r.json()
    },
    onSuccess: invalidate,
  })

  function startEdit(row: AliasRow) {
    setEditId(row.id)
    setEditDraft({ ...row })
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-[12px] text-accent-red bg-red-50 border border-red-200 rounded px-3 py-2">
          {err}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-surface">
            <tr className="text-text-muted uppercase tracking-wider text-[10px] border-b border-border">
              <th className="text-left py-2 px-2 font-semibold">Канонический код</th>
              <th className="text-left py-2 px-2 font-semibold">Алиас</th>
              <th className="text-left py-2 px-2 font-semibold">Тип</th>
              <th className="text-left py-2 px-2 font-semibold">Примечание</th>
              <th className="w-28"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="py-6 text-center text-text-muted">Загрузка…</td></tr>
            )}
            {!isLoading && (data?.rows ?? []).length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-text-muted">Алиасов пока нет.</td></tr>
            )}
            {(data?.rows ?? []).map((row, idx, arr) => {
              const isEd = editId === row.id
              // Визуальная группировка: показываем канонический код только у первой
              // записи в группе (одинаковый kind+canonical_code подряд благодаря
              // сортировке на бэкенде). Для остальных — левая рамка вместо кода.
              const prev = idx > 0 ? arr[idx - 1] : null
              const isGroupStart = !prev || prev.kind !== row.kind || prev.canonical_code !== row.canonical_code
              const next = idx < arr.length - 1 ? arr[idx + 1] : null
              const isGroupEnd = !next || next.kind !== row.kind || next.canonical_code !== row.canonical_code
              const hasDuplicates = !isGroupStart || (!!next && next.kind === row.kind && next.canonical_code === row.canonical_code)
              return (
                <tr
                  key={row.id}
                  className={`align-top ${isGroupEnd ? 'border-b border-border/60' : ''} ${hasDuplicates ? 'bg-amber-50/30' : ''}`}
                >
                  <td className={`py-1.5 px-2 font-mono ${!isGroupStart ? 'text-text-muted/60' : ''}`}>
                    {isEd ? (
                      <input
                        type="text" value={editDraft.canonical_code ?? ''}
                        onChange={e => setEditDraft(p => ({ ...p, canonical_code: e.target.value }))}
                        className="w-40 text-[12px] border border-border rounded px-1.5 py-0.5"
                      />
                    ) : (isGroupStart ? row.canonical_code : <span className="text-[11px]">↳</span>)}
                  </td>
                  <td className="py-1.5 px-2">
                    {isEd ? (
                      <input
                        type="text" value={editDraft.alias_text ?? ''}
                        onChange={e => setEditDraft(p => ({ ...p, alias_text: e.target.value }))}
                        className="w-56 text-[12px] border border-border rounded px-1.5 py-0.5"
                      />
                    ) : row.alias_text}
                  </td>
                  <td className="py-1.5 px-2">
                    {isEd ? (
                      <select
                        value={editDraft.kind ?? row.kind}
                        onChange={e => setEditDraft(p => ({ ...p, kind: e.target.value as AliasRow['kind'] }))}
                        className="text-[12px] border border-border rounded px-1 py-0.5"
                      >
                        {ALIAS_KINDS.map(k => <option key={k} value={k}>{ALIAS_KIND_LABELS[k]}</option>)}
                      </select>
                    ) : ALIAS_KIND_LABELS[row.kind]}
                  </td>
                  <td className="py-1.5 px-2 text-text-secondary">
                    {isEd ? (
                      <input
                        type="text" value={editDraft.notes ?? ''}
                        onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))}
                        className="w-full text-[12px] border border-border rounded px-1.5 py-0.5"
                      />
                    ) : (row.notes || '—')}
                  </td>
                  <td className="py-1.5 px-2 text-right whitespace-nowrap">
                    {isEd ? (
                      <>
                        <button
                          onClick={() => patchMut.mutate({ id: row.id, body: editDraft })}
                          className="p-1 text-[#16a34a] hover:bg-green-50 rounded"
                          title="Сохранить"
                        ><Check className="w-4 h-4" /></button>
                        <button
                          onClick={() => { setEditId(null); setEditDraft({}) }}
                          className="p-1 text-text-muted hover:bg-bg-surface rounded"
                          title="Отмена"
                        ><X className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(row)}
                          className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-surface rounded"
                          title="Редактировать"
                        ><Pencil className="w-4 h-4" /></button>
                        <button
                          onClick={() => { if (confirm(`Удалить алиас «${row.alias_text}»?`)) deleteMut.mutate(row.id) }}
                          className="p-1 text-accent-red hover:bg-red-50 rounded"
                          title="Удалить"
                        ><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border border-dashed border-border rounded-lg p-3 bg-bg-surface/30">
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          Добавить алиас
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] text-text-muted">Канонический код</label>
            <input
              type="text" placeholder="напр. UNPRF_SOIL"
              value={newRow.canonical_code ?? ''}
              onChange={e => setNewRow(p => ({ ...p, canonical_code: e.target.value }))}
              className="w-44 text-[12px] border border-border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-[10px] text-text-muted">Алиас (как пишет пользователь)</label>
            <input
              type="text" placeholder="напр. торф"
              value={newRow.alias_text ?? ''}
              onChange={e => setNewRow(p => ({ ...p, alias_text: e.target.value }))}
              className="w-56 text-[12px] border border-border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-[10px] text-text-muted">Тип</label>
            <select
              value={newRow.kind ?? 'work_type'}
              onChange={e => setNewRow(p => ({ ...p, kind: e.target.value as AliasRow['kind'] }))}
              className="text-[12px] border border-border rounded px-2 py-1"
            >
              {ALIAS_KINDS.map(k => <option key={k} value={k}>{ALIAS_KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] text-text-muted">Примечание</label>
            <input
              type="text" placeholder="необязательно"
              value={newRow.notes ?? ''}
              onChange={e => setNewRow(p => ({ ...p, notes: e.target.value }))}
              className="w-full text-[12px] border border-border rounded px-2 py-1"
            />
          </div>
          <button
            type="button"
            disabled={!newRow.canonical_code || !newRow.alias_text || createMut.isPending}
            onClick={() => createMut.mutate(newRow)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-accent-red text-white hover:bg-accent-burg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data: norms, isLoading } = useQuery<NormsData>({
    queryKey: ['wip', 'settings', 'norms'],
    queryFn: () => fetch('/api/wip/settings/norms').then(r => r.json()),
    staleTime: 60_000,
  })

  function invalidateNorms() {
    qc.invalidateQueries({ queryKey: ['wip', 'settings', 'norms'] })
    // Нормы используются в /equipment-productivity и /mechanization — инвалидируем и их.
    qc.invalidateQueries({ queryKey: ['wip', 'mechanization'] })
    qc.invalidateQueries({ queryKey: ['wip', 'equipment-productivity'] })
  }

  const patchMut = useMutation({
    mutationFn: async (body: Partial<{ work_types: WorkTypeNorm[]; sand_pit: SandSectionNorm[]; sand_stockpile: SandSectionNorm[]; generic: GenericNorm }>) => {
      const r = await fetch('/api/wip/settings/norms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Ошибка сохранения')
      return r.json()
    },
    onSuccess: invalidateNorms,
  })

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <SettingsIcon className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary">Настройки</h1>
      </div>

      <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
        {isLoading || !norms ? (
          <div className="h-40 bg-white border border-border rounded-xl animate-pulse" />
        ) : (
          <>
            <Section
              title="Справочник нормативов производительности"
              subtitle="Нормы смен per-единица техники. Применяются немедленно на следующем запросе."
            >
              <div className="space-y-6">
                <div>
                  <div className="text-[12px] font-semibold text-text-primary mb-2">
                    Экскаваторы / бульдозеры / автогрейдер / каток — по видам работ
                  </div>
                  <WorkTypesTable
                    key={norms.work_types.map(r => `${r.equipment_type}:${r.work_type_code}:${r.norm}:${r.unit ?? ''}:${r.productivity_enabled}`).join('|')}
                    rows={norms.work_types}
                    saving={patchMut.isPending}
                    onSave={rows => patchMut.mutate({ work_types: rows })}
                  />
                </div>

                <div>
                  <div className="text-[12px] font-semibold text-text-primary mb-2">
                    Самосвалы: карьер → накопитель / конструктив (песок)
                  </div>
                  <SandSectionTable
                    rows={norms.sand_pit}
                    title="Для участков, где ЖДС возит с карьера напрямую. Уч. №6 — наёмники, норма не задана."
                    saving={patchMut.isPending}
                    onSave={rows => patchMut.mutate({ sand_pit: rows })}
                  />
                </div>

                <div>
                  <div className="text-[12px] font-semibold text-text-primary mb-2">
                    Самосвалы: накопитель → конструктив (песок)
                  </div>
                  <SandSectionTable
                    rows={norms.sand_stockpile}
                    title="Нормы смен per участок."
                    saving={patchMut.isPending}
                    onSave={rows => patchMut.mutate({ sand_stockpile: rows })}
                  />
                </div>

                <div>
                  <div className="text-[12px] font-semibold text-text-primary mb-2">
                    Универсальная норма «прочей перевозки»
                  </div>
                  <GenericTruckBlock
                    value={norms.generic.norm_m3_per_shift}
                    saving={patchMut.isPending}
                    onSave={v => patchMut.mutate({ generic: { norm_m3_per_shift: v } })}
                  />
                </div>
              </div>
            </Section>

            <Section
              title="Словарь алиасов работ и материалов"
              subtitle="Соответствие терминов из отчётов пользователя и канонических кодов в БД. Применение в парсере — следующая итерация."
            >
              <AliasesBlock />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
