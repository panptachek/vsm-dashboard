/**
 * Блок «Свайные работы»: 3 KPI карточки (основные/пробные/дин.исп)
 * + таблица по участкам (с начала / факт / план).
 * План = факт × 1.5 (демонстрационный множитель, см. футер).
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Columns3 } from 'lucide-react'
import { ACTIVE_SECTION_CODES, sectionCodeToNumber } from '../../lib/sections'

interface PileRow {
  id: string
  field_code: string | null
  field_type: 'main' | 'test' | string
  pile_type: string | null
  pile_count: number | null
  dynamic_test_count: number | null
  section_code: string
  pk_start: number | null
  pk_end: number | null
  is_demo?: boolean
}

const PLAN_MULT = 1.5

const nf = new Intl.NumberFormat('ru-RU')
const fmt = (n: number) => nf.format(Math.round(n))

interface SecStats {
  main: number
  test: number
  dyn: number
}

export function PilesBlock({
  from, to,
}: { from: string; to: string; view: 'table'|'cards'|'timeline' }) {
  const { data, isLoading } = useQuery<{
    rows: PileRow[]
    fact_by_section?: Record<string, { main: number; test: number; dyn: number }>
    fact_totals?: { main: number; test: number; dyn: number }
  }>({
    queryKey: ['wip', 'piles', from, to],
    queryFn: () => fetch(`/api/wip/piles?from=${from}&to=${to}`).then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  // План = SUM(pile_count) из pile_fields (статический каталог полей).
  // Факт = SUM(daily_work_items.volume) за период по work_types PILE_*.
  const { planBySec, planTotals, factBySec, factTotals } = useMemo(() => {
    const rows = data?.rows ?? []
    const planBySec: Record<string, SecStats> = {}
    const planTotals: SecStats = { main: 0, test: 0, dyn: 0 }
    for (const r of rows) {
      const sec = r.section_code
      planBySec[sec] ??= { main: 0, test: 0, dyn: 0 }
      const cnt = r.pile_count ?? 0
      if (r.field_type === 'test') {
        planBySec[sec].test += cnt
        planTotals.test += cnt
      } else {
        planBySec[sec].main += cnt
        planTotals.main += cnt
      }
      const dc = r.dynamic_test_count ?? 0
      planBySec[sec].dyn += dc
      planTotals.dyn += dc
    }
    const factBySec = data?.fact_by_section ?? {}
    const factTotals = data?.fact_totals ?? { main: 0, test: 0, dyn: 0 }
    return { planBySec, planTotals, factBySec, factTotals }
  }, [data])

  if (isLoading || !data) {
    return <div className="bg-white border border-border rounded-xl p-5 h-40 animate-pulse" />
  }

  // Группировка по номеру участка 1..8 (UCH_31+UCH_32 → №3)
  const sectionNums = [1, 2, 3, 4, 5, 6, 7, 8]
  const planByNum: Record<number, SecStats> = {}
  const factByNum: Record<number, SecStats> = {}
  for (const code of ACTIVE_SECTION_CODES) {
    const n = sectionCodeToNumber(code)
    planByNum[n] ??= { main: 0, test: 0, dyn: 0 }
    factByNum[n] ??= { main: 0, test: 0, dyn: 0 }
    const p = planBySec[code]; const f = factBySec[code]
    if (p) { planByNum[n].main += p.main; planByNum[n].test += p.test; planByNum[n].dyn += p.dyn }
    if (f) { factByNum[n].main += f.main; factByNum[n].test += f.test; factByNum[n].dyn += f.dyn }
  }

  return (
    <section className="bg-white border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Columns3 className="w-5 h-5 text-text-primary" strokeWidth={2} />
        <h2 className="font-heading font-bold text-[15px] tracking-wide uppercase text-text-primary">
          Свайные работы
        </h2>
        <span className="text-xs text-text-muted">
          факт за период · план с начала · прогресс
        </span>
      </div>

      {/* KPI cards: план = pile_fields catalog, факт = daily_work_items за период */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <KpiCard label="СВАИ ОСНОВНЫЕ" fact={factTotals.main} plan={planTotals.main} />
        <KpiCard label="СВАИ ПРОБНЫЕ" fact={factTotals.test} plan={planTotals.test} />
        <KpiCard label="ДИНАМ. ИСПЫТАНИЯ" fact={factTotals.dyn} plan={planTotals.dyn} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-text-muted uppercase tracking-wider text-[10px]">
              <th className="text-left py-2 pr-3 font-semibold">УЧ.</th>
              <th colSpan={3} className="text-center py-2 px-2 font-semibold border-l border-border/60">ОСНОВНЫЕ, ШТ</th>
              <th colSpan={3} className="text-center py-2 px-2 font-semibold border-l border-border/60">ПРОБНЫЕ, ШТ</th>
              <th colSpan={2} className="text-center py-2 px-2 font-semibold border-l border-border/60">ДИН. ИСП.</th>
            </tr>
            <tr className="text-text-muted uppercase tracking-wider text-[10px]">
              <th className="text-left py-1 pr-3 font-normal"></th>
              <th className="text-right py-1 px-2 font-normal border-l border-border/60">С НАЧАЛА</th>
              <th className="text-right py-1 px-2 font-normal">ФАКТ</th>
              <th className="text-right py-1 px-2 font-normal">ПЛАН</th>
              <th className="text-right py-1 px-2 font-normal border-l border-border/60">С НАЧАЛА</th>
              <th className="text-right py-1 px-2 font-normal">ФАКТ</th>
              <th className="text-right py-1 px-2 font-normal">ПЛАН</th>
              <th className="text-right py-1 px-2 font-normal border-l border-border/60">ФАКТ</th>
              <th className="text-right py-1 px-2 font-normal">ПЛАН</th>
            </tr>
          </thead>
          <tbody>
            {sectionNums.map(n => {
              const p = planByNum[n]
              const f = factByNum[n]
              return (
                <tr key={n} className="border-t border-border/60">
                  <td className="py-2 pr-3 font-semibold text-text-primary">№{n}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary border-l border-border/60">{fmt(f.main)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary">{fmt(f.main)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary">{fmt(p.main)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary border-l border-border/60">{fmt(f.test)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary">{fmt(f.test)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary">{fmt(p.test)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary border-l border-border/60">{fmt(f.dyn)}</td>
                  <td className="py-2 px-2 text-right font-mono text-text-secondary">{fmt(p.dyn)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-text-muted">
        План — SUM(pile_count) из <code className="font-mono bg-bg-surface px-1 rounded">pile_fields</code>.
        Факт — SUM(volume) из <code className="font-mono bg-bg-surface px-1 rounded">daily_work_items</code> за период по work_types PILE_MAIN/PILE_TRIAL/PILE_DYNTEST. Если факт = 0 — свайные работы ещё не размечены в суточных отчётах.
      </div>
    </section>
  )
}

function KpiCard({ label, fact, plan }: { label: string; fact: number; plan: number }) {
  const pct = plan > 0 ? Math.round((fact / plan) * 100) : 0
  return (
    <div className="border border-border rounded-lg p-4 bg-white">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
        {label}
      </div>
      <div className="font-heading font-bold text-[34px] leading-none tracking-tight text-text-primary">
        {fmt(fact)}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-text-muted">
        факт за период
      </div>
      <div className="mt-2 flex items-baseline gap-1 text-[12px] font-mono text-text-secondary">
        <span className="text-text-muted">план:</span>
        <span className="text-text-primary">{fmt(plan)}</span>
        <span className="text-text-muted mx-1">·</span>
        <span className="text-[#16a34a] font-semibold">{pct}%</span>
      </div>
      <div className="mt-2 h-1 w-full rounded-full bg-bg-surface overflow-hidden">
        <div className="h-full bg-[#16a34a]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}
