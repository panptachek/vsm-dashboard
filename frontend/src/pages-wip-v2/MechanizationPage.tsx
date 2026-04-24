/**
 * Страница «Производительность механизации».
 * Таблица всей техники, встречавшейся в суточных отчётах за выбранный период.
 * Колонки: Тип | Марка | Гос.номер | Бортовой № | Последний уч. | Смен | Факт | Норма | %
 * Клик по строке — разворачивает детали по дням.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck, ChevronRight } from 'lucide-react'
import { PeriodBar, usePeriod } from './PeriodBar'

interface ShiftDetail {
  date: string; shift: string; section: string
  work: string; fact: number; norm: number; percent: number | null
}
interface UnitRow {
  equipment_type: string
  brand_model: string
  plate_number: string
  unit_number: string
  ownership: string
  contractor: string
  last_section: string | null
  last_date: string | null
  shifts_worked: number
  fact_total: number
  expected_total: number
  fact_unit: string | null
  percent: number | null
  details: ShiftDetail[]
}

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))

function pctColor(p: number | null): string {
  if (p == null) return 'text-text-muted'
  if (p >= 95) return 'text-[#16a34a]'
  if (p >= 75) return 'text-[#f59e0b]'
  return 'text-accent-red'
}

export default function MechanizationPage() {
  const { from, to } = usePeriod()
  // all / ЖДС (own) / АЛМАЗ (contractor contains «алмаз») / наёмные (остальные).
  const [bucket, setBucket] = useState<'all'|'own'|'almaz'|'hired'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ count: number; units: UnitRow[] }>({
    queryKey: ['wip', 'mechanization', from, to],
    queryFn: () => fetch(`/api/wip/mechanization/units?from=${from}&to=${to}`).then(r => r.json()),
  })

  // Фильтр в UI — по контрактору: ЖДС / АЛМАЗ / наёмные.
  function unitBucket(u: UnitRow): 'own'|'almaz'|'hired' {
    if ((u.ownership || '').toLowerCase() === 'own') return 'own'
    if ((u.contractor || '').toLowerCase().includes('алмаз')) return 'almaz'
    return 'hired'
  }
  const filteredUnits = (data?.units ?? []).filter(u => bucket === 'all' || unitBucket(u) === bucket)

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <PeriodBar />

      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white flex-wrap">
        <Truck className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Производительность механизации
        </h1>
        <div className="no-print flex items-center gap-1 text-xs">
          {(['all','own','almaz','hired'] as const).map(o => (
            <button key={o}
              onClick={() => setBucket(o)}
              className={`px-2.5 py-1 rounded-md ${
                bucket === o ? 'bg-text-primary text-white' : 'bg-bg-surface text-text-muted hover:text-text-primary'
              }`}>
              {o === 'all' ? 'все' : o === 'own' ? 'ЖДС' : o === 'almaz' ? 'АЛМАЗ' : 'наёмные'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        <section className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading || !data ? (
            <div className="h-40 animate-pulse bg-bg-surface" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-bg-surface">
                  <tr className="text-text-muted uppercase tracking-wider text-[10px] border-b border-border">
                    <th className="w-6"></th>
                    <th className="text-left py-2 pl-2 pr-2 font-semibold">Тип</th>
                    <th className="text-left py-2 px-2 font-semibold">Марка</th>
                    <th className="text-left py-2 px-2 font-semibold">Гос.номер</th>
                    <th className="text-left py-2 px-2 font-semibold">Борт. №</th>
                    <th className="text-left py-2 px-2 font-semibold">Собственность</th>
                    <th className="text-center py-2 px-2 font-semibold">Посл. уч.</th>
                    <th className="text-right py-2 px-2 font-semibold">Смен</th>
                    <th className="text-right py-2 px-2 font-semibold">Факт</th>
                    <th className="text-right py-2 px-2 font-semibold">Норма</th>
                    <th className="text-right py-2 px-2 font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnits.length === 0 && (
                    <tr><td colSpan={11} className="py-8 text-center text-text-muted">Нет техники за выбранный период.</td></tr>
                  )}
                  {filteredUnits.map(u => {
                    const key = `${u.equipment_type}|${u.plate_number}|${u.unit_number}`
                    const isOpen = expanded === key
                    return (
                      <>
                        <tr key={key}
                            className="border-b border-border/60 hover:bg-bg-surface/40 cursor-pointer"
                            onClick={() => setExpanded(isOpen ? null : key)}>
                          <td className="text-center">
                            <ChevronRight className={`w-3.5 h-3.5 inline transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          </td>
                          <td className="py-2 pl-2 pr-2 font-semibold text-text-primary">{u.equipment_type}</td>
                          <td className="py-2 px-2 text-text-secondary">{u.brand_model}</td>
                          <td className="py-2 px-2 font-mono text-text-secondary">{u.plate_number}</td>
                          <td className="py-2 px-2 font-mono text-text-secondary">{u.unit_number}</td>
                          <td className="py-2 px-2 text-text-secondary text-[11px]">
                            {u.ownership === 'own' ? 'ЖДС' : u.ownership}
                            {u.contractor !== '—' && <span className="block text-[10px] text-text-muted">{u.contractor}</span>}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-text-primary">
                            {u.last_section?.replace('UCH_','№') ?? '—'}
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{u.shifts_worked}</td>
                          <td className="py-2 px-2 text-right font-mono">{fmt(u.fact_total)} {u.fact_unit ?? ''}</td>
                          <td className="py-2 px-2 text-right font-mono text-text-muted">{fmt(u.expected_total)}</td>
                          <td className={`py-2 px-2 text-right font-mono font-semibold ${pctColor(u.percent)}`}>
                            {u.percent == null ? '—' : `${Math.round(u.percent)}%`}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${key}-details`}>
                            <td colSpan={11} className="bg-bg-surface/30 px-6 py-3">
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className="text-text-muted uppercase tracking-wider text-[9px] border-b border-border">
                                    <th className="text-left py-1 pr-2">Дата</th>
                                    <th className="text-left py-1 px-2">См.</th>
                                    <th className="text-center py-1 px-2">Уч.</th>
                                    <th className="text-left py-1 px-2">Работа / направление</th>
                                    <th className="text-right py-1 px-2">Факт (доля)</th>
                                    <th className="text-right py-1 px-2">Норма</th>
                                    <th className="text-right py-1 px-2">%</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {u.details.length === 0 ? (
                                    <tr><td colSpan={7} className="py-2 text-text-muted">Нет фактов за дни работы этой единицы.</td></tr>
                                  ) : u.details.map((d, i) => (
                                    <tr key={i} className="border-b border-border/40">
                                      <td className="py-1 pr-2 font-mono text-text-secondary">{d.date}</td>
                                      <td className="py-1 px-2 text-text-secondary">{d.shift === 'day' ? 'Д' : 'Н'}</td>
                                      <td className="py-1 px-2 text-center font-mono">{d.section?.replace('UCH_','№') ?? '—'}</td>
                                      <td className="py-1 px-2 text-text-secondary">{d.work}</td>
                                      <td className="py-1 px-2 text-right font-mono">{fmt(d.fact)}</td>
                                      <td className="py-1 px-2 text-right font-mono text-text-muted">{fmt(d.norm)}</td>
                                      <td className={`py-1 px-2 text-right font-mono font-semibold ${pctColor(d.percent)}`}>
                                        {d.percent == null ? '—' : `${Math.round(d.percent)}%`}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-2 text-[10px] text-text-muted">
                                Факт делится поровну между одновременно работавшими единицами данного типа на смене
                                (прокси — пока не резолвятся через work_item_equipment_usage).
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="text-[11px] text-text-muted">
          Методика: самосвал — SAND (pit→stockpile/constructive) использует per-участок нормы,
          SAND (stockpile→constructive) — отдельные нормы per-участок, прочая перевозка — 166 м³/смена.
          Экск/бульд/автогр/каток — нормы по справочнику (RzrGrn004, SntPRS003, UsOsTN001 и т. д.).
        </div>
      </div>
    </div>
  )
}
