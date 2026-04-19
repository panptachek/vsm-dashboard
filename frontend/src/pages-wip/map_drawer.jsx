import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, fmt } from './core.jsx';
import { Badge, PageHeader } from './shell.jsx';
import { MOCK } from './mock.js';

export default function WipMapPage(){
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const layerGroupsRef = useRef({});
  const [obj, setObj] = useState(null);
  const [layers, setLayers] = useState({
    bridge:true, putoprovod:true, truba:true, pile:true, crossJds:true, crossBal:true
  });

  useEffect(()=>{
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([58.8, 32.8], 8);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", {
      subdomains:"abcd", maxZoom:19
    }).addTo(map);
    mapRef.current = map;

    // route line
    const route = [
      [55.9, 37.3], [56.4, 36.5], [57.1, 35.2], [57.9, 33.9],
      [58.4, 32.9], [58.8, 32.2], [59.2, 31.2], [59.7, 30.6], [59.93, 30.34]
    ];
    L.polyline(route, { color: "#0a0a0a", weight: 3, opacity: 0.9 }).addTo(map);
    L.polyline(route, { color: "#dc2626", weight: 1, opacity: 0.9, dashArray:"6 6" }).addTo(map);

    // PK markers
    const pkMarkers = [2700, 2800, 2900, 3000, 3100, 3200, 3300];
    pkMarkers.forEach((pk, i) => {
      const t = 0.1 + i*0.13;
      const idx = Math.min(route.length-2, Math.floor(t*(route.length-1)));
      const f = t*(route.length-1) - idx;
      const lat = route[idx][0] + (route[idx+1][0]-route[idx][0])*f;
      const lon = route[idx][1] + (route[idx+1][1]-route[idx][1])*f;
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: "",
          html: '<div style="background:#dc2626;color:#fff;font-family:\'JetBrains Mono\',monospace;font-size:10px;padding:2px 6px;border-radius:2px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.3);">\u041F\u041A'+pk+'</div>',
          iconSize:[52,16], iconAnchor:[26,8]
        })
      }).addTo(map);
    });

    // Objects — group into layer groups by kind
    const COLORS = {
      bridge:"#000000", putoprovod:"#1565c0", truba:"#ef6c00",
      pile:"#29b6f6", crossJds:"#8d6e63", crossBal:"#c62828"
    };
    const groups = {};
    const kinds = ["bridge","putoprovod","truba","pile","crossJds","crossBal"];
    kinds.forEach(k => { groups[k] = L.layerGroup().addTo(map); });

    MOCK.objects.forEach((o, i) => {
      const t = 0.05 + (o.sec-1) * 0.11 + (i%3)*0.03;
      const idx = Math.min(route.length-2, Math.floor(t*(route.length-1)));
      const f = t*(route.length-1) - idx;
      const lat = route[idx][0] + (route[idx+1][0]-route[idx][0])*f + (i%2?0.04:-0.04);
      const lon = route[idx][1] + (route[idx+1][1]-route[idx][1])*f;
      const c = COLORS[o.kind] || "#333";
      const shapeHtml = o.kind === "bridge"
        ? '<div style="width:14px;height:14px;background:'+c+';border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 0 1px #000"/>'
        : o.kind === "pile"
        ? '<div style="width:16px;height:6px;background:'+c+';border:1px solid #fff"/>'
        : '<div style="width:12px;height:12px;background:'+c+';border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,0.3)"/>';
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({ className: "obj-m", html: shapeHtml, iconSize:[16,16], iconAnchor:[8,8] })
      });
      marker.on("click", ()=> setObj(o));
      if (groups[o.kind]) {
        marker.addTo(groups[o.kind]);
      } else {
        marker.addTo(map);
      }
    });

    layerGroupsRef.current = groups;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupsRef.current = {};
    };
  }, []);

  // Sync layer visibility when toggles change
  useEffect(()=>{
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

  const toggleLayer = (k) => setLayers(l => ({...l, [k]: !l[k]}));

  return (
    <div className="wip-shell">
      <div className="map-wrap">
        <aside className="map-sidebar">
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".04em",color:"var(--n-500)",marginBottom:4}}>{"\u0422\u0440\u0430\u0441\u0441\u0430"}</div>
            <div style={{fontSize:13, fontWeight:600}}>{"\u0412\u0421\u0416\u041C-1 \u00B7 3 \u044D\u0442\u0430\u043F"}</div>
            <div className="mono" style={{fontSize:11, color:"var(--n-500)"}}>{"\u041F\u04182641 \u2014 \u041F\u04183325 \u00B7 685 \u043A\u043C"}</div>
          </div>

          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".04em",color:"var(--n-500)",marginBottom:6}}>{"\u0421\u043B\u043E\u0438 \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432"}</div>
            {[
              {k:"bridge", c:"#000000", l:"\u041C\u043E\u0441\u0442\u044B"},
              {k:"putoprovod", c:"#1565c0", l:"\u041F\u0443\u0442\u0435\u043F\u0440\u043E\u0432\u043E\u0434\u044B"},
              {k:"truba", c:"#ef6c00", l:"\u0422\u0440\u0443\u0431\u044B"},
              {k:"pile", c:"#29b6f6", l:"\u0421\u0432\u0430\u0439\u043D\u044B\u0435 \u043F\u043E\u043B\u044F"},
              {k:"crossJds", c:"#8d6e63", l:"\u041F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F \u0416\u0414\u0421"},
              {k:"crossBal", c:"#c62828", l:"\u041F\u0435\u0440\u0435\u0441\u0435\u0447\u0435\u043D\u0438\u044F \u0431\u0430\u043B\u0430\u043D\u0441\u043E\u0434\u0435\u0440\u0436."},
            ].map(r => (
              <div key={r.k} onClick={()=>toggleLayer(r.k)}
                style={{display:"flex", alignItems:"center", gap:8, padding:"5px 4px", cursor:"pointer", opacity:layers[r.k]?1:0.4, fontSize:12, transition:"opacity 0.15s"}}>
                <span style={{width:12,height:12, background:r.c, display:"inline-block", border: r.k==="bridge"?"1px solid #000":"none"}}/>
                <span>{r.l}</span>
                <span style={{marginLeft:"auto", fontFamily:"var(--font-mono)", fontSize:10, color:"var(--n-500)"}}>
                  {MOCK.objects.filter(o=>o.kind===r.k).length}
                </span>
              </div>
            ))}
          </div>

          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".04em",color:"var(--n-500)",marginBottom:6}}>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</div>
            {MOCK.sections.map((s,i)=>(
              <div key={s.id} style={{display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:12}}>
                <span style={{display:"inline-block",width:18, fontFamily:"var(--font-mono)",color:"var(--n-500)"}}>{"\u2116"}{s.id}</span>
                <span className="mono" style={{fontSize:10, color:"var(--n-500)", flex:1}}>{s.pk.replace("\u041F\u041A","")}</span>
                <Badge kind={MOCK.metrics[i].risk}>{MOCK.metrics[i].sand}%</Badge>
              </div>
            ))}
          </div>

          <div style={{fontSize:10, color:"var(--n-500)", borderTop:"1px solid var(--n-100)", paddingTop:10, marginTop:10}}>
            {"\u0412\u0441\u0435\u0433\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432: "}<b className="mono">{MOCK.objects.length}</b><br/>
            {"\u041A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u043F\u043E \u043C\u0435\u0442\u043A\u0435 \u2014 \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0430"}
          </div>
        </aside>
        <div className="map-stage">
          <div ref={mapContainerRef} style={{width:"100%", height:"100%", background:"#eaeaea"}}/>
          {obj && (
            <div style={{
              position:"absolute", right:14, top:14, width:320,
              background:"var(--n-0)", border:"1px solid var(--n-150)",
              borderRadius:6, boxShadow:"var(--shadow-popover)", zIndex:500
            }}>
              <div style={{display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderBottom:"1px solid var(--n-100)"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13, fontWeight:600}}>{obj.name}</div>
                  <div className="mono" style={{fontSize:11, color:"var(--n-500)"}}>{obj.id}</div>
                </div>
                <button className="btn ghost icon" onClick={()=>setObj(null)}><Icon name="close" size={14}/></button>
              </div>
              <div style={{padding:"10px 12px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:12}}>
                <div><div style={{color:"var(--n-500)",fontSize:10,textTransform:"uppercase"}}>{"\u041F\u0438\u043A\u0435\u0442\u0430\u0436"}</div><div className="mono">{obj.pk}</div></div>
                <div><div style={{color:"var(--n-500)",fontSize:10,textTransform:"uppercase"}}>{"\u0414\u043B\u0438\u043D\u0430"}</div><div className="mono">{obj.length} {"\u043C"}</div></div>
                <div><div style={{color:"var(--n-500)",fontSize:10,textTransform:"uppercase"}}>{"\u0421\u0432\u0430\u0438"}</div><div className="mono">{obj.piles}</div></div>
                <div><div style={{color:"var(--n-500)",fontSize:10,textTransform:"uppercase"}}>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</div><div className="mono">{"\u2116"}{obj.sec}</div></div>
              </div>
              <div style={{padding:"10px 12px", borderTop:"1px solid var(--n-100)", display:"flex", alignItems:"center", gap:8}}>
                <Badge kind={obj.status==="\u0433\u043E\u0442\u043E\u0432"?"good":obj.status==="\u043E\u0442\u0441\u0442\u0430\u0432\u0430\u043D\u0438\u0435"?"bad":"warn"}>{obj.status}</Badge>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
