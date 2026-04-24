import { useMemo, useState, useCallback } from 'react'
import { Polyline, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import type { Picket, MapObject, PileField, ObjectTypeKey } from '../../types/geo'
import {
  getLatLngByPicketage,
  getTangentAngle,
  getPerpendicularEnds,
  formatPicketage,
  offsetPolylineLatLngs,
} from '../../utils/geometry'
import { ObjectInfoPopup } from './ObjectInfoPopup'

type LatLng = [number, number]

interface ObjectsLayerProps {
  pickets: Picket[]
  objects: MapObject[]
  pileFields: PileField[]
  zoom: number
  enabledObjectTypes: Set<ObjectTypeKey>
  /** Дата для запросов детальной информации (popup). YYYY-MM-DD. */
  infoDateISO?: string
}

function typeToDbCode(t: string): string {
  const m: Record<string, string> = {
    pipe: 'PIPE', overpass: 'OVERPASS', bridge: 'BRIDGE',
    intersection_fin: 'INTERSECTION_FIN', intersection_prop: 'INTERSECTION_PROP',
  }
  return m[t] || t.toUpperCase()
}

// ---------------------------------------------------------------------------
// SVG templates for PERPENDICULAR objects (fixed pixel size, zoom-independent)
// ---------------------------------------------------------------------------

/** Pipe/Overpass: vertical bar with chevrons on both ends (∨—∧ rotated).
 * Default orientation: vertical (long axis = Y). Rotate by tangent to match axis. */
function svgPipeOverpass(color: string, sw: number = 2): string {
  return `<svg width="12" height="32" viewBox="0 0 12 32" xmlns="http://www.w3.org/2000/svg">
    <polyline points="2,3 6,6 10,3" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="6" y1="6" x2="6" y2="26" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <polyline points="2,29 6,26 10,29" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

/** Intersection: dashed perpendicular line with 'N' letters between dash segments. */
function svgIntersection(color: string, sw: number): string {
  return `<svg width="14" height="36" viewBox="0 0 14 36" xmlns="http://www.w3.org/2000/svg">
    <line x1="7" y1="1" x2="7" y2="8" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <text x="7" y="14" text-anchor="middle" font-size="7" fill="${color}" font-weight="700" font-family="Arial,sans-serif">N</text>
    <line x1="7" y1="16" x2="7" y2="20" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <text x="7" y="26" text-anchor="middle" font-size="7" fill="${color}" font-weight="700" font-family="Arial,sans-serif">N</text>
    <line x1="7" y1="28" x2="7" y2="35" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>`
}

function makeIcon(svg: string, w: number, h: number, angleDeg: number, active: boolean): L.DivIcon {
  const ring = active
    ? `filter:drop-shadow(0 0 6px #dc2626) drop-shadow(0 0 10px #dc2626);`
    : ''
  return L.divIcon({
    className: active ? 'vsm-obj-active' : '',
    html: `<div style="transform:rotate(${angleDeg}deg);width:${w}px;height:${h}px;pointer-events:auto;cursor:pointer;${ring}">${svg}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPk(pk: number): string { return formatPicketage(pk) }
function fmtPkRange(s: number, e: number | null): string {
  return e != null && e !== s ? `${fmtPk(s)} — ${fmtPk(e)}` : fmtPk(s)
}

/** Build axis polyline points between two PKs */
function buildAxisPoints(pickets: Picket[], pkStart: number, pkEnd: number): LatLng[] {
  const pts: LatLng[] = []
  const lo = Math.min(pkStart, pkEnd)
  const hi = Math.max(pkStart, pkEnd)
  const s = getLatLngByPicketage(pickets, lo)
  if (s) pts.push(s as LatLng)
  for (let pk = Math.ceil(lo); pk <= Math.floor(hi); pk++) {
    if (Math.abs(pk - lo) < 0.001 || Math.abs(pk - hi) < 0.001) continue
    const p = getLatLngByPicketage(pickets, pk)
    if (p) pts.push(p as LatLng)
  }
  const e = getLatLngByPicketage(pickets, hi)
  if (e) pts.push(e as LatLng)
  return pts
}

/** Cross-axis offset in degrees for a given pixel width at current zoom */
function crossOffsetDeg(zoom: number, px: number): number {
  const degPerPx = 360 / (256 * Math.pow(2, zoom)) / 0.53
  return px * degPerPx
}

function mapTypeCode(t: string): string {
  const m: Record<string, string> = {
    PIPE: 'pipe', OVERPASS: 'overpass', BRIDGE: 'bridge',
    INTERSECTION_FIN: 'intersection_fin', INTERSECTION_PROP: 'intersection_prop',
  }
  return m[t] || t.toLowerCase()
}

function typeToFilter(t: string): ObjectTypeKey | null {
  const valid: ObjectTypeKey[] = ['pipe', 'overpass', 'bridge', 'intersection_fin', 'intersection_prop']
  return valid.includes(t as ObjectTypeKey) ? t as ObjectTypeKey : null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ObjectsLayer({ pickets, objects, pileFields, zoom, enabledObjectTypes, infoDateISO }: ObjectsLayerProps) {
  // `selected` tracks which object's popup is currently open, so we can apply
  // a red glow/ring to it. Click toggles; Leaflet popup onClose clears it.
  const [selected, setSelected] = useState<string | null>(null)
  const handleClick = useCallback((id: string) => setSelected(p => p === id ? null : id), [])
  const handleClose = useCallback((id: string) => {
    setSelected((p) => (p === id ? null : p))
  }, [])
  const today = new Date().toISOString().slice(0, 10)
  const dateISO = infoDateISO ?? today

  // Cross-axis offset for along-axis objects (bridges, pile fields)
  const offset = useMemo(() => crossOffsetDeg(zoom, 2), [zoom])
  const whiskerOff = useMemo(() => crossOffsetDeg(zoom, 3), [zoom])

  // ═══════════════════════════════════════════════════════════════════════
  // PERPENDICULAR objects: pipe, overpass, intersection → DivIcon Marker
  // ═══════════════════════════════════════════════════════════════════════
  const perpMarkers = useMemo(() => {
    if (!pickets.length) return []
    return objects.map(obj => {
      const tc = mapTypeCode(obj.type)
      const fk = typeToFilter(tc)
      if (fk && !enabledObjectTypes.has(fk)) return null
      if (tc === 'bridge') return null // handled separately

      let svg: string, w: number, h: number
      if (tc === 'pipe') { svg = svgPipeOverpass('#ff7f00', 2); w = 12; h = 32 }
      else if (tc === 'overpass') { svg = svgPipeOverpass('#05008e', 2); w = 12; h = 32 }
      else if (tc === 'intersection_fin') { svg = svgIntersection('#00ff00', 1.5); w = 14; h = 36 }
      else if (tc === 'intersection_prop') { svg = svgIntersection('#ff00ff', 2); w = 14; h = 36 }
      else return null

      if (zoom < 13) return null // hide at low zoom

      const pk = obj.pk_end ? (obj.pk_start + obj.pk_end) / 2 : obj.pk_start
      const pos = getLatLngByPicketage(pickets, pk)
      if (!pos) return null
      const tang = getTangentAngle(pickets, pk)
      // Perpendicular: SVG line is vertical, axis goes horizontal → rotate by tangent
      const deg = tang * 180 / Math.PI
      const key = `perp-${obj.id}`
      return { key, obj, pos: pos as LatLng, icon: makeIcon(svg, w, h, deg, selected === key) }
    }).filter(Boolean) as { key: string; obj: MapObject; pos: LatLng; icon: L.DivIcon }[]
  }, [objects, pickets, zoom, enabledObjectTypes, selected])

  // ═══════════════════════════════════════════════════════════════════════
  // BRIDGES — two offset polylines along axis + whiskers at ends
  // ═══════════════════════════════════════════════════════════════════════
  const bridgeData = useMemo(() => {
    if (!enabledObjectTypes.has('bridge') || !pickets.length) return []
    return objects.filter(o => mapTypeCode(o.type) === 'bridge' && o.pk_end && o.pk_end !== o.pk_start)
      .map(obj => {
        const axis = buildAxisPoints(pickets, obj.pk_start, obj.pk_end!)
        if (axis.length < 2) return null
        const upper = offsetPolylineLatLngs(axis, offset)
        const lower = offsetPolylineLatLngs(axis, -offset)
        // Bridge whiskers at both ends (outward at 45°)
        const startEnds = getPerpendicularEnds(pickets, obj.pk_start, whiskerOff)
        const endEnds = getPerpendicularEnds(pickets, obj.pk_end!, whiskerOff)
        const whiskers: LatLng[][] = []
        if (startEnds) {
          whiskers.push([upper[0], startEnds[0] as LatLng])
          whiskers.push([lower[0], startEnds[1] as LatLng])
        }
        if (endEnds) {
          whiskers.push([upper[upper.length - 1], endEnds[0] as LatLng])
          whiskers.push([lower[lower.length - 1], endEnds[1] as LatLng])
        }
        return { obj, upper, lower, whiskers, key: `br-${obj.id}` }
      }).filter(Boolean) as {
        obj: MapObject; upper: LatLng[]; lower: LatLng[]; whiskers: LatLng[][]; key: string
      }[]
  }, [objects, pickets, offset, whiskerOff, enabledObjectTypes])

  // ═══════════════════════════════════════════════════════════════════════
  // PILE FIELDS — rectangle along axis (upper+lower+caps) + 2 cross lines
  // ═══════════════════════════════════════════════════════════════════════
  const pileData = useMemo(() => {
    if (!enabledObjectTypes.has('pile_field') || !pickets.length) return []
    return pileFields.map(pf => {
      const axis = buildAxisPoints(pickets, pf.pk_start, pf.pk_end)
      if (axis.length < 2) return null
      // Outer rectangle: 2 parallel lines along axis (top + bottom edges)
      const upper = offsetPolylineLatLngs(axis, offset)
      const lower = offsetPolylineLatLngs(axis, -offset)
      // Two inner dividers parallel to axis (above and below center):
      // Places them at 1/3 and 2/3 of cross-axis height
      const innerUpper = offsetPolylineLatLngs(axis, offset / 3)
      const innerLower = offsetPolylineLatLngs(axis, -offset / 3)
      // End caps (perpendicular to axis, connecting top edge to bottom edge)
      const startCap = getPerpendicularEnds(pickets, pf.pk_start, offset)
      const endCap = getPerpendicularEnds(pickets, pf.pk_end, offset)
      return { pf, upper, lower, innerUpper, innerLower, startCap, endCap, key: `pf-${pf.id}` }
    }).filter(Boolean) as {
      pf: PileField; upper: LatLng[]; lower: LatLng[]; innerUpper: LatLng[]; innerLower: LatLng[]
      startCap: LatLng[] | null; endCap: LatLng[] | null; key: string
    }[]
  }, [pileFields, pickets, offset, enabledObjectTypes])

  return (
    <>
      {/* ── Perpendicular objects (pipe, overpass, intersection) ── */}
      {perpMarkers.map(({ key, obj, pos, icon }) => (
        <Marker
          key={key}
          position={pos}
          icon={icon}
          eventHandlers={{
            click: () => handleClick(key),
            popupclose: () => handleClose(key),
          }}
        >
          <Popup>
            <ObjectInfoPopup
              id={String(obj.id)}
              type={typeToDbCode(obj.type)}
              dateISO={dateISO}
              fallbackTitle={obj.name}
              fallbackSubtitle={fmtPkRange(obj.pk_start, obj.pk_end)}
            />
          </Popup>
        </Marker>
      ))}

      {/* ── Bridges ── */}
      {bridgeData.map(({ obj, upper, lower, whiskers, key }) => {
        const isActive = selected === key
        const lineColor = isActive ? '#dc2626' : '#000'
        const lineWeight = isActive ? 2.5 : 1.5
        return (
          <span key={key}>
            <Polyline positions={upper} pathOptions={{ color: lineColor, weight: lineWeight }} interactive={false} />
            <Polyline positions={lower} pathOptions={{ color: lineColor, weight: lineWeight }} interactive={false} />
            {whiskers.map((w, i) => (
              <Polyline key={`${key}-w${i}`} positions={w} pathOptions={{ color: lineColor, weight: isActive ? 2 : 1.2 }} interactive={false} />
            ))}
            {/* Invisible hit area */}
            <Polyline positions={upper} pathOptions={{ color: '#000', weight: 15, opacity: 0 }}
              eventHandlers={{
                click: () => handleClick(key),
                popupclose: () => handleClose(key),
              }}>
              <Popup>
                <ObjectInfoPopup
                  id={String(obj.id)}
                  type={typeToDbCode(obj.type)}
                  dateISO={dateISO}
                  fallbackTitle={obj.name}
                  fallbackSubtitle={`Мост · ${fmtPkRange(obj.pk_start, obj.pk_end)}`}
                />
              </Popup>
            </Polyline>
          </span>
        )
      })}

      {/* ── Pile fields ── */}
      {pileData.map(({ pf, upper, lower, innerUpper, innerLower, startCap, endCap, key }) => {
        const isActive = selected === key
        const lineColor = isActive ? '#dc2626' : '#007fff'
        const outerWeight = isActive ? 2.5 : 1.2
        const innerWeight = isActive ? 2 : 1
        return (
          <span key={key}>
            {/* Outer rectangle: top + bottom + caps */}
            <Polyline positions={upper} pathOptions={{ color: lineColor, weight: outerWeight }} interactive={false} />
            <Polyline positions={lower} pathOptions={{ color: lineColor, weight: outerWeight }} interactive={false} />
            {startCap && <Polyline positions={startCap} pathOptions={{ color: lineColor, weight: outerWeight }} interactive={false} />}
            {endCap && <Polyline positions={endCap} pathOptions={{ color: lineColor, weight: outerWeight }} interactive={false} />}
            {/* Two inner parallel dividers along axis (above + below center) */}
            <Polyline positions={innerUpper} pathOptions={{ color: lineColor, weight: innerWeight }} interactive={false} />
            <Polyline positions={innerLower} pathOptions={{ color: lineColor, weight: innerWeight }} interactive={false} />
            {/* Hit area */}
            <Polyline positions={upper} pathOptions={{ color: '#007fff', weight: 15, opacity: 0 }}
              eventHandlers={{
                click: () => handleClick(key),
                popupclose: () => handleClose(key),
              }}>
              <Popup>
                <ObjectInfoPopup
                  id={String(pf.id)}
                  type="pile_field"
                  dateISO={dateISO}
                  fallbackTitle={pf.name || 'Свайное поле'}
                  fallbackSubtitle={fmtPkRange(pf.pk_start, pf.pk_end)}
                />
              </Popup>
            </Polyline>
          </span>
        )
      })}
    </>
  )
}
