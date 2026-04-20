/**
 * Маркеры карты — SVG-обозначения по `Условные обозначения.html`.
 * Все иконки 24×24, viewBox 0 0 24 24. Цвет задаётся через props.
 */
// React is imported implicitly via JSX transform

export type MarkerKind =
  | 'borrow_pit'         // карьер (треугольник с точкой)
  | 'stockpile'          // накопитель (круг-кольцо)
  | 'bridge'             // мост (дуга)
  | 'isso'               // ИССО (квадрат с диагональю)
  | 'pile_field_main'    // осн. свайное поле (ромб заполненный)
  | 'pile_field_test'    // пробное свайное поле (ромб пустой)
  | 'base'               // база (дом)
  | 'km_post'            // км-знак (верста: прямоугольник с цифрой)

const COLORS: Record<MarkerKind, string> = {
  borrow_pit:       '#7f1d1d',
  stockpile:        '#525252',
  bridge:           '#1a1a1a',
  isso:             '#dc2626',
  pile_field_main:  '#1a1a1a',
  pile_field_test:  '#737373',
  base:             '#525252',
  km_post:          '#1a1a1a',
}

export function MarkerIcon({
  kind, size = 20, label, active = false,
}: { kind: MarkerKind; size?: number; label?: string; active?: boolean }) {
  const color = COLORS[kind]
  const ring = active ? '#dc2626' : 'transparent'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="overflow-visible">
      {active && <circle cx={12} cy={12} r={11} fill="none" stroke={ring} strokeWidth={2} />}
      {kind === 'borrow_pit' && (
        <g>
          <polygon points="12,3 21,20 3,20" fill={color} />
          <circle cx={12} cy={15} r={2} fill="white" />
        </g>
      )}
      {kind === 'stockpile' && (
        <g>
          <circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2.5} />
          <circle cx={12} cy={12} r={3} fill={color} />
        </g>
      )}
      {kind === 'bridge' && (
        <g>
          <path d="M 3 15 Q 12 4 21 15" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          <line x1={3} y1={18} x2={21} y2={18} stroke={color} strokeWidth={2} />
          <line x1={6} y1={15} x2={6} y2={18} stroke={color} strokeWidth={1.5} />
          <line x1={18} y1={15} x2={18} y2={18} stroke={color} strokeWidth={1.5} />
        </g>
      )}
      {kind === 'isso' && (
        <g>
          <rect x={4} y={4} width={16} height={16} fill="none" stroke={color} strokeWidth={2} />
          <line x1={4} y1={4} x2={20} y2={20} stroke={color} strokeWidth={2} />
          <line x1={20} y1={4} x2={4} y2={20} stroke={color} strokeWidth={2} />
        </g>
      )}
      {kind === 'pile_field_main' && (
        <polygon points="12,3 21,12 12,21 3,12" fill={color} />
      )}
      {kind === 'pile_field_test' && (
        <polygon points="12,3 21,12 12,21 3,12" fill="white" stroke={color} strokeWidth={2} />
      )}
      {kind === 'base' && (
        <g>
          <path d="M 3 12 L 12 4 L 21 12 L 21 20 L 3 20 Z" fill={color} />
          <rect x={10} y={14} width={4} height={6} fill="white" />
        </g>
      )}
      {kind === 'km_post' && (
        <g>
          <rect x={4} y={4} width={16} height={16} rx={2} fill="white" stroke={color} strokeWidth={1.5} />
          <text x={12} y={16} textAnchor="middle" fontSize={10} fontWeight={700}
                fill={color} fontFamily="JetBrains Mono, monospace">
            {label ?? ''}
          </text>
        </g>
      )}
    </svg>
  )
}

/** Список обозначений для легенды. Порядок и подписи как в Условные обозначения.html */
export const MARKER_LEGEND: { kind: MarkerKind; label: string }[] = [
  { kind: 'borrow_pit',      label: 'Карьер' },
  { kind: 'stockpile',       label: 'Накопитель' },
  { kind: 'pile_field_main', label: 'Осн. свайное поле' },
  { kind: 'pile_field_test', label: 'Пробное свайное поле' },
  { kind: 'bridge',          label: 'Мост' },
  { kind: 'isso',            label: 'ИССО' },
  { kind: 'base',            label: 'База' },
  { kind: 'km_post',         label: 'Километровый знак' },
]
