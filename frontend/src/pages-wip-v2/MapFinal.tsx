/**
 * WIP Map FINAL — карта с полным набором слоёв из v2 + слой «Техника на пикетах».
 *
 * Слои (порядок легенды):
 *   - Карьеры, Накопители, Мосты, ИССО, Свайные поля (осн./пробн.), Базы
 *   - Км-посты
 *   - Техника на пикетах (круглый бейдж с иконкой типа и счётчиком в углу)
 *
 * Данные:
 *   /api/wip/map/markers     — объекты, сваи, АД, км-посты (существующий)
 *   /api/wip/map/equipment   — техника по участкам и типам (новый)
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Tooltip, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import { Map as MapIcon } from 'lucide-react'
import { MarkerIcon, MARKER_LEGEND, type MarkerKind } from './map/markers'
import { PeriodBar, usePeriod } from './PeriodBar'

interface MarkersResponse {
  objects: any[]
  piles: any[]
  temp_roads: any[]
  km_posts: { pk_number: number; latitude: number; longitude: number }[]
}

interface EquipmentResponse {
  rows: { pk: number; sec: string; type: EquipType; count: number }[]
}

type EquipType = 'dump' | 'excav' | 'dozer' | 'grader' | 'roller' | 'loader'

const EQUIP_LABEL: Record<EquipType, string> = {
  dump: 'Самосвал', excav: 'Экскаватор', dozer: 'Бульдозер',
  grader: 'Автогрейдер', roller: 'Каток', loader: 'Погрузчик',
}
const EQUIP_COLOR: Record<EquipType, string> = {
  dump: '#1a1a1a', excav: '#dc2626', dozer: '#7f1d1d',
  grader: '#525252', roller: '#737373', loader: '#a3a3a3',
}
const EQUIP_SVG: Record<EquipType, string> = {
  dump:   `<rect x="2" y="10" width="14" height="8" fill="currentColor"/><polygon points="16,12 22,12 22,18 16,18" fill="currentColor"/><circle cx="7" cy="20" r="2.5" fill="currentColor"/><circle cx="18" cy="20" r="2.5" fill="currentColor"/>`,
  excav:  `<rect x="4" y="14" width="16" height="6" fill="currentColor"/><rect x="8" y="10" width="6" height="4" fill="currentColor"/><line x1="14" y1="12" x2="22" y2="4" stroke="currentColor" stroke-width="2"/><polygon points="20,2 24,2 22,6" fill="currentColor"/>`,
  dozer:  `<rect x="4" y="12" width="12" height="6" fill="currentColor"/><rect x="16" y="10" width="2" height="10" fill="currentColor"/><circle cx="8" cy="20" r="2" fill="currentColor"/><circle cx="14" cy="20" r="2" fill="currentColor"/>`,
  grader: `<rect x="3" y="14" width="18" height="4" fill="currentColor"/><circle cx="6" cy="20" r="2" fill="currentColor"/><circle cx="18" cy="20" r="2" fill="currentColor"/><line x1="8" y1="16" x2="16" y2="12" stroke="currentColor" stroke-width="2"/>`,
  roller: `<circle cx="8" cy="16" r="5" fill="currentColor"/><rect x="13" y="10" width="8" height="8" fill="currentColor"/><circle cx="17" cy="20" r="2" fill="currentColor"/>`,
  loader: `<rect x="6" y="10" width="10" height="8" fill="currentColor"/><polygon points="2,14 6,14 6,18 2,18" fill="currentColor"/><circle cx="9" cy="20" r="2" fill="currentColor"/><circle cx="15" cy="20" r="2" fill="currentColor"/>`,
}

function mapObjectKind(typeCode: string): MarkerKind | null {
  switch (typeCode) {
    case 'BORROW_PIT':     return 'borrow_pit'
    case 'STOCKPILE':      return 'stockpile'
    case 'BRIDGE':         return 'bridge'
    case 'ISSO':
    case 'CULVERT':        return 'isso'
    case 'BASE':
    case 'FIELD_CAMP':     return 'base'
    default:               return null
  }
}

function buildDivIcon(kind: MarkerKind, label?: string, active?: boolean): L.DivIcon {
  const html = renderToStaticMarkup(<MarkerIcon kind={kind} label={label} size={24} active={active} />)
  return L.divIcon({ html, className: 'vsm-marker', iconSize: [24, 24], iconAnchor: [12, 12] })
}

/** Бейдж техники: круглая рамка с SVG типа + счётчик в углу. */
function buildEquipIcon(type: EquipType, count: number): L.DivIcon {
  const color = EQUIP_COLOR[type]
  const svg = EQUIP_SVG[type] ?? ''
  const html = `
    <div style="
      position: relative;
      width: 32px; height: 32px;
      background: white;
      border: 2px solid ${color};
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      color: ${color};
    ">
      <svg viewBox="0 0 24 24" width="20" height="20">${svg}</svg>
      <span style="
        position: absolute;
        top: -5px; right: -5px;
        min-width: 16px; height: 16px;
        padding: 0 4px;
        background: ${color};
        color: white;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        font-family: JetBrains Mono, monospace;
        display: flex; align-items: center; justify-content: center;
        line-height: 1;
      ">${count}</span>
    </div>`
  return L.divIcon({ html, className: 'vsm-equip-marker', iconSize: [32, 32], iconAnchor: [16, 16] })
}

export default function WipMapFinal() {
  const { from, to } = usePeriod()
  const [visible, setVisible] = useState<Record<MarkerKind | 'equipment', boolean>>({
    borrow_pit: true, stockpile: true, bridge: true, isso: true,
    pile_field_main: true, pile_field_test: true, base: true, km_post: true,
    equipment: true,
  })
  const [active, setActive] = useState<string | null>(null)

  const { data: markers } = useQuery<MarkersResponse>({
    queryKey: ['wip', 'map', 'markers'],
    queryFn: () => fetch('/api/wip/map/markers').then(r => r.json()),
    staleTime: 60_000,
  })

  const { data: equipment } = useQuery<EquipmentResponse>({
    queryKey: ['wip', 'map', 'equipment', from, to],
    queryFn: () => fetch(`/api/wip/map/equipment?from=${from}&to=${to}`).then(r => r.json()),
    staleTime: 30_000,
  })

  const objects = useMemo(
    () => (markers?.objects ?? [])
      .map(o => ({ ...o, kind: mapObjectKind(o.type_code) }))
      .filter(o => o.kind && visible[o.kind as MarkerKind] && o.start_lat && o.start_lng),
    [markers, visible],
  )
  const piles = useMemo(
    () => (markers?.piles ?? []).filter(p => p.start_lat && p.start_lng && (
      p.field_type === 'test' ? visible.pile_field_test : visible.pile_field_main
    )),
    [markers, visible],
  )

  /**
   * Маркеры техники: для каждого pk группируем по типу, чтобы показать
   * несколько иконок вокруг одного пикета по кругу.
   */
  const equipMarkers = useMemo(() => {
    if (!equipment || !markers?.km_posts.length || !visible.equipment) return []
    // Строим карту pk → координата по ближайшему km_post
    const posts = markers.km_posts.slice().sort((a, b) => a.pk_number - b.pk_number)
    const coordForPk = (pk: number): [number, number] | null => {
      if (!posts.length) return null
      // pk в единицах целых пикетов; km_posts.pk_number тоже целые ПК
      let best = posts[0]
      let bestDiff = Math.abs(posts[0].pk_number - pk)
      for (const p of posts) {
        const d = Math.abs(p.pk_number - pk)
        if (d < bestDiff) { bestDiff = d; best = p }
      }
      return [best.latitude, best.longitude]
    }

    // Группировка: ключ по pk+sec — кладём вокруг точки по кругу
    const byKey: Record<string, { pk: number; sec: string; items: typeof equipment.rows }> = {}
    for (const r of equipment.rows) {
      if (r.pk == null) continue
      const key = `${r.pk}-${r.sec}`
      byKey[key] ??= { pk: r.pk, sec: r.sec, items: [] }
      byKey[key].items.push(r)
    }

    const out: { id: string; lat: number; lng: number; type: EquipType; count: number; pk: number; sec: string; groupTooltip: string }[] = []
    for (const group of Object.values(byKey)) {
      const c = coordForPk(group.pk)
      if (!c) continue
      const tooltip = group.items
        .map(x => `<b>${EQUIP_LABEL[x.type] ?? x.type}</b>: ${x.count} ед.`)
        .join('<br/>')
      group.items.forEach((e, i) => {
        const angle = (i / group.items.length) * Math.PI * 2 - Math.PI / 2
        const offset = 0.018
        out.push({
          id: `${group.pk}-${group.sec}-${e.type}`,
          lat: c[0] + Math.sin(angle) * offset,
          lng: c[1] + Math.cos(angle) * offset * 2,
          type: e.type, count: e.count, pk: group.pk, sec: group.sec,
          groupTooltip: tooltip,
        })
      })
    }
    return out
  }, [equipment, markers, visible.equipment])

  const center = useMemo<[number, number]>(() => {
    if (!markers?.km_posts?.length) return [58.5, 32.1]
    const n = markers.km_posts.length
    const s = markers.km_posts.reduce((a, p) => [a[0] + p.latitude, a[1] + p.longitude], [0, 0] as [number, number])
    return [s[0] / n, s[1] / n]
  }, [markers])

  const totalEquip = equipment?.rows.reduce((a, r) => a + r.count, 0) ?? 0

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <PeriodBar />

      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <MapIcon className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Карта трассы
        </h1>
        <span className="text-xs font-mono text-text-muted">
          {markers && `${markers.objects.length} объектов · ${markers.piles.length} св. полей · ${totalEquip} ед. техники`}
        </span>
      </div>

      <div className="relative flex-1 min-h-[calc(100vh-180px)]">
        <MapContainer center={center} zoom={10} className="absolute inset-0" scrollWheelZoom>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />

          {/* Ось трассы */}
          {markers?.km_posts && markers.km_posts.length > 1 && (
            <Polyline
              positions={markers.km_posts.map(p => [p.latitude, p.longitude] as [number, number])}
              pathOptions={{ color: '#dc2626', weight: 3, opacity: 0.9 }}
            />
          )}

          {/* Объекты */}
          {objects.map(o => (
            <Marker key={`obj-${o.id}`}
                    position={[o.start_lat, o.start_lng]}
                    icon={buildDivIcon(o.kind as MarkerKind, undefined, active === o.id)}
                    eventHandlers={{ click: () => setActive(o.id) }}>
              <Tooltip direction="top" offset={[0, -12]}>
                <b>{o.name}</b><br/>
                <span className="font-mono text-xs">{o.pk_raw_text}</span>
              </Tooltip>
            </Marker>
          ))}

          {/* Свайные поля */}
          {piles.map(p => (
            <Marker key={`pile-${p.id}`}
                    position={[p.start_lat, p.start_lng]}
                    icon={buildDivIcon(
                      p.field_type === 'test' ? 'pile_field_test' : 'pile_field_main',
                      undefined, active === p.id,
                    )}
                    eventHandlers={{ click: () => setActive(p.id) }}>
              <Tooltip direction="top" offset={[0, -12]}>
                <b>{p.field_code}</b><br/>
                {p.pile_count} свай · испытаний: {p.dynamic_test_count ?? 0}
              </Tooltip>
            </Marker>
          ))}

          {/* Км-посты (только целые 10 км) */}
          {visible.km_post && markers?.km_posts?.map(p => {
            if (p.pk_number % 100 !== 0) return null
            const km = Math.round(p.pk_number / 10)
            return (
              <Marker key={`km-${p.pk_number}`}
                      position={[p.latitude, p.longitude]}
                      icon={buildDivIcon('km_post', String(km))}
                      zIndexOffset={-1000}>
                <Tooltip direction="bottom" offset={[0, 12]}>
                  ПК{p.pk_number} · {km} км
                </Tooltip>
              </Marker>
            )
          })}

          {/* Техника на пикетах */}
          {visible.equipment && equipMarkers.map(m => (
            <Marker key={`eq-${m.id}`}
                    position={[m.lat, m.lng]}
                    icon={buildEquipIcon(m.type, m.count)}>
              <Tooltip direction="top" offset={[0, -16]}>
                <div>
                  <b>ПК{m.pk} · {m.sec}</b>
                  <div dangerouslySetInnerHTML={{ __html: m.groupTooltip }} />
                </div>
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>

        {/* Легенда / фильтры */}
        <div className="absolute top-4 left-4 z-[500] bg-white border border-border rounded-xl shadow-lg p-3 max-w-[240px]">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            Условные обозначения
          </div>
          <div className="space-y-1.5">
            {MARKER_LEGEND.map(({ kind, label }) => (
              <label key={kind} className="flex items-center gap-2 text-xs cursor-pointer
                                            hover:bg-bg-surface rounded px-1.5 py-0.5 -mx-1.5">
                <input type="checkbox" checked={visible[kind]}
                       onChange={e => setVisible(v => ({ ...v, [kind]: e.target.checked }))}
                       className="accent-accent-red w-3.5 h-3.5" />
                <MarkerIcon kind={kind} size={18} label={kind === 'km_post' ? '1' : undefined} />
                <span className="flex-1 text-text-primary">{label}</span>
              </label>
            ))}
            {/* Техника — отдельная строка */}
            <label className="flex items-center gap-2 text-xs cursor-pointer
                              hover:bg-bg-surface rounded px-1.5 py-0.5 -mx-1.5
                              border-t border-border mt-1 pt-2">
              <input type="checkbox" checked={visible.equipment}
                     onChange={e => setVisible(v => ({ ...v, equipment: e.target.checked }))}
                     className="accent-accent-red w-3.5 h-3.5" />
              <span style={{
                display: 'inline-flex', width: 18, height: 18,
                borderRadius: '50%', border: '2px solid #1a1a1a',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
              }}>N</span>
              <span className="flex-1 text-text-primary">Техника на ПК</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
