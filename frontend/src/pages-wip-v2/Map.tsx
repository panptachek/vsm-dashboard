/**
 * WIP Map v2.
 *
 * Leaflet (через react-leaflet) — если его нет в проекте, установить:
 *   npm i leaflet react-leaflet
 * и подключить CSS в main.tsx:
 *   import 'leaflet/dist/leaflet.css'
 *
 * Маркеры рендерим через DivIcon → внутрь встраиваем React-иконку из
 * renderToStaticMarkup (сделано в buildDivIcon).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Tooltip, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import { Map as MapIcon } from 'lucide-react'
import { MarkerIcon, MARKER_LEGEND, type MarkerKind } from './map/markers'

interface MarkersResponse {
  objects: any[]
  piles: any[]
  temp_roads: any[]
  km_posts: { pk_number: number; latitude: number; longitude: number }[]
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
  const html = renderToStaticMarkup(
    <MarkerIcon kind={kind} label={label} size={24} active={active} />
  )
  return L.divIcon({
    html,
    className: 'vsm-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

export default function WipMapV2() {
  const [visible, setVisible] = useState<Record<MarkerKind, boolean>>({
    borrow_pit: true, stockpile: true, bridge: true, isso: true,
    pile_field_main: true, pile_field_test: true, base: true, km_post: true,
  })
  const [active, setActive] = useState<string | null>(null)

  const { data } = useQuery<MarkersResponse>({
    queryKey: ['wip', 'map', 'markers'],
    queryFn: () => fetch('/api/wip/map/markers').then(r => r.json()),
    staleTime: 60_000,
  })

  const objects = useMemo(
    () => (data?.objects ?? [])
      .map(o => ({ ...o, kind: mapObjectKind(o.type_code) }))
      .filter(o => o.kind && visible[o.kind as MarkerKind] && o.start_lat && o.start_lng),
    [data, visible],
  )
  const piles = useMemo(
    () => (data?.piles ?? []).filter(p => p.start_lat && p.start_lng && (
      p.field_type === 'test' ? visible.pile_field_test : visible.pile_field_main
    )),
    [data, visible],
  )
  const kmPosts = useMemo(() => {
    if (!data || !visible.km_post) return []
    // Каждые 10 км (pk_number % 100 == 0 → 10 км), показываем крупнее;
    // остальные — только при зуме.
    return data.km_posts
  }, [data, visible])

  // Центр карты — усреднение ПК-точек
  const center = useMemo<[number, number]>(() => {
    if (!data?.km_posts?.length) return [60.0, 40.0]
    const n = data.km_posts.length
    const s = data.km_posts.reduce(
      (a, p) => [a[0] + p.latitude, a[1] + p.longitude],
      [0, 0] as [number, number],
    )
    return [s[0] / n, s[1] / n]
  }, [data])

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <MapIcon className="w-5 h-5 text-accent-red" />
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Карта (WIP v2)
        </h1>
        <span className="text-xs font-mono text-text-muted">
          {data && `${data.objects.length} объектов · ${data.piles.length} св. полей · ${data.km_posts.length} км-постов`}
        </span>
      </div>

      <div className="relative flex-1 min-h-[calc(100vh-140px)]">
        <MapContainer center={center} zoom={10} className="absolute inset-0" scrollWheelZoom>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap'
          />

          {/* Ось трассы через ПК-точки */}
          {data?.km_posts && data.km_posts.length > 1 && (
            <Polyline
              positions={data.km_posts.map(p => [p.latitude, p.longitude] as [number, number])}
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

          {/* Км-посты: помечаем каждый 10 км цифрой */}
          {kmPosts.map(p => {
            const isMajor = p.pk_number % 100 === 0
            if (!isMajor) return null
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
        </MapContainer>

        {/* Легенда / фильтры */}
        <div className="absolute top-4 left-4 z-[500] bg-white border border-border rounded-xl shadow-lg p-3 max-w-[220px]">
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
          </div>
        </div>
      </div>
    </div>
  )
}
