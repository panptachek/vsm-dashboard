import { useMemo } from 'react'
import { MapContainer, TileLayer, Polyline } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'

import type { Picket, Section, LatLng } from '../types/geo'
import { getLatLngByPicketage } from '../utils/geometry'

// ---------------------------------------------------------------------------
// Tile config (same as VsmMap)
// ---------------------------------------------------------------------------

const TILE_URL =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const DEFAULT_CENTER: [number, number] = [58.14, 33.55]
const DEFAULT_ZOOM = 8

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MiniMapProps {
  pickets: Picket[]
  sections: Section[]
}

// ---------------------------------------------------------------------------
// Click overlay — transparent div that navigates to /map
// ---------------------------------------------------------------------------

function ClickOverlay() {
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate('/map')}
      className="absolute inset-0 z-[1000] cursor-pointer"
      title="Открыть карту"
    />
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MiniMap({ pickets, sections }: MiniMapProps) {
  // Full route polyline
  const routePositions = useMemo<LatLng[]>(
    () => pickets.map((p) => [p.latitude, p.longitude] as LatLng),
    [pickets]
  )

  // Compute bounds from pickets
  const bounds = useMemo(() => {
    if (pickets.length === 0) return undefined
    const lats = pickets.map((p) => p.latitude)
    const lngs = pickets.map((p) => p.longitude)
    return [
      [Math.min(...lats), Math.min(...lngs)] as [number, number],
      [Math.max(...lats), Math.max(...lngs)] as [number, number],
    ] as [[number, number], [number, number]]
  }, [pickets])

  // Section-colored overlays
  const sectionPolylines = useMemo(() => {
    if (!pickets.length || !sections.length) return []

    return sections.flatMap((section) => {
      const ranges = section.ranges ?? [[section.pk_start, section.pk_end]]
      return ranges.map((range, rangeIdx) => {
        const [pkStart, pkEnd] = range
        const points: LatLng[] = []

        const startPt = getLatLngByPicketage(pickets, pkStart)
        if (startPt) points.push(startPt)

        const iStart = Math.ceil(pkStart)
        const iEnd = Math.floor(pkEnd)
        for (let pk = iStart; pk <= iEnd; pk++) {
          const pt = getLatLngByPicketage(pickets, pk)
          if (pt) points.push(pt)
        }

        const endPt = getLatLngByPicketage(pickets, pkEnd)
        if (endPt) points.push(endPt)

        return {
          key: `mini-${section.code}-r${rangeIdx}`,
          positions: points,
          color: section.map_color,
        }
      })
    })
  }, [pickets, sections])

  return (
    <div className="relative w-full h-[250px] rounded-lg overflow-hidden">
      <ClickOverlay />
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        bounds={bounds}
        boundsOptions={{ padding: [20, 20] }}
        className="w-full h-full"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
      >
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          maxZoom={19}
          subdomains="abc"
        />

        {/* Route polyline */}
        {routePositions.length >= 2 && (
          <Polyline
            positions={routePositions}
            pathOptions={{ color: '#ef4444', weight: 3, opacity: 0.7 }}
          />
        )}

        {/* Section colored overlays */}
        {sectionPolylines.map((seg) => (
          <Polyline
            key={seg.key}
            positions={seg.positions}
            pathOptions={{
              color: seg.color,
              weight: 6,
              opacity: 0.4,
              lineCap: 'butt',
            }}
          />
        ))}
      </MapContainer>
    </div>
  )
}
