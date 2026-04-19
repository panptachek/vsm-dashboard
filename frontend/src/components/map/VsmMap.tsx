import { useState, useMemo, useCallback, useEffect } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'

import type { Picket, Section, MapObject, PileField, ObjectTypeKey } from '../../types/geo'
import { TrassaLayer } from './TrassaLayer'
import { PicketMarkers } from './PicketMarkers'
import { SectionHighlight } from './SectionHighlight'
import { ObjectsLayer } from './ObjectsLayer'
import { MapControls } from './MapControls'

// ---------------------------------------------------------------------------
// API fetchers
// ---------------------------------------------------------------------------

async function fetchPickets(): Promise<Picket[]> {
  const res = await fetch('/api/geo/pickets')
  if (!res.ok) throw new Error(`Failed to fetch pickets: ${res.status}`)
  return res.json()
}

async function fetchSections(): Promise<Section[]> {
  const res = await fetch('/api/geo/sections')
  if (!res.ok) throw new Error(`Failed to fetch sections: ${res.status}`)
  const raw = await res.json()
  // Group by code to build ranges array (some sections have multiple version rows)
  const byCode = new Map<string, Section>()
  for (const r of raw) {
    if (!r.pk_start || !r.pk_end) continue
    const pkS = Number(r.pk_start) / 100
    const pkE = Number(r.pk_end) / 100
    if (!byCode.has(r.code)) {
      byCode.set(r.code, {
        id: 0, code: r.code, name: r.name, map_color: r.map_color || '#64748b',
        pk_start: pkS, pk_end: pkE, ranges: [[pkS, pkE]],
      })
    } else {
      const sec = byCode.get(r.code)!
      sec.ranges.push([pkS, pkE])
      sec.pk_start = Math.min(sec.pk_start, pkS)
      sec.pk_end = Math.max(sec.pk_end, pkE)
    }
  }
  return Array.from(byCode.values())
}

async function fetchObjects(): Promise<MapObject[]> {
  const res = await fetch('/api/geo/objects')
  if (!res.ok) throw new Error(`Failed to fetch objects: ${res.status}`)
  const raw = await res.json()
  // Transform API shape (type_code, object_code) to component shape (type, name)
  const typeMap: Record<string, MapObject['type']> = {
    PIPE: 'pipe', OVERPASS: 'overpass', BRIDGE: 'bridge',
    INTERSECTION_FIN: 'intersection_fin', INTERSECTION_PROP: 'intersection_prop',
  }
  return raw
    .filter((o: Record<string, unknown>) => o.pk_start != null)
    .map((o: Record<string, unknown>) => ({
      id: o.object_code,
      type: typeMap[o.type_code as string] ?? 'pipe',
      name: o.name ?? o.object_code,
      pk_start: Number(o.pk_start) / 100,  // DB stores as decimal ПК*100+offset → convert to PK number
      pk_end: o.pk_end != null ? Number(o.pk_end) / 100 : null,
      description: o.type_name ?? null,
      section_code: null,
      network_name: (o.network_name as string) ?? null,
      owner: (o.owner as string) ?? null,
      length_m: o.length_m != null ? Number(o.length_m) : null,
    })) as MapObject[]
}

async function fetchPileFields(): Promise<PileField[]> {
  const res = await fetch('/api/geo/pile-fields')
  if (!res.ok) throw new Error(`Failed to fetch pile fields: ${res.status}`)
  const raw = await res.json()
  return raw
    .filter((p: Record<string, unknown>) => p.pk_start != null && p.pk_end != null)
    .map((p: Record<string, unknown>) => ({
      id: p.field_code ?? p.pk_start,
      section_number: 0,
      piles_count: Number(p.pile_count) || 0,
      pk_start: Number(p.pk_start) / 100,
      pk_end: Number(p.pk_end) / 100,
      name: p.field_code ? `Свайное поле ${p.field_code}` : null,
    })) as PileField[]
}

// ---------------------------------------------------------------------------
// Zoom tracker (inner component that uses useMapEvents)
// ---------------------------------------------------------------------------

function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom())
    },
  })

  useEffect(() => {
    onZoomChange(map.getZoom())
  }, [map, onZoomChange])

  return null
}

// ---------------------------------------------------------------------------
// Default center and zoom (midpoint of the route)
// ---------------------------------------------------------------------------

const DEFAULT_CENTER: [number, number] = [58.14, 33.55]
const DEFAULT_ZOOM = 9

const TILE_URL =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VsmMap() {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Object type visibility filters (all enabled by default)
  const ALL_OBJECT_TYPES: ObjectTypeKey[] = ['pipe', 'overpass', 'bridge', 'pile_field', 'intersection_fin', 'intersection_prop']
  const [enabledObjectTypes, setEnabledObjectTypes] = useState<Set<ObjectTypeKey>>(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('objects')
    if (raw) {
      const keys = raw.split(',').filter((k): k is ObjectTypeKey => ALL_OBJECT_TYPES.includes(k as ObjectTypeKey))
      return new Set(keys)
    }
    return new Set(ALL_OBJECT_TYPES)
  })

  const handleToggleObjectType = useCallback((key: ObjectTypeKey) => {
    setEnabledObjectTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Data queries
  const {
    data: pickets = [],
    isLoading: picketsLoading,
  } = useQuery<Picket[]>({
    queryKey: ['geo-pickets'],
    queryFn: fetchPickets,
    staleTime: 5 * 60_000,
  })

  const {
    data: sections = [],
    isLoading: sectionsLoading,
  } = useQuery<Section[]>({
    queryKey: ['geo-sections'],
    queryFn: fetchSections,
    staleTime: 5 * 60_000,
  })

  const { data: objects = [] } = useQuery<MapObject[]>({
    queryKey: ['geo-objects'],
    queryFn: fetchObjects,
    staleTime: 5 * 60_000,
  })

  const { data: pileFields = [] } = useQuery<PileField[]>({
    queryKey: ['geo-pile-fields'],
    queryFn: fetchPileFields,
    staleTime: 5 * 60_000,
  })

  // Compute bounds from pickets
  const bounds = useMemo(() => {
    if (pickets.length === 0) return null
    const lats = pickets.map((p) => p.latitude)
    const lngs = pickets.map((p) => p.longitude)
    return [
      [Math.min(...lats), Math.min(...lngs)] as [number, number],
      [Math.max(...lats), Math.max(...lngs)] as [number, number],
    ] as [[number, number], [number, number]]
  }, [pickets])

  // Compute highlight ranges for active section
  const highlightRanges = useMemo<[number, number][] | undefined>(() => {
    if (!activeSection) return undefined
    const sec = sections.find((s) => s.code === activeSection)
    if (!sec) return undefined
    return sec.ranges ?? [[sec.pk_start, sec.pk_end]]
  }, [activeSection, sections])

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
  }, [])

  const isLoading = picketsLoading || sectionsLoading

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-red border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-muted">
              Загрузка карты...
            </span>
          </div>
        </div>
      )}

      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        bounds={bounds ?? undefined}
        boundsOptions={{ padding: [30, 30] }}
        className="w-full h-full"
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          maxZoom={19}
          subdomains="abc"
        />

        <ZoomTracker onZoomChange={handleZoomChange} />

        {/* Section highlight (below route) */}
        {sections.length > 0 && pickets.length > 0 && (
          <SectionHighlight
            pickets={pickets}
            sections={sections}
            activeSection={activeSection}
          />
        )}

        {/* Route polyline */}
        {pickets.length >= 2 && (
          <TrassaLayer
            pickets={pickets}
            highlightRanges={highlightRanges}
          />
        )}

        {/* Picket marks */}
        {pickets.length >= 2 && (
          <PicketMarkers
            pickets={pickets}
            zoom={zoom}
            highlightRanges={highlightRanges}
          />
        )}

        {/* Objects */}
        {pickets.length >= 2 && (objects.length > 0 || pileFields.length > 0) && (
          <ObjectsLayer
            pickets={pickets}
            objects={objects}
            pileFields={pileFields}
            zoom={zoom}
            enabledObjectTypes={enabledObjectTypes}
          />
        )}

        {/* Controls overlay */}
        {pickets.length > 0 && sections.length > 0 && (
          <MapControls
            pickets={pickets}
            sections={sections}
            activeSection={activeSection}
            onSectionSelect={setActiveSection}
            enabledObjectTypes={enabledObjectTypes}
            onToggleObjectType={handleToggleObjectType}
          />
        )}
      </MapContainer>
    </div>
  )
}
