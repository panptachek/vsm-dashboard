import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
         AreaChart, Area, Legend,
         PieChart, Pie, Cell } from 'recharts';
import { Icon, fmt, riskCls, trendArrow, useToast, downloadPdf, fetchJson } from './core.jsx';
import { ProgressRow, Kpi, Badge, PageHeader, FilterBar } from './shell.jsx';
import { MOCK } from './mock.js';

function SectionCard({ sec, m, onOpen }){
  return (
    <div className="card" style={{cursor:"pointer"}} onClick={()=>onOpen && onOpen(sec.id)}>
      <div className="card-h">
        <div>
          <h3>{sec.title}</h3>
          <div className="sub">{sec.pk}</div>
        </div>
        <div className="actions"><Badge kind={m.risk}>{m.risk==="good"?"\u0432 \u043F\u043B\u0430\u043D\u0435":m.risk==="warn"?"\u0440\u0438\u0441\u043A":"\u043E\u0442\u0441\u0442\u0430\u0432\u0430\u043D\u0438\u0435"}</Badge></div>
      </div>
      <div className="card-b" style={{paddingTop:10}}>
        <ProgressRow label={"\u041F\u0435\u0441\u043E\u043A"}        val={m.sand}      trend={sec.id%2===0?1:0}/>
        <ProgressRow label={"\u0429\u041F\u0413\u0421"}         val={m.shpgs}     trend={sec.id%3===0?-1:0}/>
        <ProgressRow label={"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}    val={m.pileMain}  trend={sec.id%2?1:0}/>
        <ProgressRow label={"\u0421\u0432\u0430\u0438 \u043F\u0440\u043E\u0431\u043D."}  val={m.pileTrial} trend={0}/>
        <div style={{marginTop:12, paddingTop:10, borderTop:"1px solid var(--n-75)",
                     display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 12px",
                     fontSize:11, color:"var(--n-700)"}}>
          <div><span style={{color:"var(--n-500)", fontSize:10, textTransform:"uppercase", letterSpacing:".06em"}}>{"\u041F\u0435\u0441\u043E\u043A\u00B724\u0447"}</span><div style={{fontFamily:"var(--font-display)", fontSize:15, fontWeight:600}}>{fmt(m.sand24)} <span style={{fontSize:10, color:"var(--n-500)"}}>{"\u043C\u00B3"}</span></div></div>
          <div><span style={{color:"var(--n-500)", fontSize:10, textTransform:"uppercase", letterSpacing:".06em"}}>{"\u0429\u041F\u0413\u0421\u00B724\u0447"}</span><div style={{fontFamily:"var(--font-display)", fontSize:15, fontWeight:600}}>{fmt(m.shpgs24)} <span style={{fontSize:10, color:"var(--n-500)"}}>{"\u043C\u00B3"}</span></div></div>
          <div><span style={{color:"var(--n-500)", fontSize:10, textTransform:"uppercase", letterSpacing:".06em"}}>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}</span><div style={{fontFamily:"var(--font-display)", fontSize:15, fontWeight:600}}>{m.pMain24} <span style={{fontSize:10, color:"var(--n-500)"}}>{"\u0448\u0442"}</span></div></div>
          <div><span style={{color:"var(--n-500)", fontSize:10, textTransform:"uppercase", letterSpacing:".06em"}}>{"\u0421\u0432\u0430\u0438 \u043F\u0440."}</span><div style={{fontFamily:"var(--font-display)", fontSize:15, fontWeight:600}}>{m.pTr24} <span style={{fontSize:10, color:"var(--n-500)"}}>{"\u0448\u0442"}</span></div></div>
        </div>
        <div style={{marginTop:10, display:"flex", alignItems:"center", gap:6, fontSize:11, color: m.issues ? "var(--danger)" : "var(--n-500)"}}>
          {m.issues>0 ? <><Icon name="alert" size={12}/> {m.issues} {m.issues===1?"\u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0430":"\u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B"} {"\u043D\u0430 \u0441\u043C\u0435\u043D\u0435"}</> : <>{"\u0417\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u043D\u0435\u0442"}</>}
        </div>
      </div>
    </div>
  );
}

function SectionTable({ onOpen }){
  return (
    <div className="card" style={{overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}>
        <table className="tbl">
          <thead><tr>
            <th>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</th><th>{"\u041F\u0438\u043A\u0435\u0442\u0430\u0436"}</th>
            <th className="num">{"\u041F\u0435\u0441\u043E\u043A"}</th><th className="num">{"\u0429\u041F\u0413\u0421"}</th>
            <th className="num">{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}</th><th className="num">{"\u0421\u0432\u0430\u0438 \u043F\u0440."}</th>
            <th className="num">{"\u041F\u0435\u0441\u043E\u043A 24\u0447"}</th><th className="num">{"\u0429\u041F\u0413\u0421 24\u0447"}</th>
            <th className="num">{"\u041F\u0440\u043E\u0431\u043B."}</th><th>{"\u0421\u0442\u0430\u0442\u0443\u0441"}</th><th></th>
          </tr></thead>
          <tbody>
            {MOCK.sections.map((s,i)=>{
              const m = MOCK.metrics[i];
              return (
                <tr key={s.id} onClick={()=>onOpen && onOpen(s.id)} style={{cursor:"pointer"}}>
                  <td style={{fontWeight:600}}>{s.title}</td>
                  <td className="mono" style={{color:"var(--n-500)"}}>{s.pk}</td>
                  <td className="num"><div style={{display:"inline-flex",alignItems:"center",gap:6, justifyContent:"flex-end"}}><div className="progress" style={{width:60}}><div className={"bar "+riskCls(m.sand)} style={{width:m.sand+"%"}}/></div><span style={{width:30}}>{m.sand}%</span></div></td>
                  <td className="num"><div style={{display:"inline-flex",alignItems:"center",gap:6, justifyContent:"flex-end"}}><div className="progress" style={{width:60}}><div className={"bar "+riskCls(m.shpgs)} style={{width:m.shpgs+"%"}}/></div><span style={{width:30}}>{m.shpgs}%</span></div></td>
                  <td className="num">{m.pileMain}%</td>
                  <td className="num">{m.pileTrial}%</td>
                  <td className="num">{fmt(m.sand24)}</td>
                  <td className="num">{fmt(m.shpgs24)}</td>
                  <td className="num">{m.issues || "\u2014"}</td>
                  <td><Badge kind={m.risk}>{m.risk==="good"?"\u0432 \u043F\u043B\u0430\u043D\u0435":m.risk==="warn"?"\u0440\u0438\u0441\u043A":"\u043E\u0442\u0441\u0442\u0430\u0432\u0430\u043D\u0438\u0435"}</Badge></td>
                  <td><Icon name="chevronRight" size={14}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionChartsView({ onOpen }){
  const data = MOCK.sections.map((s,i)=>({
    name:"\u2116"+s.id, "\u041F\u0435\u0441\u043E\u043A": MOCK.metrics[i].sand, "\u0429\u041F\u0413\u0421": MOCK.metrics[i].shpgs, "\u0421\u0432\u0430\u0438 \u043E\u0441\u043D.": MOCK.metrics[i].pileMain, id: s.id
  }));
  return (
    <div className="card">
      <div className="card-h"><h3>{"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}</h3><div className="sub">{"\u0025 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u043D\u0430"}</div>
        <div className="actions">
          <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:"var(--n-500)"}}>
            <span style={{width:10,height:10,background:"#1a1a1a",borderRadius:2}}/>{"\u041F\u0435\u0441\u043E\u043A"}
            <span style={{width:10,height:10,background:"#9ca3af",borderRadius:2,marginLeft:8}}/>{"\u0429\u041F\u0413\u0421"}
            <span style={{width:10,height:10,background:"var(--accent-red)",borderRadius:2,marginLeft:8}}/>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}
          </span>
        </div>
      </div>
      <div className="card-b" style={{height: 340}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="22%" onClick={(e)=> e && e.activePayload && onOpen && onOpen(e.activePayload[0].payload.id)}>
            <CartesianGrid strokeDasharray="2 4" stroke="#e7e7e7" vertical={false}/>
            <XAxis dataKey="name" tick={{fontSize:11, fill:"#6b6b6b", fontFamily:"Saira"}} axisLine={{stroke:"#e7e7e7"}} tickLine={false}/>
            <YAxis tick={{fontSize:11, fill:"#6b6b6b", fontFamily:"Saira"}} axisLine={false} tickLine={false} domain={[0,100]} unit="%"/>
            <Tooltip contentStyle={{fontSize:12, border:"1px solid #e7e7e7", borderRadius:8, padding:"8px 10px", boxShadow:"0 4px 12px rgba(0,0,0,0.08)"}} cursor={{fill:"rgba(0,0,0,0.04)"}}/>
            <Bar dataKey={"\u041F\u0435\u0441\u043E\u043A"} fill="#1a1a1a" radius={[6,6,0,0]}/>
            <Bar dataKey={"\u0429\u041F\u0413\u0421"} fill="#9ca3af" radius={[6,6,0,0]}/>
            <Bar dataKey={"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."} fill="var(--accent-red)" radius={[6,6,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TrendChart(){
  return (
    <div className="card">
      <div className="card-h"><h3>{"\u041E\u0431\u044A\u0451\u043C\u044B \u043F\u0435\u0440\u0435\u0432\u043E\u0437\u043E\u043A \u043F\u0435\u0441\u043A\u0430 \u00B7 30 \u0434\u043D\u0435\u0439"}</h3><div className="sub">{"\u043C\u00B3 / \u0441\u0443\u0442\u043A\u0438 \u00B7 \u043F\u043E \u043A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442\u0430\u043C"}</div></div>
      <div className="card-b" style={{height: 240}}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={MOCK.trendDays}>
            <defs>
              <linearGradient id="wip-gOwn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a1a1a" stopOpacity={0.9}/><stop offset="100%" stopColor="#1a1a1a" stopOpacity={0.6}/></linearGradient>
              <linearGradient id="wip-gAlma" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dc2626" stopOpacity={0.9}/><stop offset="100%" stopColor="#dc2626" stopOpacity={0.6}/></linearGradient>
              <linearGradient id="wip-gHire" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9ca3af" stopOpacity={0.9}/><stop offset="100%" stopColor="#9ca3af" stopOpacity={0.55}/></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#e7e7e7" vertical={false}/>
            <XAxis dataKey="date" tick={{fontSize:10, fill:"#6b6b6b", fontFamily:"Saira"}} axisLine={{stroke:"#e7e7e7"}} tickLine={false} interval={3}/>
            <YAxis tick={{fontSize:10, fill:"#6b6b6b", fontFamily:"Saira"}} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{fontSize:12, border:"1px solid #e7e7e7", borderRadius:8, padding:"8px 10px", boxShadow:"0 4px 12px rgba(0,0,0,0.08)"}}/>
            <Legend wrapperStyle={{fontSize:11, fontFamily:"Saira"}}/>
            <Area type="monotone" stackId="1" dataKey="own"  name={"\u0421\u043E\u0431\u0441\u0442\u0432. \u0441\u0438\u043B\u044B"} stroke="#1a1a1a" strokeWidth={1.5} fill="url(#wip-gOwn)"/>
            <Area type="monotone" stackId="1" dataKey="alma" name={"\u041E\u041E\u041E \u0410\u041B\u041C\u0410"}     stroke="#dc2626" strokeWidth={1.5} fill="url(#wip-gAlma)"/>
            <Area type="monotone" stackId="1" dataKey="hire" name={"\u041D\u0430\u0451\u043C\u043D\u044B\u0435"}      stroke="#9ca3af" strokeWidth={1.5} fill="url(#wip-gHire)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SandBreakdownCard(){
  const t = MOCK.sandTotals;
  const pieData = [
    { name:"\u0421\u043E\u0431\u0441\u0442\u0432. \u0441\u0438\u043B\u044B", value:t.own,  color:"#1a1a1a" },
    { name:"\u041E\u041E\u041E \u0410\u041B\u041C\u0410",     value:t.alma, color:"#dc2626" },
    { name:"\u041D\u0430\u0451\u043C\u043D\u044B\u0435",      value:t.hire, color:"#9ca3af" },
  ];
  const pct = (v) => Math.round(v / t.total * 100);
  return (
    <div className="card">
      <div className="card-h"><h3>{"\u0412\u043E\u0437\u043A\u0430 \u043F\u0435\u0441\u043A\u0430 \u00B7 24\u0447"}</h3><div className="sub">{"\u0440\u0430\u0437\u0431\u0438\u0432\u043A\u0430 \u043F\u043E \u043A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442\u0430\u043C"}</div></div>
      <div className="card-b" style={{display:"grid", gridTemplateColumns:"140px 1fr", gap:14, alignItems:"center"}}>
        <div style={{height:140, position:"relative"}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={2} stroke="none">
                {pieData.map((d,i)=><Cell key={i} fill={d.color}/>)}
              </Pie>
              <Tooltip contentStyle={{fontSize:11, border:"1px solid #e7e7e7", borderRadius:6, padding:"6px 8px"}} formatter={v=>fmt(v)+" \u043C\u00B3"}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{position:"absolute", inset:0, display:"grid", placeItems:"center", pointerEvents:"none"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"var(--font-display)", fontSize:18, fontWeight:700, lineHeight:1}}>{fmt(t.total)}</div>
              <div style={{fontSize:9, color:"var(--n-500)", textTransform:"uppercase", letterSpacing:".08em", marginTop:2}}>{"\u043C\u00B3 \u0432\u0441\u0435\u0433\u043E"}</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          {pieData.map((d,i)=>(
            <div key={i}>
              <div style={{display:"flex", alignItems:"center", gap:8, fontSize:12}}>
                <span style={{width:10, height:10, background:d.color, borderRadius:3}}/>
                <span style={{flex:1}}>{d.name}</span>
                <span style={{fontFamily:"var(--font-display)", fontWeight:600}}>{fmt(d.value)}</span>
                <span className="mono" style={{color:"var(--n-500)", fontSize:11, width:36, textAlign:"right"}}>{pct(d.value)}%</span>
              </div>
              <div className="progress" style={{marginTop:3, height:4}}>
                <div className="bar" style={{width:pct(d.value)+"%", background:d.color, borderRadius:999}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IssuesList({ onViewAll }){
  return (
    <div className="card">
      <div className="card-h"><h3>{"\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B"}</h3><div className="sub">{"\u043D\u0430 \u0441\u043C\u0435\u043D\u0435 \u0438 \u0437\u0430 48 \u0447\u0430\u0441\u043E\u0432"}</div>
        <div className="actions"><button className="btn ghost sm" onClick={onViewAll}>{"\u0412\u0441\u0435 \u2192"}</button></div></div>
      <div style={{maxHeight:360, overflow:"auto"}}>
        {MOCK.issues.map(iss => (
          <div key={iss.id} style={{padding:"10px 14px", borderBottom:"1px solid var(--n-75)", display:"flex", alignItems:"flex-start", gap:10}}>
            <span className={"dot " + (iss.sev==="bad"?"bad":"warn")} style={{marginTop:6}}/>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:12, lineHeight:1.4, color:"var(--n-900)"}}>{iss.title}</div>
              <div style={{marginTop:4, display:"flex", gap:8, fontSize:11, color:"var(--n-500)", fontFamily:"var(--font-mono)"}}>
                <span>{iss.id}</span><span>{"\u00B7"}</span><span>{"\u0423\u0447. \u2116"}{iss.sec}</span><span>{"\u00B7"}</span><span>{iss.kind}</span>
                <span style={{marginLeft:"auto"}}>{iss.ago}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ data, color="#dc2626" }){
  const w = 120, h = 26;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v,i)=>[i*(w/(data.length-1)), h - ((v-min)/(max-min||1))*h]);
  const path = pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const area = path + " L"+w+","+h+" L0,"+h+" Z";
  return (
    <svg width="100%" height={h} viewBox={"0 0 "+w+" "+h} preserveAspectRatio="none" style={{display:"block"}}>
      <path d={area} fill={color} opacity="0.12"/>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.2" fill={color}/>
    </svg>
  );
}

function KpiWithSpark({ label, value, unit, delta, data, color, kind }){
  const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <div className={"kpi "+(kind||"")}>
      <div className="label">{label}</div>
      <div className="value">{fmt(value)}<span className="unit">{unit}</span></div>
      <div className={"delta "+cls}>{delta!=null && <>{delta>0?"\u25B2":delta<0?"\u25BC":"\u2014"} {Math.abs(delta)}%</>}</div>
      {data && <div className="sparkline"><Sparkline data={data} color={color}/></div>}
    </div>
  );
}

export default function WipOverviewPage(){
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("cards");
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const o = MOCK.overall;
  const sandSpark = MOCK.trendDays.slice(-14).map(d=>d.sand);
  const shpgsSpark = MOCK.trendDays.slice(-14).map(d=>d.shpgs);
  const almaSpark = MOCK.trendDays.slice(-14).map(d=>d.alma);

  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const filters = { date, sectionsFilter, workFilter };
  const setFilters = {
    setDate, setSectionsFilter, setWorkFilter,
    onReset: () => { setSectionsFilter([]); setWorkFilter([]); },
    onStub: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportCsv: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportPdf: () => handlePdf(),
  };

  const onOpenSection = useCallback((id) => {
    navigate("/sections/UCH_" + id);
  }, [navigate]);

  const handlePdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadPdf('/api/pdf/analytics', { date }, "VSM_\u041E\u0431\u0437\u043E\u0440_" + date + ".pdf");
      toast.show("PDF \u0441\u043A\u0430\u0447\u0430\u043D");
    } catch (e) {
      toast.show("\u041E\u0448\u0438\u0431\u043A\u0430 PDF: " + (e.message || e));
    } finally {
      setPdfLoading(false);
    }
  }, [date]);

  const handleExport = useCallback(() => {
    toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435");
  }, []);

  return (
    <div className="wip-shell">
      <div className="page">
        <PageHeader title={"\u041E\u0431\u0437\u043E\u0440 (WIP)"}
          subtitle={"685 \u043A\u043C \u00B7 \u041F\u04182641 \u2014 \u041F\u04183325 \u00B7 8 \u0443\u0447\u0430\u0441\u0442\u043A\u043E\u0432 \u00B7 " + new Date().toLocaleDateString("ru-RU",{day:"2-digit",month:"long",year:"numeric"})}
          actions={<>
            <div className="segmented">
              <button className={viewMode==="cards"?"on":""} onClick={()=>setViewMode("cards")}>{"\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438"}</button>
              <button className={viewMode==="table"?"on":""} onClick={()=>setViewMode("table")}>{"\u0422\u0430\u0431\u043B\u0438\u0446\u0430"}</button>
              <button className={viewMode==="charts"?"on":""} onClick={()=>setViewMode("charts")}>{"\u0413\u0440\u0430\u0444\u0438\u043A\u0438"}</button>
            </div>
            <button className="btn" onClick={handleExport}><Icon name="download" size={14}/>{"\u042D\u043A\u0441\u043F\u043E\u0440\u0442"}</button>
            <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14}/>{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF"}</button>
          </>}/>
        <FilterBar {...filters} {...setFilters}/>

        <div style={{display:"grid", gridTemplateColumns:"repeat(5, minmax(0,1fr))", gap:12, marginBottom:14}}>
          <KpiWithSpark label={"\u041F\u0435\u0441\u043E\u043A \u00B7 24\u0447"} value={o.sand24} unit={"\u043C\u00B3"} delta={+12} data={sandSpark} color="#1a1a1a" kind="accent"/>
          <KpiWithSpark label={"\u041E\u041E\u041E \u0410\u041B\u041C\u0410 \u00B7 24\u0447"} value={MOCK.sandTotals.alma} unit={"\u043C\u00B3"} delta={+8} data={almaSpark} color="#dc2626"/>
          <KpiWithSpark label={"\u0429\u041F\u0413\u0421 \u00B7 24\u0447"} value={o.shpgs24} unit={"\u043C\u00B3"} delta={-6} data={shpgsSpark} color="#6b6b6b"/>
          <KpiWithSpark label={"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D \u00B7 24\u0447"} value={o.pMain24} unit={"\u0448\u0442"} delta={+3}/>
          <KpiWithSpark label={"\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u044B"} value={o.issues} unit="" delta={+2} kind="bad"/>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"minmax(0,1fr) 340px", gap:14}}>
          <div style={{minWidth:0}}>
            {viewMode === "cards" && (<>
              <div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</h2><div className="hint">{"8 \u00B7 \u043F\u043E \u0443\u0431\u044B\u0432\u0430\u043D\u0438\u044E \u0440\u0438\u0441\u043A\u0430"}</div><div className="rule"/></div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:12}}>
                {MOCK.sections.map((s,i)=><SectionCard key={s.id} sec={s} m={MOCK.metrics[i]} onOpen={onOpenSection}/>)}
              </div>
            </>)}
            {viewMode === "table" && (<><div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438 \u00B7 \u0442\u0430\u0431\u043B\u0438\u0446\u0430"}</h2><div className="hint">{"click \u2192 drill-down"}</div><div className="rule"/></div><SectionTable onOpen={onOpenSection}/></>)}
            {viewMode === "charts" && (<><div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438 \u00B7 \u0433\u0440\u0430\u0444\u0438\u043A\u0438"}</h2><div className="hint">{"click \u043F\u043E \u0441\u0442\u043E\u043B\u0431\u0446\u0443 \u2192 drill-down"}</div><div className="rule"/></div><SectionChartsView onOpen={onOpenSection}/></>)}
            <div style={{marginTop:14}}><TrendChart/></div>
          </div>
          <div style={{minWidth:0, display:"flex", flexDirection:"column", gap:14}}>
            <SandBreakdownCard/>
            <IssuesList onViewAll={() => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435")}/>
            <div className="card">
              <div className="card-h"><h3>{"\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0430\u0445"}</h3><div className="sub">{"\u043F\u043B\u0430\u043D \u0441\u043C\u0435\u043D\u044B"}</div></div>
              <div className="card-b" style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 14px", fontSize:12}}>
                {[["\u0420\u0430\u0431\u043E\u0447\u0438\u0445","1 248"],["\u0411\u0440\u0438\u0433\u0430\u0434","42"],["\u0421\u0430\u043C\u043E\u0441\u0432\u0430\u043B\u043E\u0432","186"],["\u042D\u043A\u0441\u043A\u0430\u0432\u0430\u0442\u043E\u0440\u043E\u0432","54"],["\u0421\u0432. \u0430\u0433\u0440\u0435\u0433\u0430\u0442\u043E\u0432","18"],["\u0421\u043C\u0435\u043D","37 / 48"]].map(([k,v],i)=>(
                  <div key={i}>
                    <div style={{color:"var(--n-500)", fontSize:10, textTransform:"uppercase", letterSpacing:".08em"}}>{k}</div>
                    <div style={{fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, letterSpacing:".02em"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <toast.Toast/>
    </div>
  );
}
