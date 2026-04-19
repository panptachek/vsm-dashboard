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

type LatLng = [number, number]

interface ObjectsLayerProps {
  pickets: Picket[]
  objects: MapObject[]
  pileFields: PileField[]
  zoom: number
  enabledObjectTypes: Set<ObjectTypeKey>
}

// ---------------------------------------------------------------------------
// SVG templates for PERPENDICULAR objects (fixed pixel size, zoom-independent)
// ---------------------------------------------------------------------------

function svgPipeOverpass(color: string, sw: number = 2.5): string {
  return `<svg width="30" height="44" viewBox="0 0 30 44" xmlns="http://www.w3.org/2000/svg">
    <line x1="15" y1="6" x2="15" y2="38" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="15" y1="6" x2="7" y2="0" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="15" y1="6" x2="23" y2="0" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="15" y1="38" x2="7" y2="44" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="15" y1="38" x2="23" y2="44" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>`
}

function svgIntersection(color: string, sw: number): string {
  return `<svg width="30" height="44" viewBox="0 0 30 44" xmlns="http://www.w3.org/2000/svg">
    <line x1="15" y1="1" x2="15" y2="12" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <text x="15" y="20" text-anchor="middle" font-size="8" fill="${color}" font-weight="bold" font-family="sans-serif">N</text>
    <line x1="15" y1="23" x2="15" y2="31" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
    <text x="15" y="38" text-anchor="middle" font-size="8" fill="${color}" font-weight="bold" font-family="sans-serif">N</text>
    <line x1="15" y1="40" x2="15" y2="44" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>`
}

function makeIcon(svg: string, w: number, h: number, angleDeg: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${angleDeg}deg);width:${w}px;height:${h}px;pointer-events:auto;cursor:pointer;">${svg}</div>`,
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

export function ObjectsLayer({ pickets, objects, pileFields, zoom, enabledObjectTypes }: ObjectsLayerProps) {
  const [, setSelected] = useState<string | null>(null)
  const handleClick = useCallback((id: string) => setSelected(p => p === id ? null : id), [])

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
      if (tc === 'pipe') { svg = svgPipeOverpass('#ef6c00'); w = 30; h = 44 }
      else if (tc === 'overpass') { svg = svgPipeOverpass('#1565c0'); w = 30; h = 44 }
      else if (tc === 'intersection_fin') { svg = svgIntersection('#8d6e63', 2); w = 30; h = 44 }
      else if (tc === 'intersection_prop') { svg = svgIntersection('#c62828', 3); w = 30; h = 44 }
      else return null

      if (zoom < 13) return null // hide at low zoom

      const pk = obj.pk_end ? (obj.pk_start + obj.pk_end) / 2 : obj.pk_start
      const pos = getLatLngByPicketage(pickets, pk)
      if (!pos) return null
      const tang = getTangentAngle(pickets, pk)
      // Perpendicular: SVG line is vertical, axis goes horizontal → rotate by tangent
      const deg = tang * 180 / Math.PI
      return { key: `perp-${obj.id}`, obj, pos: pos as LatLng, icon: makeIcon(svg, w, h, deg) }
    }).filter(Boolean) as { key: string; obj: MapObject; pos: LatLng; icon: L.DivIcon }[]
  }, [objects, pickets, zoom, enabledObjectTypes])

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
        // Whiskers at start end
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
      const upper = offsetPolylineLatLngs(axis, offset)
      const lower = offsetPolylineLatLngs(axis, -offset)
      // Cap lines at start and end
      const startCap = getPerpendicularEnds(pickets, pf.pk_start, offset)
      const endCap = getPerpendicularEnds(pickets, pf.pk_end, offset)
      // Two cross lines at 1/3 and 2/3
      const pk1 = pf.pk_start + (pf.pk_end - pf.pk_start) / 3
      const pk2 = pf.pk_start + (pf.pk_end - pf.pk_start) * 2 / 3
      const cross1 = getPerpendicularEnds(pickets, pk1, offset)
      const cross2 = getPerpendicularEnds(pickets, pk2, offset)
      return { pf, upper, lower, startCap, endCap, cross1, cross2, key: `pf-${pf.id}` }
    }).filter(Boolean) as {
      pf: PileField; upper: LatLng[]; lower: LatLng[]; startCap: LatLng[] | null; endCap: LatLng[] | null
      cross1: LatLng[] | null; cross2: LatLng[] | null; key: string
    }[]
  }, [pileFields, pickets, offset, enabledObjectTypes])

  return (
    <>
      {/* ── Perpendicular objects (pipe, overpass, intersection) ── */}
      {perpMarkers.map(({ key, obj, pos, icon }) => (
        <Marker key={key} position={pos} icon={icon} eventHandlers={{ click: () => handleClick(key) }}>
          <Popup>
            <div style={{ minWidth: 160 }}>
              <strong>{obj.name}</strong><br />
              <span style={{ fontSize: 12, color: '#666' }}>{fmtPkRange(obj.pk_start, obj.pk_end)}</span>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* ── Bridges ── */}
      {bridgeData.map(({ obj, upper, lower, whiskers, key }) => (
        <span key={key}>
          <Polyline positions={upper} pathOptions={{ color: '#000', weight: 1.5 }} interactive={false} />
          <Polyline positions={lower} pathOptions={{ color: '#000', weight: 1.5 }} interactive={false} />
          {whiskers.map((w, i) => (
            <Polyline key={`${key}-w${i}`} positions={w} pathOptions={{ color: '#000', weight: 1.2 }} interactive={false} />
          ))}
          {/* Invisible hit area */}
          <Polyline positions={upper} pathOptions={{ color: '#000', weight: 15, opacity: 0 }}
            eventHandlers={{ click: () => handleClick(key) }}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <strong>{obj.name}</strong><br />
                <span style={{ fontSize: 12, color: '#666' }}>Мост · {fmtPkRange(obj.pk_start, obj.pk_end)}</span>
              </div>
            </Popup>
          </Polyline>
        </span>
      ))}

      {/* ── Pile fields ── */}
      {pileData.map(({ pf, upper, lower, startCap, endCap, cross1, cross2, key }) => (
        <span key={key}>
          <Polyline positions={upper} pathOptions={{ color: '#29b6f6', weight: 1.2 }} interactive={false} />
          <Polyline positions={lower} pathOptions={{ color: '#29b6f6', weight: 1.2 }} interactive={false} />
          {startCap && <Polyline positions={startCap} pathOptions={{ color: '#29b6f6', weight: 1.2 }} interactive={false} />}
          {endCap && <Polyline positions={endCap} pathOptions={{ color: '#29b6f6', weight: 1.2 }} interactive={false} />}
          {cross1 && <Polyline positions={cross1} pathOptions={{ color: '#29b6f6', weight: 1 }} interactive={false} />}
          {cross2 && <Polyline positions={cross2} pathOptions={{ color: '#29b6f6', weight: 1 }} interactive={false} />}
          {/* Hit area */}
          <Polyline positions={upper} pathOptions={{ color: '#29b6f6', weight: 15, opacity: 0 }}
            eventHandlers={{ click: () => handleClick(key) }}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <strong>{pf.name || 'Свайное поле'}</strong><br />
                <span style={{ fontSize: 12, color: '#666' }}>{fmtPkRange(pf.pk_start, pf.pk_end)}</span><br />
                <span style={{ fontSize: 12 }}>Свай: {pf.piles_count}</span>
              </div>
            </Popup>
          </Polyline>
        </span>
      ))}
    </>
  )
}
