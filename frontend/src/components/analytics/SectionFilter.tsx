import { Calendar, FileText } from 'lucide-react'

const SECTION_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const

interface SectionFilterProps {
  selectedSections: Set<number>
  onSectionToggle: (n: number | 'all') => void
  date: string
  onDateChange: (d: string) => void
  onExportPdf: () => void
}

export function SectionFilter({
  selectedSections,
  onSectionToggle,
  date,
  onDateChange,
  onExportPdf,
}: SectionFilterProps) {
  const allSelected = selectedSections.size === 0

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-border px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Section toggles */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted mr-1 font-medium">Участок:</span>
          <button
            onClick={() => onSectionToggle('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              allSelected
                ? 'bg-accent-red text-white shadow-sm'
                : 'bg-bg-surface text-text-muted hover:bg-border'
            }`}
          >
            Все
          </button>
          {SECTION_NUMBERS.map((n) => {
            const active = selectedSections.has(n)
            return (
              <button
                key={n}
                onClick={() => onSectionToggle(n)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  active
                    ? 'bg-accent-red text-white shadow-sm'
                    : 'bg-bg-surface text-text-muted hover:bg-border'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>

        <div className="w-px h-6 bg-border hidden sm:block" />

        {/* Date picker */}
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-text-muted" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="px-2.5 py-1 rounded-md text-xs font-mono border border-border
                       bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-burg"
          />
        </div>

        {/* PDF Export */}
        <div className="ml-auto">
          <button
            onClick={onExportPdf}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-all
                       bg-bg-surface text-text-muted hover:bg-border flex items-center gap-1.5"
            title="Экспорт в PDF"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>
    </div>
  )
}
