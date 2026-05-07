import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

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
    const ms = new Date(); const mStart = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}-01`
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
      const d = new Date(); const ms = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      setRange(ms, yd)
    } else if (p === 'inception') {
      setRange(INCEPTION, yd)
    }
  }, [setRange])

  return { from, to, preset, setPreset, setRange }
}
