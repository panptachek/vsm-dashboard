/**
 * Блок «Свайные работы»: поля (main/test) × участок × тип сваи,
 * +колонка испытаний.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Anchor } from 'lucide-react'

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

function sectionLabel(code: string): string {
  if (code === 'UCH_31' || code === 'UCH_32') return 'Участок №3'
  const m = code.match(/UCH_(\d)/)
  return m ? `Участок №${m[1]}` : code
}

export function PilesBlock({
  from, to,
}: { from: string; to: string; view: 'table'|'cards'|'timeline' }) {
  const { data, isLoading } = useQuery<{ rows: PileRow[] }>({
    queryKey: ['wip', 'piles', from, to],
    queryFn: () => fetch(`/api/wip/piles`).then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  const { bySection, totals } = useMemo(() => {
    const rows = data?.rows ?? []
    const bySection: Record<string, { main: number; test: number; tests: number; byType: Record<string, number> }> = {}
    let tMain = 0, tTest = 0, tTests = 0
    for (const r of rows) {
      const sec = sectionLabel(r.section_code)
      bySection[sec] ??= { main: 0, test: 0, tests: 0, byType: {} }
      const cnt = r.pile_count ?? 0
      if (r.field_type === 'test') { bySection[sec].test += cnt; tTest += cnt }
      else                          { bySection[sec].main += cnt; tMain += cnt }
      const t = r.pile_type ?? '—'
      bySection[sec].byType[t] = (bySection[sec].byType[t] || 0) + cnt
      bySection[sec].tests += r.dynamic_test_count ?? 0
      tTests += r.dynamic_test_count ?? 0
    }
    return { bySection, totals: { main: tMain, test: tTest, tests: tTests } }
  }, [data])

  if (isLoading || !data) {
    return <div className="bg-bg-card border border-border rounded-xl p-5 h-40 animate-pulse" />
  }

  const sections = Object.keys(bySection).sort()

  return (
    <section className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Anchor className="w-5 h-5 text-accent-red" />
        <h2 className="font-heading font-bold text-lg">Свайные работы</h2>
        <div className="ml-auto flex gap-5 text-xs font-mono text-text-muted">
          <span>Основных: <b className="text-text-primary">{totals.main.toLocaleString('ru-RU')}</b></span>
          <span>Пробных: <b className="text-text-primary">{totals.test.toLocaleString('ru-RU')}</b></span>
          <span>Испытаний: <b className="text-text-primary">{totals.tests.toLocaleString('ru-RU')}</b></span>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-text-muted uppercase tracking-wider">
            <th className="text-left py-2 px-2 font-semibold">Участок</th>
            <th className="text-right py-2 px-2 font-semibold">Основные сваи</th>
            <th className="text-right py-2 px-2 font-semibold">Пробные сваи</th>
            <th className="text-right py-2 px-2 font-semibold">Дин. испытания</th>
            <th className="text-left py-2 px-2 font-semibold">Длины свай</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(sec => {
            const d = bySection[sec]
            return (
              <tr key={sec} className="border-b border-border/60 hover:bg-bg-surface/40">
                <td className="py-2 px-2 font-medium">{sec}</td>
                <td className="py-2 px-2 text-right font-mono">{d.main.toLocaleString('ru-RU')}</td>
                <td className="py-2 px-2 text-right font-mono">{d.test.toLocaleString('ru-RU')}</td>
                <td className="py-2 px-2 text-right font-mono">{d.tests.toLocaleString('ru-RU')}</td>
                <td className="py-2 px-2 text-text-secondary">
                  {Object.entries(d.byType).sort((a,b) => b[1]-a[1]).slice(0,3)
                    .map(([t,c]) => `${t}: ${c}`).join(' · ')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
