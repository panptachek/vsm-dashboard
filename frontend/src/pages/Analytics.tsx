import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PeriodSelector, type PeriodPreset } from '../components/analytics/PeriodSelector'
import { DailyVolumesBlock } from '../components/analytics/DailyVolumesBlock'
import { TempRoadsStatusBlock } from '../components/analytics/TempRoadsStatusBlock'
import { FillTableBlock } from '../components/analytics/FillTableBlock'
import { EquipmentProductivityBlock } from '../components/analytics/EquipmentProductivityBlock'
import { PeriodVolumesBlock } from '../components/analytics/PeriodVolumesBlock'

function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function detectPreset(from: string, to: string): PeriodPreset {
  const y = yesterday()
  if (from === to && from === y) return 'today'
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  if (from === weekAgo.toISOString().slice(0, 10) && to === y) return 'week'
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  if (from === monthStart && to === y) return 'month'
  if (from === '2024-01-01') return 'inception'
  return 'custom'
}

export function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pdfLoading, setPdfLoading] = useState(false)

  const fromParam = searchParams.get('from') ?? yesterday()
  const toParam = searchParams.get('to') ?? yesterday()
  const preset = detectPreset(fromParam, toParam)

  const handlePeriodChange = useCallback(
    (from: string, to: string, _preset: PeriodPreset) => {
      setSearchParams({ from, to })
    },
    [setSearchParams],
  )

  const exportPdf = useCallback(async () => {
    setPdfLoading(true)
    try {
      const res = await fetch('/api/pdf/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: toParam }),
      })
      if (!res.ok) {
        const text = await res.text()
        alert(`Ошибка генерации PDF: ${text}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `VSM_Аналитика_${toParam}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPdfLoading(false)
    }
  }, [toParam])

  return (
    <div className="flex flex-col min-h-full">
      {/* B0: Global period selector */}
      <PeriodSelector
        from={fromParam}
        to={toParam}
        preset={preset}
        onPeriodChange={handlePeriodChange}
        onExportPdf={exportPdf}
        pdfLoading={pdfLoading}
      />

      {/* Content */}
      <div id="analytics-content" className="p-4 sm:p-6 pb-24 lg:pb-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-heading font-bold text-text-primary">
            Аналитика
          </h1>
          <span className="text-xs font-mono text-text-muted">
            {new Date(fromParam + 'T00:00:00').toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
            {fromParam !== toParam && (
              <>
                {' \u2014 '}
                {new Date(toParam + 'T00:00:00').toLocaleDateString('ru-RU', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </>
            )}
          </span>
        </div>

        {/* B1: Основные объёмы за день */}
        <DailyVolumesBlock from={fromParam} to={toParam} />

        {/* B2: Отсыпка автодорог */}
        <TempRoadsStatusBlock from={fromParam} to={toParam} />

        {/* B3: Таблица отсыпки */}
        <FillTableBlock from={fromParam} to={toParam} />

        {/* B4: Выработка техники */}
        <EquipmentProductivityBlock from={fromParam} to={toParam} />

        {/* B5: Объёмы за неделю/месяц/накопительно */}
        <PeriodVolumesBlock from={fromParam} to={toParam} />
      </div>
    </div>
  )
}
