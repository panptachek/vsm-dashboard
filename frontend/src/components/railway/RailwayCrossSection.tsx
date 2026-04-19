import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Structure {
  type: 'earthwork' | 'ballast' | 'sleepers' | 'rails' | 'catenary'
  name: string
  planned: number
  completed: number
  unit: string
  percent: number
}

export interface RailwayCrossSectionProps {
  structures: Structure[]
  animate?: boolean
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LAYER_ORDER: Structure['type'][] = [
  'earthwork',
  'ballast',
  'sleepers',
  'rails',
  'catenary',
]

const LAYER_LABELS: Record<Structure['type'], string> = {
  earthwork: 'Земляное полотно',
  ballast: 'Балласт',
  sleepers: 'Шпалы',
  rails: 'Рельсы',
  catenary: 'Контактная сеть',
}

/* ------------------------------------------------------------------ */
/*  SVG sub-components                                                 */
/* ------------------------------------------------------------------ */

function EarthworkLayer({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  // Trapezoid: wide base, narrower top
  const opacity = 0.3 + 0.7 * (pct / 100)
  return (
    <g opacity={opacity} filter={highlighted ? 'url(#glow)' : undefined}>
      <defs>
        <linearGradient id="earthwork-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B4513" />
          <stop offset="100%" stopColor="#654321" />
        </linearGradient>
      </defs>
      <polygon
        points="100,400 700,400 620,320 180,320"
        fill="url(#earthwork-grad)"
        stroke={highlighted ? '#dc2626' : '#5C3317'}
        strokeWidth={highlighted ? 2.5 : 1}
      />
      {/* Terrain texture lines */}
      {[340, 355, 370, 385].map((y) => (
        <line
          key={y}
          x1={140 + (400 - y) * 0.8}
          y1={y}
          x2={660 - (400 - y) * 0.8}
          y2={y}
          stroke="#5C3317"
          strokeWidth={0.5}
          opacity={0.4}
        />
      ))}
    </g>
  )
}

function BallastLayer({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  const opacity = 0.3 + 0.7 * (pct / 100)
  return (
    <g opacity={opacity} filter={highlighted ? 'url(#glow)' : undefined}>
      <defs>
        <linearGradient id="ballast-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B7280" />
          <stop offset="100%" stopColor="#4B5563" />
        </linearGradient>
      </defs>
      <polygon
        points="180,320 620,320 580,285 220,285"
        fill="url(#ballast-grad)"
        stroke={highlighted ? '#dc2626' : '#374151'}
        strokeWidth={highlighted ? 2.5 : 1}
      />
      {/* Gravel texture dots */}
      {Array.from({ length: 40 }).map((_, i) => {
        const x = 230 + (i % 10) * 35 + (i % 3) * 5
        const y = 290 + Math.floor(i / 10) * 7 + (i % 2) * 3
        return (
          <circle key={i} cx={x} cy={y} r={1.2} fill="#9CA3AF" opacity={0.35} />
        )
      })}
    </g>
  )
}

function SleepersLayer({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  const opacity = 0.3 + 0.7 * (pct / 100)
  const sleeperCount = 11
  const startX = 250
  const endX = 550
  const step = (endX - startX) / (sleeperCount - 1)

  return (
    <g opacity={opacity} filter={highlighted ? 'url(#glow)' : undefined}>
      {Array.from({ length: sleeperCount }).map((_, i) => {
        const cx = startX + i * step
        return (
          <rect
            key={i}
            x={cx - 6}
            y={270}
            width={12}
            height={15}
            rx={1}
            fill="#374151"
            stroke={highlighted ? '#dc2626' : '#1F2937'}
            strokeWidth={highlighted ? 1.5 : 0.5}
          />
        )
      })}
    </g>
  )
}

function RailsLayer({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  const opacity = 0.3 + 0.7 * (pct / 100)
  return (
    <g opacity={opacity} filter={highlighted ? 'url(#glow)' : undefined}>
      <defs>
        <linearGradient id="rail-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D1D5DB" />
          <stop offset="50%" stopColor="#9CA3AF" />
          <stop offset="100%" stopColor="#6B7280" />
        </linearGradient>
      </defs>
      {/* Left rail — R65 profile (simplified) */}
      <RailProfile cx={320} highlighted={highlighted} />
      {/* Right rail */}
      <RailProfile cx={480} highlighted={highlighted} />
    </g>
  )
}

function RailProfile({ cx, highlighted }: { cx: number; highlighted: boolean }) {
  // Simplified R65 cross-section: head, web, foot
  const hx = cx
  return (
    <g>
      {/* Foot (base) */}
      <rect
        x={hx - 14} y={274} width={28} height={4} rx={0.5}
        fill="url(#rail-grad)"
        stroke={highlighted ? '#dc2626' : '#6B7280'}
        strokeWidth={highlighted ? 1.5 : 0.4}
      />
      {/* Web */}
      <rect
        x={hx - 4} y={264} width={8} height={10} rx={0.5}
        fill="url(#rail-grad)"
        stroke={highlighted ? '#dc2626' : '#6B7280'}
        strokeWidth={highlighted ? 1.5 : 0.4}
      />
      {/* Head */}
      <rect
        x={hx - 10} y={259} width={20} height={5} rx={1.5}
        fill="url(#rail-grad)"
        stroke={highlighted ? '#dc2626' : '#6B7280'}
        strokeWidth={highlighted ? 1.5 : 0.4}
      />
      {/* Highlight shimmer on head */}
      <rect
        x={hx - 8} y={260} width={16} height={1.5} rx={0.75}
        fill="white" opacity={0.15}
      />
    </g>
  )
}

function CatenaryLayer({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  const opacity = 0.3 + 0.7 * (pct / 100)
  const wireColor = highlighted ? '#dc2626' : '#94A3B8'
  const sw = highlighted ? 2 : 1.2

  return (
    <g opacity={opacity}>
      {/* Mast left */}
      <rect x={200} y={80} width={4} height={180} fill="#64748B" rx={1} />
      {/* Mast right */}
      <rect x={596} y={80} width={4} height={180} fill="#64748B" rx={1} />
      {/* Cross arm */}
      <line x1={202} y1={90} x2={598} y2={90} stroke="#64748B" strokeWidth={2.5} />
      {/* Messenger wire (catenary curve) */}
      <path
        d="M 202,90 Q 400,75 598,90"
        fill="none"
        stroke={wireColor}
        strokeWidth={sw}
      />
      {/* Contact wire (straighter, lower) */}
      <path
        d="M 202,140 Q 400,135 598,140"
        fill="none"
        stroke={wireColor}
        strokeWidth={sw}
      />
      {/* Droppers connecting messenger to contact wire */}
      {[280, 340, 400, 460, 520].map((x) => {
        const messengerY = 90 - 15 * Math.sin(((x - 202) / 396) * Math.PI) + 15
        const contactY = 140 - 5 * Math.sin(((x - 202) / 396) * Math.PI) + 5
        return (
          <line
            key={x}
            x1={x} y1={messengerY}
            x2={x} y2={contactY}
            stroke={wireColor}
            strokeWidth={0.8}
          />
        )
      })}
      {/* Insulators on masts */}
      <circle cx={202} cy={90} r={4} fill="#475569" stroke={wireColor} strokeWidth={0.5} />
      <circle cx={598} cy={90} r={4} fill="#475569" stroke={wireColor} strokeWidth={0.5} />
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                            */
/* ------------------------------------------------------------------ */

interface TooltipState {
  x: number
  y: number
  structure: Structure
}

function Tooltip({ tooltip }: { tooltip: TooltipState }) {
  const { structure } = tooltip
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="absolute pointer-events-none z-50 bg-bg-card border border-border rounded-lg
                 px-3 py-2 shadow-xl text-xs"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="font-heading font-semibold text-text-primary mb-1">{structure.name}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-text-secondary">
        <span className="text-text-muted">План:</span>
        <span className="font-mono">{structure.planned.toLocaleString('ru-RU')} {structure.unit}</span>
        <span className="text-text-muted">Факт:</span>
        <span className="font-mono">{structure.completed.toLocaleString('ru-RU')} {structure.unit}</span>
        <span className="text-text-muted">Прогресс:</span>
        <span className="font-mono font-semibold" style={{ color: progressColor(structure.percent) }}>
          {structure.percent.toFixed(1)}%
        </span>
      </div>
    </motion.div>
  )
}

function progressColor(pct: number): string {
  if (pct >= 70) return '#22c55e'
  if (pct >= 30) return '#f59e0b'
  return '#ef4444'
}

/* ------------------------------------------------------------------ */
/*  Hit areas — invisible rects/polygons for mouse interaction         */
/* ------------------------------------------------------------------ */

function HitAreas({
  structures,
  onEnter,
  onLeave,
}: {
  structures: Structure[]
  onEnter: (type: Structure['type'], e: React.MouseEvent<SVGElement>) => void
  onLeave: () => void
}) {
  const structMap = Object.fromEntries(structures.map((s) => [s.type, s]))

  return (
    <g>
      {structMap['earthwork'] && (
        <polygon
          points="100,400 700,400 620,320 180,320"
          fill="transparent"
          cursor="pointer"
          onMouseEnter={(e) => onEnter('earthwork', e)}
          onMouseLeave={onLeave}
        />
      )}
      {structMap['ballast'] && (
        <polygon
          points="180,320 620,320 580,285 220,285"
          fill="transparent"
          cursor="pointer"
          onMouseEnter={(e) => onEnter('ballast', e)}
          onMouseLeave={onLeave}
        />
      )}
      {structMap['sleepers'] && (
        <rect
          x={240} y={268} width={320} height={20}
          fill="transparent"
          cursor="pointer"
          onMouseEnter={(e) => onEnter('sleepers', e)}
          onMouseLeave={onLeave}
        />
      )}
      {structMap['rails'] && (
        <rect
          x={300} y={258} width={200} height={22}
          fill="transparent"
          cursor="pointer"
          onMouseEnter={(e) => onEnter('rails', e)}
          onMouseLeave={onLeave}
        />
      )}
      {structMap['catenary'] && (
        <rect
          x={195} y={70} width={410} height={80}
          fill="transparent"
          cursor="pointer"
          onMouseEnter={(e) => onEnter('catenary', e)}
          onMouseLeave={onLeave}
        />
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

function Legend({ structures }: { structures: Structure[] }) {
  return (
    <div className="flex flex-wrap gap-3 mt-3">
      {LAYER_ORDER.map((type) => {
        const s = structures.find((st) => st.type === type)
        if (!s) return null
        return (
          <div key={type} className="flex items-center gap-1.5 text-[11px]">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: layerColor(type), opacity: 0.3 + 0.7 * (s.percent / 100) }}
            />
            <span className="text-text-muted">{LAYER_LABELS[type]}</span>
            <span className="font-mono font-semibold" style={{ color: progressColor(s.percent) }}>
              {s.percent.toFixed(0)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function layerColor(type: Structure['type']): string {
  switch (type) {
    case 'earthwork': return '#8B4513'
    case 'ballast': return '#6B7280'
    case 'sleepers': return '#374151'
    case 'rails': return '#9CA3AF'
    case 'catenary': return '#94A3B8'
  }
}

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

function getVariants(type: Structure['type'], constructionMode: boolean) {
  if (!constructionMode) {
    // Simple stagger fade-in from bottom
    const idx = LAYER_ORDER.indexOf(type)
    return {
      hidden: { opacity: 0, y: 30 },
      visible: {
        opacity: 1,
        y: 0,
        transition: { delay: idx * 0.15, duration: 0.5, ease: 'easeOut' as const },
      },
    }
  }

  // Construction animation — each layer enters differently
  const idx = LAYER_ORDER.indexOf(type)
  const baseDelay = idx * 0.6

  switch (type) {
    case 'earthwork':
      return {
        hidden: { scaleY: 0, originY: 1, opacity: 0 },
        visible: {
          scaleY: 1, opacity: 1,
          transition: { delay: baseDelay, duration: 0.8, ease: 'easeOut' as const },
        },
      }
    case 'ballast':
      return {
        hidden: { y: -60, opacity: 0 },
        visible: {
          y: 0, opacity: 1,
          transition: { delay: baseDelay, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] },
        },
      }
    case 'sleepers':
      return {
        hidden: { x: -80, opacity: 0 },
        visible: {
          x: 0, opacity: 1,
          transition: { delay: baseDelay, duration: 0.5, ease: 'easeOut' as const },
        },
      }
    case 'rails':
      return {
        hidden: { scaleX: 0, opacity: 0 },
        visible: {
          scaleX: 1, opacity: 1,
          transition: { delay: baseDelay, duration: 0.5, ease: 'easeOut' as const },
        },
      }
    case 'catenary':
      return {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { delay: baseDelay, duration: 0.8, ease: 'easeInOut' as const },
        },
      }
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function RailwayCrossSection({ structures, animate = false }: RailwayCrossSectionProps) {
  const [highlighted, setHighlighted] = useState<Structure['type'] | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [speed, setSpeed] = useState(1)
  const [constructionKey, setConstructionKey] = useState(0)

  const structMap = Object.fromEntries(structures.map((s) => [s.type, s])) as Record<
    Structure['type'],
    Structure | undefined
  >

  const handleEnter = useCallback(
    (type: Structure['type'], e: React.MouseEvent<SVGElement>) => {
      const s = structMap[type]
      if (!s) return
      const rect = (e.currentTarget as SVGElement).closest('.railway-svg-wrap')?.getBoundingClientRect()
      if (!rect) return
      setHighlighted(type)
      setTooltip({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top - 10,
        structure: s,
      })
    },
    [structMap],
  )

  const handleLeave = useCallback(() => {
    setHighlighted(null)
    setTooltip(null)
  }, [])

  const renderLayer = (type: Structure['type']) => {
    const s = structMap[type]
    if (!s) return null
    const pct = s.percent
    const isHigh = highlighted === type

    const variants = getVariants(type, animate)

    // Apply speed multiplier to transition delays/durations
    const adjustedVariants = {
      ...variants,
      visible: {
        ...variants.visible,
        transition: {
          ...((variants.visible as unknown as { transition: Record<string, unknown> }).transition),
          delay:
            (Number((variants.visible as unknown as { transition: Record<string, unknown> }).transition.delay) || 0) /
            speed,
          duration:
            (Number((variants.visible as unknown as { transition: Record<string, unknown> }).transition.duration) || 0.5) /
            speed,
        },
      },
    }

    let layerElement: React.ReactNode
    switch (type) {
      case 'earthwork':
        layerElement = <EarthworkLayer pct={pct} highlighted={isHigh} />
        break
      case 'ballast':
        layerElement = <BallastLayer pct={pct} highlighted={isHigh} />
        break
      case 'sleepers':
        layerElement = <SleepersLayer pct={pct} highlighted={isHigh} />
        break
      case 'rails':
        layerElement = <RailsLayer pct={pct} highlighted={isHigh} />
        break
      case 'catenary':
        layerElement = <CatenaryLayer pct={pct} highlighted={isHigh} />
        break
    }

    return (
      <motion.g
        key={type}
        variants={adjustedVariants}
        initial="hidden"
        animate="visible"
      >
        {layerElement}
      </motion.g>
    )
  }

  return (
    <div className="w-full">
      {/* Speed slider for construction mode */}
      {animate && (
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-text-muted">Скорость:</span>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-32 accent-accent-red"
          />
          <span className="text-xs font-mono text-text-secondary">{speed}x</span>
          <button
            onClick={() => setConstructionKey((k) => k + 1)}
            className="ml-2 text-xs px-2 py-1 rounded bg-bg-surface border border-border
                       text-text-muted hover:text-text-primary hover:border-accent-red/40 transition-all"
          >
            Повторить
          </button>
        </div>
      )}

      {/* SVG container */}
      <div className="relative railway-svg-wrap">
        <svg
          key={constructionKey}
          viewBox="0 60 800 360"
          className="w-full h-auto"
          style={{ maxHeight: 500 }}
        >
          <defs>
            {/* Glow filter for highlighted layers */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Ground line */}
          <line x1={0} y1={400} x2={800} y2={400} stroke="#e5e5e5" strokeWidth={1} />

          {/* Layers rendered bottom to top */}
          {LAYER_ORDER.map((type) => renderLayer(type))}

          {/* Dimension annotations */}
          <g className="text-[10px]" fill="#171717" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            {/* Track gauge */}
            <line x1={320} y1={252} x2={480} y2={252} stroke="#737373" strokeWidth={0.5} strokeDasharray="3,2" />
            <text x={395} y={249} textAnchor="middle" fontSize={9}>1520 мм</text>
            {/* Height marker */}
            <line x1={720} y1={260} x2={720} y2={400} stroke="#737373" strokeWidth={0.5} strokeDasharray="3,2" />
            <text x={735} y={335} textAnchor="start" fontSize={9} transform="rotate(-90 735 335)">ВСМ профиль</text>
          </g>

          {/* Interactive hit areas on top */}
          <HitAreas structures={structures} onEnter={handleEnter} onLeave={handleLeave} />
        </svg>

        {/* Tooltip overlay */}
        <AnimatePresence>
          {tooltip && <Tooltip key="tt" tooltip={tooltip} />}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <Legend structures={structures} />
    </div>
  )
}
