/**
 * Слой временных притрассовых дорог на карте.
 * Рисует каждую дорогу как полилинию по её точкам (/api/wip/map/temp-roads).
 * Цвет отличается от ВСЖМ-трассы, имеется onClick → всплывающий popup с кодом/длиной.
 */
import { useQuery } from '@tanstack/react-query'
import { Polyline, Popup } from 'react-leaflet'

interface RoadPoint { lat: number; lng: number; pk_label?: string | null }
interface TempRoad {
  road_code: string
  road_name: string
  length_m: number | null
  points: RoadPoint[]
}

/** Палитра цветов для разных дорог — циклично. */
const PALETTE = [
  '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6',
  '#eab308', '#a855f7', '#22c55e', '#0ea5e9', '#d946ef',
  '#f43f5e',
]

export function TempRoadsLayer({ enabled = true }: { enabled?: boolean }) {
  const { data } = useQuery<{ roads: TempRoad[] }>({
    queryKey: ['wip', 'map', 'temp-roads'],
    queryFn: () => fetch('/api/wip/map/temp-roads').then(r => r.json()),
    staleTime: 5 * 60_000,
  })
  if (!enabled || !data?.roads) return null

  return (
    <>
      {data.roads.map((road, i) => {
        const color = PALETTE[i % PALETTE.length]
        if (road.points.length < 2) return null
        const positions = road.points.map(p => [p.lat, p.lng] as [number, number])
        return (
          <Polyline
            key={road.road_code}
            positions={positions}
            pathOptions={{ color, weight: 3, opacity: 0.85 }}
          >
            <Popup>
              <div style={{ minWidth: 180, fontSize: 12 }}>
                <strong style={{ color }}>{road.road_code}</strong>
                {road.road_name && road.road_name !== road.road_code && (
                  <div style={{ color: '#666', fontSize: 11 }}>{road.road_name}</div>
                )}
                {road.length_m != null && (
                  <div style={{ marginTop: 4 }}>
                    Длина: <b>{(road.length_m / 1000).toFixed(2)} км</b>
                  </div>
                )}
                <div style={{ marginTop: 2, color: '#888', fontSize: 10 }}>
                  {road.points.length} точек
                </div>
              </div>
            </Popup>
          </Polyline>
        )
      })}
    </>
  )
}
