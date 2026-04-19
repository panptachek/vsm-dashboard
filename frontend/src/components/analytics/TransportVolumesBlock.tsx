import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { sectionNumberToCodes } from '../../lib/sections'

interface QuarryItem {
  name: string
  material: string
  distance_km: number
  sections: string[]
  today_volume: number
  trucks_plan: number
  trucks_fact: number
}

interface QuarriesResponse {
  quarries: QuarryItem[]
}

interface StorageItem {
  code: string
  name: string
  current_volume: number
  today_in: number
  today_out: number
  today_balance: number
}

interface StoragesResponse {
  storages: StorageItem[]
}

interface TransportVolumesBlockProps {
  selectedSections: Set<number>
  date: string
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

export function TransportVolumesBlock({ selectedSections, date }: TransportVolumesBlockProps) {

  const { data: quarriesData } = useQuery({
    queryKey: ['analytics-quarries', date],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/quarries?date=${date}`)
      if (!res.ok) return null
      return await res.json() as QuarriesResponse
    },
  })

  const { data: storagesData } = useQuery({
    queryKey: ['analytics-storages', date],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/analytics/storages?date=${date}`)
      if (!res.ok) return null
      return await res.json() as StoragesResponse
    },
  })

  // Filter quarries by selected sections
  const quarries = useMemo(() => {
    if (!quarriesData?.quarries) return []
    if (selectedSections.size === 0) return quarriesData.quarries
    const codes = new Set<string>()
    selectedSections.forEach((n) => {
      for (const c of sectionNumberToCodes(n)) codes.add(c)
    })
    return quarriesData.quarries.filter((q) =>
      q.sections.some((s) => codes.has(s))
    )
  }, [quarriesData, selectedSections])

  const storages = useMemo(() => {
    return storagesData?.storages ?? []
  }, [storagesData])

  const totalQuarryVolume = quarries.reduce((acc, q) => acc + q.today_volume, 0)
  const totalStorageIn = storages.reduce((acc, s) => acc + s.today_in, 0)
  const totalStorageOut = storages.reduce((acc, s) => acc + s.today_out, 0)

  return (
    <section className="mb-8">
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-4">
        Объёмы перевозок
      </h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Quarries compact table */}
        {quarries.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-border bg-bg-surface">
              <h3 className="text-sm font-heading font-semibold text-text-primary">
                Карьеры
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-text-muted">
                    <th className="text-left px-3 py-2">Карьер</th>
                    <th className="px-3 py-2 text-center">Материал</th>
                    <th className="px-3 py-2 text-right">Объём, м3</th>
                    <th className="px-3 py-2 text-center">Участки</th>
                  </tr>
                </thead>
                <tbody>
                  {quarries.map((q) => (
                    <tr key={q.name} className="border-b border-border/30">
                      <td className="px-3 py-2 font-medium text-text-primary whitespace-nowrap">{q.name}</td>
                      <td className="px-3 py-2 text-center text-text-muted">{q.material}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-text-primary">
                        {fmt(q.today_volume)}
                      </td>
                      <td className="px-3 py-2 text-center text-text-muted">
                        {q.sections.map((s) => {
                          const m = s.match(/UCH_(\d+)/)
                          return m ? m[1].replace(/^3[12]$/, '3') : s
                        }).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-bg-surface font-semibold">
                    <td className="px-3 py-2 text-text-primary" colSpan={2}>Итого</td>
                    <td className="px-3 py-2 text-right font-mono text-text-primary">
                      {fmt(totalQuarryVolume)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Storages compact table */}
        {storages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-border bg-bg-surface">
              <h3 className="text-sm font-heading font-semibold text-text-primary">
                Накопители
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 text-text-muted">
                    <th className="text-left px-3 py-2">Накопитель</th>
                    <th className="px-3 py-2 text-right">Остаток, м3</th>
                    <th className="px-3 py-2 text-right">Завоз</th>
                    <th className="px-3 py-2 text-right">Вывоз</th>
                    <th className="px-3 py-2 text-right">Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {storages.map((s) => (
                    <tr key={s.code} className="border-b border-border/30">
                      <td className="px-3 py-2 font-medium text-text-primary whitespace-nowrap truncate max-w-[180px]">
                        {s.name}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-primary">
                        {fmt(s.current_volume)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#22c55e]">
                        +{fmt(s.today_in)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#ef4444]">
                        -{fmt(s.today_out)}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono font-semibold"
                        style={{ color: s.today_balance >= 0 ? '#22c55e' : '#ef4444' }}
                      >
                        {s.today_balance >= 0 ? '+' : ''}{fmt(s.today_balance)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-bg-surface font-semibold">
                    <td className="px-3 py-2 text-text-primary">Итого</td>
                    <td className="px-3 py-2 text-right font-mono text-text-primary">
                      {fmt(storages.reduce((a, s) => a + s.current_volume, 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[#22c55e]">
                      +{fmt(totalStorageIn)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[#ef4444]">
                      -{fmt(totalStorageOut)}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-mono font-semibold"
                      style={{ color: (totalStorageIn - totalStorageOut) >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {(totalStorageIn - totalStorageOut) >= 0 ? '+' : ''}
                      {fmt(totalStorageIn - totalStorageOut)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  )
}
