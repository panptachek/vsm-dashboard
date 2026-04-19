import { useCallback, useRef, useState } from 'react'
import { Calendar, FileText } from 'lucide-react'

export type PeriodPreset = 'today' | 'week' | 'month' | 'inception' | 'custom'

interface PeriodSelectorProps {
  from: string
  to: string
  preset: PeriodPreset
  onPeriodChange: (from: string, to: string, preset: PeriodPreset) => void
  onExportPdf: () => void
  pdfLoading?: boolean
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function weekAgoStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

function monthStartStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const INCEPTION_DATE = '2024-01-01'

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'inception', label: 'С начала строительства' },
  { key: 'custom', label: '\uD83D\uDCC5 Диапазон' },
]

export function PeriodSelector({
  from,
  to,
  preset,
  onPeriodChange,
  onExportPdf,
  pdfLoading,
}: PeriodSelectorProps) {
  const [showCustom, setShowCustom] = useState(preset === 'custom')
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)

  const handlePreset = useCallback(
    (key: PeriodPreset) => {
      if (key === 'custom') {
        setShowCustom(true)
        return
      }
      setShowCustom(false)
      let newFrom: string
      let newTo: string
      switch (key) {
        case 'today':
          newFrom = newTo = yesterdayStr()
          break
        case 'week':
          newFrom = weekAgoStr()
          newTo = yesterdayStr()
          break
        case 'month':
          newFrom = monthStartStr()
          newTo = yesterdayStr()
          break
        case 'inception':
          newFrom = INCEPTION_DATE
          newTo = yesterdayStr()
          break
        default:
          return
      }
      onPeriodChange(newFrom, newTo, key)
    },
    [onPeriodChange],
  )

  const handleCustomApply = useCallback(() => {
    const f = fromRef.current?.value
    const t = toRef.current?.value
    if (f && t) {
      onPeriodChange(f, t, 'custom')
    }
  }, [onPeriodChange])

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-border px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Period presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted mr-1 font-medium">Период:</span>
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                (key === 'custom' ? showCustom : preset === key)
                  ? 'bg-accent-red text-white shadow-sm'
                  : 'bg-bg-surface text-text-muted hover:bg-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {showCustom && (
          <>
            <div className="w-px h-6 bg-border hidden sm:block" />
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-text-muted" />
              <input
                ref={fromRef}
                type="date"
                defaultValue={from}
                className="px-2.5 py-1 rounded-md text-xs font-mono border border-border
                           bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-burg"
              />
              <span className="text-xs text-text-muted">&mdash;</span>
              <input
                ref={toRef}
                type="date"
                defaultValue={to}
                className="px-2.5 py-1 rounded-md text-xs font-mono border border-border
                           bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-burg"
              />
              <button
                onClick={handleCustomApply}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-accent-red text-white
                           hover:bg-accent-dark transition-all"
              >
                Применить
              </button>
            </div>
          </>
        )}

        {/* PDF Export */}
        <div className="ml-auto">
          <button
            onClick={onExportPdf}
            disabled={pdfLoading}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-all
                       bg-bg-surface text-text-muted hover:bg-border flex items-center gap-1.5
                       disabled:opacity-50 disabled:cursor-not-allowed"
            title="Экспорт в PDF"
          >
            <FileText className="w-3.5 h-3.5" />
            {pdfLoading ? 'Генерируем...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Current period display */}
      <div className="mt-1 text-[10px] text-text-muted font-mono">
        {new Date(from + 'T00:00:00').toLocaleDateString('ru-RU')} &mdash;{' '}
        {new Date(to + 'T00:00:00').toLocaleDateString('ru-RU')}
      </div>
    </div>
  )
}
