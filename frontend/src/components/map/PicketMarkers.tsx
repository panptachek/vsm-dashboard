import { useMemo } from 'react'
import { Marker, Polyline } from 'react-leaflet'
import L from 'leaflet'
import type { Picket, LatLng } from '../../types/geo'
import {
  getPerpendicularEnds,
  getLatLngByPicketage,
  getTangentAngle,
  getMarkHalfLenDeg,
  getScaleByZoom,
} from '../../utils/geometry'

interface PicketMarkersProps {
  pickets: Picket[]
  zoom: number
  /** Highlight pickets in these PK ranges (yellow marks) */
  highlightRanges?: [number, number][]
}

interface MarkData {
  pk: number
  ends: [LatLng, LatLng]
  center: LatLng
  isKm: boolean
  highlighted: boolean
}

// ---------------------------------------------------------------------------
// Offset a point perpendicular to the route, choosing "below" on screen
// (i.e., the side with smaller latitude = lower on the map in web Mercator)
// ---------------------------------------------------------------------------

function offsetPointBelow(
  pickets: Picket[],
  pk: number,
  offsetDeg: number,
): LatLng | null {
  const center = getLatLngByPicketage(pickets, pk)
  if (!center) return null
  const angle = getTangentAngle(pickets, pk)
  const perp = angle + Math.PI / 2
  const cosLat = Math.cos((center[0] * Math.PI) / 180)

  // Compute both candidate points
  const dLng = Math.cos(perp) * offsetDeg / cosLat
  const dLat = -Math.sin(perp) * offsetDeg

  const ptA: LatLng = [center[0] + dLat, center[1] + dLng]
  const ptB: LatLng = [center[0] - dLat, center[1] - dLng]

  // "Below" on screen in Leaflet = smaller latitude (south)
  // Pick the point with smaller latitude
  return ptA[0] < ptB[0] ? ptA : ptB
}

// ---------------------------------------------------------------------------
// Build a one-sided tick below the axis (from axis outward on one side)
// ---------------------------------------------------------------------------

function getOneSidedTickEnds(
  pickets: Picket[],
  pkNumber: number,
  tickLen: number,
): [LatLng, LatLng] | null {
  const onAxis = getLatLngByPicketage(pickets, pkNumber)
  if (!onAxis) return null
  const offAxis = offsetPointBelow(pickets, pkNumber, tickLen)
  if (!offAxis) return null
  return [onAxis, offAxis]
}

// ---------------------------------------------------------------------------
// DivIcon factory for kilometer posts
// ---------------------------------------------------------------------------

function makeKmIcon(pkNum: number, scale: number): L.DivIcon {
  const circleSize = Math.round(18 * scale)
  const fontSize = Math.round(12 * scale)
  const borderW = Math.max(1, Math.round(1.5 * scale))
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:${Math.round(3 * scale)}px;pointer-events:none">
      <div style="
        width:${circleSize}px;height:${circleSize}px;border-radius:50%;
        background:linear-gradient(to bottom, #dc2626 50%, #ffffff 50%);
        border:${borderW}px solid #333;
        flex-shrink:0;
      "></div>
      <div style="
        font-family:'JetBrains Mono',monospace;
        font-size:${fontSize}px;font-weight:700;
        background:rgba(255,255,255,0.92);
        border:1px solid #ccc;border-radius:3px;
        padding:1px ${Math.round(4 * scale)}px;white-space:nowrap;
        color:#333;
      ">${pkNum}</div>
    </div>`,
    iconSize: [0, 0],
    // Anchor at top-left of icon so it sits just below the leader line end
    iconAnchor: [Math.round(-2 * scale), Math.round(circleSize / 2)],
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Kilometer posts shown as red/white half-circle markers + PK label,
 * positioned BELOW the axis with a dashed leader line (#999, 1px).
 * Visibility by zoom level:
 *   zoom < 9    : km posts every 20 PK
 *   zoom >= 9   : km posts every 10 PK
 *   zoom < 13   : no tick marks
 *   zoom 13-14  : tick marks every 5 PK (no labels)
 *   zoom >= 15  : tick marks every 1 PK (no labels), ticks below axis
 */
export function PicketMarkers({ pickets, zoom, highlightRanges }: PicketMarkersProps) {
  const halfLen = useMemo(() => getMarkHalfLenDeg(zoom), [zoom])
  const scale = useMemo(() => getScaleByZoom(zoom), [zoom])

  // Km post step: every 20 PK at zoom < 9, every 10 PK at zoom >= 9
  const kmStep = zoom < 9 ? 20 : 10

  // Offset for positioning km labels below axis (in degrees)
  // Leader line length = ~2x the diameter of the km circle icon
  const kmBelowOffset = halfLen * 2.5

  const marks = useMemo<MarkData[]>(() => {
    if (!pickets || pickets.length < 2) return []

    const isHighlighted = (pk: number) => {
      if (!highlightRanges) return false
      return highlightRanges.some(([s, e]) => pk >= s && pk <= e)
    }

    let tickStep: number | null
    if (zoom >= 15) {
      tickStep = 1
    } else if (zoom >= 13) {
      tickStep = 5
    } else {
      tickStep = null
    }

    const result: MarkData[] = []
    const minPk = Math.ceil(pickets[0].pk_number)
    const maxPk = Math.floor(pickets[pickets.length - 1].pk_number)

    // Add km posts at kmStep interval
    const kmStart = Math.ceil(minPk / kmStep) * kmStep
    for (let pkNum = kmStart; pkNum <= maxPk; pkNum += kmStep) {
      const ends = getPerpendicularEnds(pickets, pkNum, halfLen)
      if (!ends) continue
      const center: LatLng = [
        (ends[0][0] + ends[1][0]) / 2,
        (ends[0][1] + ends[1][1]) / 2,
      ]
      result.push({
        pk: pkNum,
        ends,
        center,
        isKm: true,
        highlighted: isHighlighted(pkNum),
      })
    }

    // Add tick marks if visible at this zoom
    if (tickStep != null) {
      const tickStart = Math.ceil(minPk / tickStep) * tickStep
      for (let pkNum = tickStart; pkNum <= maxPk; pkNum += tickStep) {
        if (pkNum % kmStep === 0) continue
        if (zoom >= 15) {
          const tickEnds = getOneSidedTickEnds(pickets, pkNum, halfLen * 0.7)
          if (!tickEnds) continue
          const center: LatLng = [
            (tickEnds[0][0] + tickEnds[1][0]) / 2,
            (tickEnds[0][1] + tickEnds[1][1]) / 2,
          ]
          result.push({
            pk: pkNum,
            ends: tickEnds,
            center,
            isKm: false,
            highlighted: isHighlighted(pkNum),
          })
        } else {
          const ends = getPerpendicularEnds(pickets, pkNum, halfLen)
          if (!ends) continue
          const center: LatLng = [
            (ends[0][0] + ends[1][0]) / 2,
            (ends[0][1] + ends[1][1]) / 2,
          ]
          result.push({
            pk: pkNum,
            ends,
            center,
            isKm: false,
            highlighted: isHighlighted(pkNum),
          })
        }
      }
    }

    return result
  }, [pickets, halfLen, highlightRanges, zoom, kmStep])

  // Split into km posts and tick marks
  const kmPosts = useMemo(() => marks.filter((m) => m.isKm), [marks])
  const ticks = useMemo(() => marks.filter((m) => !m.isKm), [marks])

  // Km post leader lines: from axis to below-axis position
  const kmLeaderLines = useMemo(() => {
    return kmPosts.map((km) => {
      const axisPos = getLatLngByPicketage(pickets, km.pk)
      const belowPos = offsetPointBelow(pickets, km.pk, kmBelowOffset)
      if (!axisPos || !belowPos) return null
      return { pk: km.pk, line: [axisPos, belowPos] as [LatLng, LatLng], belowPos }
    }).filter(Boolean) as { pk: number; line: [LatLng, LatLng]; belowPos: LatLng }[]
  }, [kmPosts, pickets, kmBelowOffset])

  // Km post icons at below-axis position
  const kmIcons = useMemo(() => {
    const icons = new Map<number, L.DivIcon>()
    for (const km of kmPosts) {
      icons.set(km.pk, makeKmIcon(km.pk, scale))
    }
    return icons
  }, [kmPosts, scale])

  // Tick weight
  const tickWeight5 = Math.max(1, Math.round(1.5 * scale))
  const tickWeight1 = Math.max(1, Math.round(1 * scale))

  return (
    <>
      {/* Tick marks (non-km, no labels) */}
      {ticks.map((mark) => {
        const is5pk = mark.pk % 5 === 0
        return (
          <Polyline
            key={`tick-${mark.pk}`}
            positions={mark.ends}
            pathOptions={{
              color: mark.highlighted ? '#FFEB3B' : '#ef4444',
              weight: is5pk ? tickWeight5 : tickWeight1,
              opacity: 0.7,
            }}
            interactive={false}
          />
        )
      })}

      {/* Kilometer posts: tick line on axis + leader line + DivIcon marker below */}
      {kmPosts.map((mark) => {
        const leader = kmLeaderLines.find((l) => l.pk === mark.pk)
        return (
          <span key={`km-${mark.pk}`}>
            {/* Tick on axis */}
            <Polyline
              positions={mark.ends}
              pathOptions={{
                color: mark.highlighted ? '#FFEB3B' : '#ef4444',
                weight: mark.highlighted ? Math.max(3, Math.round(3 * scale)) : Math.max(2, Math.round(2 * scale)),
                opacity: 0.9,
              }}
              interactive={false}
            />
            {/* Leader line from axis to label (dashed #999, 1px) */}
            {leader && (
              <Polyline
                positions={leader.line}
                pathOptions={{
                  color: '#999',
                  weight: 1,
                  opacity: 0.5,
                  dashArray: '3,3',
                }}
                interactive={false}
              />
            )}
            {/* Label positioned below axis */}
            {leader && (
              <Marker
                position={leader.belowPos}
                icon={kmIcons.get(mark.pk)!}
                interactive={false}
              />
            )}
          </span>
        )
      })}
    </>
  )
}
