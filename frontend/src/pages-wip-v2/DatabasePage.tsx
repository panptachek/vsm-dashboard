import { useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Database, KeyRound, Link2, RefreshCw, Save, X } from 'lucide-react'

type DbValue = string | number | boolean | null | Record<string, unknown> | unknown[]
type DbRow = Record<string, DbValue>

interface DbTable {
  name: string
  label: string
  rows: number
  editable: boolean
}

interface DbColumn {
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
}

interface DbRelation {
  constraint_name: string
  source_table: string
  source_column: string
  target_table: string
  target_column: string
  on_delete: string
}

interface DbSchema {
  table: string
  label: string
  primary_key: string[]
  columns: DbColumn[]
  foreign_keys: DbRelation[]
  incoming_refs: DbRelation[]
  indexes: { indexname: string; indexdef: string }[]
}

interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  diff: { column: string; before: DbValue; after: DbValue }[]
  before?: DbRow | null
  after?: DbRow | null
}

interface Suggestion {
  value: string
  label: string | null
  count: number
}

interface EditState {
  row: DbRow
  column: DbColumn
  rawValue: string
  validation?: ValidationResult
  error?: string
}

const PROTECTED_COLUMNS = new Set(['created_at', 'updated_at', 'approved_at'])

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(data.detail || res.statusText)
  }
  return res.json()
}

function stringifyCell(value: DbValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function displayCell(value: DbValue): string {
  const text = stringifyCell(value)
  return text.length > 90 ? `${text.slice(0, 90)}...` : text || '—'
}

function coerceValue(column: DbColumn, value: string): DbValue {
  if (value.trim() === '') return null
  const type = `${column.data_type} ${column.udt_name}`.toLowerCase()
  if (type.includes('bool')) return ['true', '1', 'yes', 'да'].includes(value.trim().toLowerCase())
  if (type.includes('int') || type.includes('numeric') || type.includes('double') || type.includes('real')) {
    const num = Number(value.replace(',', '.'))
    return Number.isFinite(num) ? num : value
  }
  if (type.includes('json')) return JSON.parse(value)
  return value
}

function Section(props: { title: string; icon?: ComponentType<{ className?: string }>; children: ReactNode; right?: ReactNode }) {
  const Icon = props.icon
  return (
    <section className="bg-white border border-border rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        {Icon && <Icon className="w-4 h-4 text-accent-red" />}
        <h2 className="text-[15px] font-heading font-bold text-text-primary flex-1">{props.title}</h2>
        {props.right}
      </div>
      <div className="p-4">{props.children}</div>
    </section>
  )
}

export default function DatabasePage() {
  const qc = useQueryClient()
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [edit, setEdit] = useState<EditState | null>(null)

  const tablesQuery = useQuery({
    queryKey: ['db-admin-tables'],
    queryFn: () => apiJson<{ tables: DbTable[] }>('/api/db-admin/tables'),
  })

  const activeTable = selectedTable || tablesQuery.data?.tables[0]?.name || ''

  const schemaQuery = useQuery({
    queryKey: ['db-admin-schema', activeTable],
    queryFn: () => apiJson<DbSchema>(`/api/db-admin/tables/${activeTable}/schema`),
    enabled: Boolean(activeTable),
  })

  const rowsQuery = useQuery({
    queryKey: ['db-admin-rows', activeTable],
    queryFn: () => apiJson<{ rows: DbRow[]; limit: number; offset: number }>(`/api/db-admin/tables/${activeTable}/rows?limit=150`),
    enabled: Boolean(activeTable),
  })

  const validateMutation = useMutation({
    mutationFn: async (state: EditState) => {
      const schema = schemaQuery.data
      if (!schema) throw new Error('Схема не загружена')
      const value = coerceValue(state.column, state.rawValue)
      const pk = Object.fromEntries(schema.primary_key.map(col => [col, state.row[col]]))
      return apiJson<ValidationResult>(`/api/db-admin/tables/${activeTable}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', pk, values: { [state.column.column_name]: value } }),
      })
    },
    onSuccess: data => setEdit(prev => prev ? { ...prev, validation: data, error: undefined } : prev),
    onError: error => setEdit(prev => prev ? { ...prev, error: (error as Error).message } : prev),
  })

  const applyMutation = useMutation({
    mutationFn: async (state: EditState) => {
      const schema = schemaQuery.data
      if (!schema) throw new Error('Схема не загружена')
      const value = coerceValue(state.column, state.rawValue)
      const pk = Object.fromEntries(schema.primary_key.map(col => [col, state.row[col]]))
      return apiJson<ValidationResult>(`/api/db-admin/tables/${activeTable}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          pk,
          values: { [state.column.column_name]: value },
          confirmed: true,
          changed_by: 'dashboard',
        }),
      })
    },
    onSuccess: () => {
      setEdit(null)
      qc.invalidateQueries({ queryKey: ['db-admin-rows', activeTable] })
      qc.invalidateQueries({ queryKey: ['db-admin-tables'] })
    },
    onError: error => setEdit(prev => prev ? { ...prev, error: (error as Error).message } : prev),
  })

  const schema = schemaQuery.data
  const rows = rowsQuery.data?.rows ?? []
  const selected = tablesQuery.data?.tables.find(t => t.name === activeTable)
  const tableEditable = Boolean(selected?.editable)
  const sectionScope = typeof edit?.row.section_id === 'string' ? edit.row.section_id : ''

  const suggestionsQuery = useQuery({
    queryKey: ['db-admin-suggestions', activeTable, edit?.column.column_name, sectionScope],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '30' })
      if (sectionScope) params.set('section_id', sectionScope)
      return apiJson<{ suggestions: Suggestion[] }>(
        `/api/db-admin/tables/${activeTable}/columns/${edit?.column.column_name}/suggestions?${params.toString()}`,
      )
    },
    enabled: Boolean(edit && activeTable),
    staleTime: 30_000,
  })

  const editableColumns = useMemo(() => {
    if (!schema || !tableEditable) return new Set<string>()
    return new Set(
      schema.columns
        .filter(col => !schema.primary_key.includes(col.column_name) && !PROTECTED_COLUMNS.has(col.column_name))
        .map(col => col.column_name),
    )
  }, [schema, tableEditable])

  function beginEdit(row: DbRow, column: DbColumn) {
    if (!editableColumns.has(column.column_name)) return
    setEdit({ row, column, rawValue: stringifyCell(row[column.column_name]) })
  }

  return (
    <div className="p-4 md:p-6 pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <Database className="w-6 h-6 text-accent-red" />
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold text-text-primary">База данных</h1>
          <p className="text-sm text-text-muted mt-0.5">Ручные корректировки с предварительной проверкой</p>
        </div>
        <button
          type="button"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['db-admin-tables'] })
            qc.invalidateQueries({ queryKey: ['db-admin-schema', activeTable] })
            qc.invalidateQueries({ queryKey: ['db-admin-rows', activeTable] })
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-border bg-white hover:bg-bg-surface"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Обновить
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-5">
        <Section title="Таблицы" icon={Database}>
          {tablesQuery.isLoading && <div className="text-sm text-text-muted">Загрузка...</div>}
          {tablesQuery.isError && <div className="text-sm text-red-600">{(tablesQuery.error as Error).message}</div>}
          <div className="space-y-1">
            {tablesQuery.data?.tables.map(table => (
              <button
                key={table.name}
                type="button"
                onClick={() => {
                  setSelectedTable(table.name)
                  setEdit(null)
                }}
                className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                  activeTable === table.name
                    ? 'border-accent-red bg-red-50 text-text-primary'
                    : 'border-transparent hover:border-border hover:bg-bg-surface text-text-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-semibold flex-1">{table.label}</div>
                  {!table.editable && (
                    <span className="text-[9px] uppercase tracking-wide border border-border rounded px-1.5 py-0.5 text-text-muted">
                      просмотр
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-text-muted">{table.name} · {table.rows}</div>
              </button>
            ))}
          </div>
        </Section>

        <div className="space-y-5 min-w-0">
          <Section
            title={selected ? `${selected.label} · ${selected.name}` : 'Таблица'}
            icon={KeyRound}
            right={schema && (
              <div className="flex items-center gap-2">
                {!tableEditable && (
                  <span className="text-[10px] uppercase tracking-wide border border-border rounded px-1.5 py-0.5 text-text-muted">
                    только чтение
                  </span>
                )}
                <span className="text-[11px] font-mono text-text-muted">
                  PK: {schema.primary_key.join(', ') || '—'}
                </span>
              </div>
            )}
          >
            {schemaQuery.isLoading && <div className="text-sm text-text-muted">Загрузка схемы...</div>}
            {schemaQuery.isError && <div className="text-sm text-red-600">{(schemaQuery.error as Error).message}</div>}
            {schema && (
              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-bg-surface text-text-muted uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="text-left py-2 px-2 font-semibold">Колонка</th>
                        <th className="text-left py-2 px-2 font-semibold">Тип</th>
                        <th className="text-left py-2 px-2 font-semibold">Null</th>
                        <th className="text-left py-2 px-2 font-semibold">Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schema.columns.map(col => (
                        <tr key={col.column_name} className="border-b border-border/60">
                          <td className="py-1.5 px-2 font-mono text-text-primary">
                            {col.column_name}
                            {schema.primary_key.includes(col.column_name) && <span className="ml-1 text-accent-red">PK</span>}
                          </td>
                          <td className="py-1.5 px-2 text-text-secondary">{col.data_type}</td>
                          <td className="py-1.5 px-2 text-text-secondary">{col.is_nullable}</td>
                          <td className="py-1.5 px-2 text-text-muted font-mono max-w-[360px] break-words">{col.column_default || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3">
                  <RelationList title="Исходящие связи" relations={schema.foreign_keys} />
                  <RelationList title="Входящие связи" relations={schema.incoming_refs} />
                </div>
              </div>
            )}
          </Section>

          <Section title="Данные" icon={Database}>
            {rowsQuery.isLoading && <div className="text-sm text-text-muted">Загрузка строк...</div>}
            {rowsQuery.isError && <div className="text-sm text-red-600">{(rowsQuery.error as Error).message}</div>}
            {schema && (
              <div className="overflow-auto max-h-[68vh] border border-border rounded-lg">
                <table className="w-full text-[12px] font-mono">
                  <thead className="bg-bg-surface sticky top-0 z-10">
                    <tr className="text-text-muted text-left">
                      {schema.columns.map(col => (
                        <th key={col.column_name} className="px-2 py-2 font-semibold whitespace-nowrap border-b border-border">
                          {col.column_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr key={schema.primary_key.map(col => stringifyCell(row[col])).join('|') || rowIndex} className="border-b border-border/50 hover:bg-bg-surface/70">
                        {schema.columns.map(col => {
                          const editable = editableColumns.has(col.column_name)
                          return (
                            <td
                              key={col.column_name}
                              onDoubleClick={() => beginEdit(row, col)}
                              className={`px-2 py-1.5 align-top min-w-[120px] max-w-[260px] ${
                                editable ? 'cursor-text text-text-primary' : 'text-text-muted bg-neutral-50/60'
                              }`}
                              title={editable ? 'Двойной клик для редактирования' : undefined}
                            >
                              <span className="block break-words">{displayCell(row[col.column_name])}</span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="p-4 text-sm text-text-muted">Нет строк</div>}
              </div>
            )}
          </Section>
        </div>
      </div>

      {edit && (
        <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-border">
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
              <Save className="w-4 h-4 text-accent-red" />
              <div className="flex-1">
                <div className="text-sm font-heading font-bold text-text-primary">{activeTable}.{edit.column.column_name}</div>
                <div className="text-[11px] text-text-muted">{edit.column.data_type}</div>
              </div>
              <button type="button" onClick={() => setEdit(null)} className="p-1.5 rounded hover:bg-bg-surface">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {suggestionsQuery.data?.suggestions.length ? (
                <select
                  value=""
                  onChange={e => {
                    if (!e.target.value) return
                    setEdit(prev => prev ? {
                      ...prev,
                      rawValue: e.target.value,
                      validation: undefined,
                      error: undefined,
                    } : prev)
                  }}
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-accent-red"
                >
                  <option value="">Популярные значения{sectionScope ? ' по участку' : ''}</option>
                  {suggestionsQuery.data.suggestions.map(item => (
                    <option key={`${item.value}:${item.count}`} value={item.value}>
                      {(item.label || item.value) === item.value
                        ? `${item.value} · ${item.count}`
                        : `${item.label} · ${item.value} · ${item.count}`}
                    </option>
                  ))}
                </select>
              ) : null}
              <textarea
                value={edit.rawValue}
                onChange={e => setEdit(prev => prev ? { ...prev, rawValue: e.target.value, validation: undefined, error: undefined } : prev)}
                rows={6}
                className="w-full border border-border rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-red"
              />
              {edit.error && <Message tone="error" text={edit.error} />}
              {edit.validation?.errors.map(err => <Message key={err} tone="error" text={err} />)}
              {edit.validation?.warnings.map(warn => <Message key={warn} tone="warning" text={warn} />)}
              {edit.validation?.ok && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5" />
                  Проверка пройдена, изменение можно сохранить.
                </div>
              )}
              {edit.validation?.diff.length ? (
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-[12px] font-mono">
                    <tbody>
                      {edit.validation.diff.map(item => (
                        <tr key={item.column} className="border-b last:border-0 border-border">
                          <td className="px-2 py-1.5 text-text-muted">{item.column}</td>
                          <td className="px-2 py-1.5 text-red-700 bg-red-50">{displayCell(item.before)}</td>
                          <td className="px-2 py-1.5 text-green-700 bg-green-50">{displayCell(item.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => validateMutation.mutate(edit)}
                disabled={validateMutation.isPending || applyMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-border bg-white hover:bg-bg-surface disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Проверить
              </button>
              <button
                type="button"
                onClick={() => applyMutation.mutate(edit)}
                disabled={!edit.validation?.ok || validateMutation.isPending || applyMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-accent-red text-white hover:bg-accent-burg disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {applyMutation.isPending ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RelationList({ title, relations }: { title: string; relations: DbRelation[] }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-primary mb-2">
        <Link2 className="w-3.5 h-3.5 text-accent-red" />
        {title}
      </div>
      {relations.length === 0 ? (
        <div className="text-[11px] text-text-muted">—</div>
      ) : (
        <div className="space-y-1.5">
          {relations.map(rel => (
            <div key={`${rel.constraint_name}:${rel.source_column}:${rel.target_column}`} className="text-[11px] font-mono text-text-secondary">
              {rel.source_table}.{rel.source_column} → {rel.target_table}.{rel.target_column}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Message({ tone, text }: { tone: 'error' | 'warning'; text: string }) {
  const cls = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-800'
  return (
    <div className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${cls}`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
      {text}
    </div>
  )
}
