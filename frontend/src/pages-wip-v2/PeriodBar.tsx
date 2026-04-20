/**
 * Общий селектор периода для WIP v2.
 * Пресеты: день / неделя / месяц / с начала / диапазон.
 * Состояние — в URL (?from=YYYY-MM-DD&to=YYYY-MM-DD).
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Calendar } from 'lucide-react'

export type Preset = 'today' | 'week' | 'month' | 'inception' | 'custom'

const INCEPTION = '2024-01-01'

function isoYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function usePeriod(): {
  from: string
  to: string
  preset: Preset
  setPreset: (p: Preset) => void
  setRange: (from: string, to: string) => void
} {
  const [sp, setSp] = useSearchParams()
  const yd = isoYesterday()
  const from = sp.get('from') ?? yd
  const to = sp.get('to') ?? yd

  const preset: Preset = useMemo(() => {
    if (from === to && from === yd) return 'today'
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    if (from === weekAgo.toISOString().slice(0, 10) && to === yd) return 'week'
    const ms = new Date(); const mStart = `${ms.getFullYear()}-${String(ms.getMonth()+1).padStart(2,'0')}-01`
    if (from === mStart && to === yd) return 'month'
    if (from === INCEPTION && to === yd) return 'inception'
    return 'custom'
  }, [from, to, yd])

  const setRange = useCallback((f: string, t: string) => {
    setSp(prev => { const n = new URLSearchParams(prev); n.set('from', f); n.set('to', t); return n })
  }, [setSp])

  const setPreset = useCallback((p: Preset) => {
    const yd = isoYesterday()
    if (p === 'today') setRange(yd, yd)
    else if (p === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      setRange(d.toISOString().slice(0, 10), yd)
    } else if (p === 'month') {
      const d = new Date(); const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
      setRange(ms, yd)
    } else if (p === 'inception') {
      setRange(INCEPTION, yd)
    }
  }, [setRange])

  return { from, to, preset, setPreset, setRange }
}

export function PeriodBar() {
  const { from, to, preset, setPreset, setRange } = usePeriod()
  const chip = (p: Preset, label: string) => (
    <button
      key={p}
      onClick={() => setPreset(p)}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        preset === p
          ? 'bg-accent-burg text-white'
          : 'bg-bg-surface text-text-secondary hover:bg-neutral-200'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-border px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-text-muted mr-2">Период</span>
      {chip('today', 'Сегодня')}
      {chip('week', 'Неделя')}
      {chip('month', 'Месяц')}
      {chip('inception', 'С начала')}
      <div className="flex items-center gap-2 ml-auto">
        <Calendar className="w-4 h-4 text-text-muted" />
        <input type="date" value={from} onChange={e => setRange(e.target.value, to)}
          className="px-2 py-1 text-xs font-mono border border-border rounded-md bg-white" />
        <span className="text-text-muted text-xs">—</span>
        <input type="date" value={to} onChange={e => setRange(from, e.target.value)}
          className="px-2 py-1 text-xs font-mono border border-border rounded-md bg-white" />
      </div>
    </div>
  )
}
