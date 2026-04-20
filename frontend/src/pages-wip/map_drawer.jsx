import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, fmt, fetchJson } from './core.jsx';
import { Badge, PageHeader } from './shell.jsx';

function LoadingSkeleton() {
  return <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--n-400)", background: "#eaeaea" }}>Загрузка карты...</div>;
}

export default function WipMapPage() {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const layerGroupsRef = useRef({});
  const [obj, setObj] = useState(null);
  const [objects, setObjects] = useState([]);
  const [sections, setSections] = useState([]);
  const [pickets, setPickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState({
    OVERPASS: true, BRIDGE: true, CULVERT: true, ISSO: true,
    INTERSECTION_PROP: true, INTERSECTION_FIN: true
  });

  useEffect(() => {
    Promise.all([
      fetchJson('/api/geo/objects').catch(() => []),
      fetchJson('/api/geo/sections').catch(() => []),
      fetchJson('/api/geo/pickets').catch(() => []),
    ]).then(([objs, secs, pks]) => {
      setObjects(Array.isArray(objs) ? objs : []);
      setSections(Array.isArray(secs) ? secs : []);
      setPickets(Array.isArray(pks) ? pks : []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || mapRef.current) return;
    if (!mapContainerRef.current) return;

    // Find center from pickets
    const validPks = pickets.filter(p => p.latitude && p.longitude);
    const center = validPks.length > 0
      ? [validPks.reduce((s, p) => s + p.latitude, 0) / validPks.length,
         validPks.reduce((s, p) => s + p.longitude, 0) / validPks.length]
      : [58.5, 32.1];

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView(center, 9);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", {
      subdomains: "abcd", maxZoom: 19
    }).addTo(map);
    mapRef.current = map;

    // Route line from pickets
    const routePoints = validPks
      .sort((a, b) => (a.pk_number || 0) - (b.pk_number || 0))
      .map(p => [p.latitude, p.longitude]);
    if (routePoints.length > 1) {
      L.polyline(routePoints, { color: "#dc2626", weight: 3, opacity: 0.9 }).addTo(map);
    }

    // PK markers (every 100 PK)
    validPks.filter(p => p.pk_number && p.pk_number % 100 === 0).forEach(p => {
      const pk = Math.round(p.pk_number / 100);
      L.marker([p.latitude, p.longitude], {
        icon: L.divIcon({
          className: "",
          html: '<div style="background:#dc2626;color:#fff;font-family:monospace;font-size:10px;padding:2px 6px;border-radius:2px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.3);">\u041F\u041A' + pk + '</div>',
          iconSize: [52, 16], iconAnchor: [26, 8]
        })
      }).addTo(map);
    });

    // Objects by type
    const COLORS = {
      OVERPASS: "#1565c0", BRIDGE: "#000000", CULVERT: "#ef6c00", ISSO: "#29b6f6",
      INTERSECTION_PROP: "#8d6e63", INTERSECTION_FIN: "#c62828"
    };
    const groups = {};
    Object.keys(COLORS).forEach(k => { groups[k] = L.layerGroup().addTo(map); });

    objects.filter(o => o.start_lat && o.start_lng).forEach(o => {
      const kind = o.type_code || 'ISSO';
      const c = COLORS[kind] || "#333";
      const marker = L.marker([o.start_lat, o.start_lng], {
        icon: L.divIcon({
          className: "obj-m",
          html: '<div style="width:12px;height:12px;background:' + c + ';border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,0.3)"/>',
          iconSize: [16, 16], iconAnchor: [8, 8]
        })
      });
      marker.on("click", () => setObj(o));
      if (groups[kind]) marker.addTo(groups[kind]);
      else marker.addTo(map);
    });

    layerGroupsRef.current = groups;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupsRef.current = {};
    };
  }, [loading, objects, pickets]);

  useEffect(() => {
    const map = mapRef.current;
    const groups = layerGroupsRef.current;
    if (!map) return;
    Object.keys(groups).forEach(k => {
      if (layers[k]) {
        if (!map.hasLayer(groups[k])) map.addLayer(groups[k]);
      } else {
        if (map.hasLayer(groups[k])) map.removeLayer(groups[k]);
      }
    });
  }, [layers]);

  const toggleLayer = (k) => setLayers(l => ({ ...l, [k]: !l[k] }));

  const LAYER_LABELS = {
    OVERPASS: "\u041F\u0443\u0442\u0435\u043F\u0440\u043E\u0432\u043E\u0434\u044B",
    BRIDGE: "\u041C\u043E\u0441\u0442\u044B",
    CULVERT: "\u0422\u0440\u0443\u0431\u044B",
    ISSO: "\u0418\u0421\u0421\u041E",
    INTERSECTION_PROP: "\u041F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F (\u0438\u043C\u0443\u0449.)",
    INTERSECTION_FIN: "\u041F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F (\u0444\u0438\u043D.)",
  };
  const COLORS_MAP = {
    OVERPASS: "#1565c0", BRIDGE: "#000000", CULVERT: "#ef6c00", ISSO: "#29b6f6",
    INTERSECTION_PROP: "#8d6e63", INTERSECTION_FIN: "#c62828"
  };

  return (
    <div className="wip-shell">
      <div className="map-wrap">
        <aside className="map-sidebar">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--n-500)", marginBottom: 4 }}>{"\u0422\u0440\u0430\u0441\u0441\u0430"}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{"\u0412\u0421\u0416\u041C-1 \u00B7 3 \u044D\u0442\u0430\u043F"}</div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--n-500)", marginBottom: 6 }}>{"\u0421\u043B\u043E\u0438 \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432"}</div>
            {Object.keys(LAYER_LABELS).map(k => (
              <div key={k} onClick={() => toggleLayer(k)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer", opacity: layers[k] ? 1 : 0.4, fontSize: 12, transition: "opacity 0.15s" }}>
                <span style={{ width: 12, height: 12, background: COLORS_MAP[k], display: "inline-block" }} />
                <span>{LAYER_LABELS[k]}</span>
                <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--n-500)" }}>
                  {objects.filter(o => o.type_code === k).length}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--n-500)", marginBottom: 6 }}>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</div>
            {sections.filter(s => s.pk_start).map(s => (
              <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                <span style={{ display: "inline-block", width: 18, fontFamily: "var(--font-mono)", color: "var(--n-500)" }}>{s.code.replace("UCH_","")}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--n-500)", flex: 1 }}>{s.name}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: "var(--n-500)", borderTop: "1px solid var(--n-100)", paddingTop: 10, marginTop: 10 }}>
            {"\u0412\u0441\u0435\u0433\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432: "}<b className="mono">{objects.length}</b>
          </div>
        </aside>
        <div className="map-stage">
          {loading ? <LoadingSkeleton /> : <div ref={mapContainerRef} style={{ width: "100%", height: "100%", background: "#eaeaea" }} />}
          {obj && (
            <div style={{
              position: "absolute", right: 14, top: 14, width: 320,
              background: "var(--n-0)", border: "1px solid var(--n-150)",
              borderRadius: 6, boxShadow: "var(--shadow-popover)", zIndex: 500
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--n-100)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{obj.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--n-500)" }}>{obj.object_code}</div>
                </div>
                <button className="btn ghost icon" onClick={() => setObj(null)}><Icon name="close" size={14} /></button>
              </div>
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                <div><div style={{ color: "var(--n-500)", fontSize: 10, textTransform: "uppercase" }}>{"\u041F\u0438\u043A\u0435\u0442\u0430\u0436"}</div><div className="mono">{obj.pk_raw_text || "\u2014"}</div></div>
                <div><div style={{ color: "var(--n-500)", fontSize: 10, textTransform: "uppercase" }}>{"\u0422\u0438\u043F"}</div><div className="mono">{obj.type_name || obj.type_code}</div></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
