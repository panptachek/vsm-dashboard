import React, { useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
         AreaChart, Area, ComposedChart, Line } from 'recharts';
import { Icon, fmt, riskCls, useToast, downloadPdf } from './core.jsx';
import { Badge, PageHeader, FilterBar } from './shell.jsx';
import { MOCK } from './mock.js';

export default function WipAnalyticsPage(){
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const filters = { date, sectionsFilter, workFilter };

  const handlePdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadPdf('/api/pdf/analytics', { date }, "VSM_\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430_" + date + ".pdf");
      toast.show("PDF \u0441\u043A\u0430\u0447\u0430\u043D");
    } catch (e) {
      toast.show("\u041E\u0448\u0438\u0431\u043A\u0430 PDF: " + (e.message || e));
    } finally {
      setPdfLoading(false);
    }
  }, [date]);

  const handleCsv = useCallback(() => {
    toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435");
  }, []);

  const setFilters = {
    setDate, setSectionsFilter, setWorkFilter,
    onReset: () => { setSectionsFilter([]); setWorkFilter([]); },
    onStub: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportCsv: handleCsv,
    onExportPdf: handlePdf,
  };

  // 1. temp roads aggregated per section
  const tadAgg = MOCK.sections.map((s,i)=>{
    const rows = MOCK.tads.filter(t=>t.sec===s.id);
    const avg = rows.length ? rows.reduce((a,r)=>a+r.zp,0)/rows.length : 0;
    return { name:"\u2116"+s.id, "\u0413\u043E\u0442\u043E\u0432\u043E": Math.round(avg),
             "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435": Math.round(rows.reduce((a,r)=>a+r.wr,0)/(rows.length||1)),
             "\u041F\u0438\u043E\u043D\u0435\u0440\u043D\u044B\u0439": Math.round(rows.reduce((a,r)=>a+r.pi,0)/(rows.length||1)),
             "\u041D\u0435 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435": Math.round(rows.reduce((a,r)=>a+r.no,0)/(rows.length||1))};
  });

  // 2. quarry day+night
  const quarryData = MOCK.quarries.map(q => {
    const rides = 4 + ((q.arm * 7) % 4);
    const d = rides * (10 + q.arm%20) * (22 + q.arm%10);
    const n = rides * (4 + q.arm%6)   * (28 + q.arm%15);
    return { name:q.name, "\u0414":d, "\u041D":n, plecho:q.arm, mat:q.mat };
  });

  // 3. piles plan/fact
  const pileData = MOCK.sections.map((s,i)=>{
    const m = MOCK.metrics[i];
    return { name:"\u2116"+s.id, "\u041F\u043B\u0430\u043D": 100, "\u0424\u0430\u043A\u0442 \u043E\u0441\u043D.": m.pileMain, "\u0424\u0430\u043A\u0442 \u043F\u0440\u043E\u0431\u043D.": m.pileTrial };
  });

  // 4. equipment matrix
  const eq = MOCK.equipmentMatrix;
  const cellColor = (v) => v >= 100 ? "var(--progress-good)" : v >= 80 ? "var(--progress-warn)" : "var(--progress-bad)";

  return (
    <div className="wip-shell">
      <div className="page">
        <PageHeader title={"\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 (WIP)"} subtitle={"\u0421\u0440\u0430\u0432\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C \u00B7 \u0437\u0430 \u0441\u043C\u0435\u043D\u0443"}
          actions={<>
            <button className="btn" onClick={handleCsv}><Icon name="download" size={14}/>CSV</button>
            <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14}/>{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF-\u043E\u0442\u0447\u0451\u0442"}</button>
          </>}/>
        <FilterBar {...filters} {...setFilters}/>

        {/* 1 */}
        <div className="card" style={{marginBottom:14}}>
          <div className="card-h">
            <h3>{"1. \u041E\u0442\u0441\u044B\u043F\u043A\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445 \u0430\u0432\u0442\u043E\u0434\u043E\u0440\u043E\u0433"}</h3>
            <div className="sub">{"\u0441\u0440\u0435\u0434\u043D\u0438\u0435 % \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}</div>
          </div>
          <div className="card-b" style={{height:260}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tadAgg} stackOffset="expand">
                <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7"/>
                <XAxis dataKey="name" tick={{fontSize:11, fill:"#6b6b6b"}} axisLine={{stroke:"#c9c9c9"}} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:"#6b6b6b"}} axisLine={false} tickLine={false} tickFormatter={v=>Math.round(v*100)+"%"}/>
                <Tooltip contentStyle={{fontSize:12, border:"1px solid #c9c9c9", borderRadius:4, fontFamily:"JetBrains Mono, monospace"}} formatter={v=>v+"%"}/>
                <Bar dataKey={"\u0413\u043E\u0442\u043E\u0432\u043E"} stackId="a" fill="#16a34a"/>
                <Bar dataKey={"\u0412 \u0440\u0430\u0431\u043E\u0442\u0435"} stackId="a" fill="#f59e0b"/>
                <Bar dataKey={"\u041F\u0438\u043E\u043D\u0435\u0440\u043D\u044B\u0439"} stackId="a" fill="#94a3b8"/>
                <Bar dataKey={"\u041D\u0435 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435"} stackId="a" fill="#d9d9d9"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2 */}
        <div className="card" style={{marginBottom:14}}>
          <div className="card-h">
            <h3>{"2. \u0412\u043E\u0437\u043A\u0430 \u0441 \u043A\u0430\u0440\u044C\u0435\u0440\u043E\u0432 \u00B7 \u0441\u043C\u0435\u043D\u0430 \u0414+\u041D"}</h3>
            <div className="sub">{"\u043C\u00B3 \u0437\u0430 \u0441\u0443\u0442\u043A\u0438"}</div>
          </div>
          <div className="card-b" style={{height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarryData} layout="vertical" margin={{left:100}}>
                <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7"/>
                <XAxis type="number" tick={{fontSize:11, fill:"#6b6b6b"}} axisLine={{stroke:"#c9c9c9"}} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:11, fill:"#262626"}} axisLine={false} tickLine={false} width={100}/>
                <Tooltip contentStyle={{fontSize:12, border:"1px solid #c9c9c9", borderRadius:4, fontFamily:"JetBrains Mono, monospace"}}/>
                <Bar dataKey={"\u0414"} stackId="a" fill="#1a1a1a"/>
                <Bar dataKey={"\u041D"} stackId="a" fill="var(--accent-red)"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3 */}
        <div className="card" style={{marginBottom:14}}>
          <div className="card-h">
            <h3>{"3. \u0417\u0430\u0431\u0438\u0432\u043A\u0430 \u0441\u0432\u0430\u0439"}</h3>
            <div className="sub">{"% \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043E\u0442 \u043F\u043B\u0430\u043D\u0430 \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}</div>
          </div>
          <div className="card-b" style={{height:260}}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pileData}>
                <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7"/>
                <XAxis dataKey="name" tick={{fontSize:11, fill:"#6b6b6b"}} axisLine={{stroke:"#c9c9c9"}} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:"#6b6b6b"}} axisLine={false} tickLine={false} unit="%"/>
                <Tooltip contentStyle={{fontSize:12, border:"1px solid #c9c9c9", borderRadius:4, fontFamily:"JetBrains Mono, monospace"}}/>
                <Bar dataKey={"\u0424\u0430\u043A\u0442 \u043E\u0441\u043D."} fill="var(--accent-red)"/>
                <Bar dataKey={"\u0424\u0430\u043A\u0442 \u043F\u0440\u043E\u0431\u043D."} fill="#858585"/>
                <Line dataKey={"\u041F\u043B\u0430\u043D"} stroke="#1a1a1a" strokeDasharray="4 4" dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 4 matrix */}
        <div className="card" style={{marginBottom:14}}>
          <div className="card-h">
            <h3>{"4. \u041F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u0442\u0435\u0445\u043D\u0438\u043A\u0438"}</h3>
            <div className="sub">{"% \u043E\u0442 \u0441\u0443\u0442\u043E\u0447\u043D\u043E\u0439 \u043D\u043E\u0440\u043C\u044B"}</div>
          </div>
          <div className="card-b" style={{overflowX:"auto"}}>
            <table className="tbl" style={{minWidth:720}}>
              <thead>
                <tr>
                  <th>{"\u0422\u0438\u043F"}</th>
                  {eq.cols.map(c=><th key={c} className="num">{c}</th>)}
                  <th className="num">{"\u0421\u0440\u0435\u0434."}</th>
                </tr>
              </thead>
              <tbody>
                {eq.rows.map((r,ri)=>{
                  const avg = Math.round(eq.values[ri].reduce((a,b)=>a+b,0)/eq.values[ri].length);
                  return (
                    <tr key={r}>
                      <td style={{fontWeight:600}}>{r}</td>
                      {eq.values[ri].map((v,ci)=>(
                        <td key={ci} className="num">
                          <div style={{display:"inline-flex", alignItems:"center", gap:6, justifyContent:"flex-end"}}>
                            <div style={{width:36, height:6, background:"var(--n-100)", position:"relative"}}>
                              <div style={{position:"absolute",inset:0, width:Math.min(100,v)+"%", background:cellColor(v)}}/>
                            </div>
                            <span style={{minWidth:34}}>{v}%</span>
                          </div>
                        </td>
                      ))}
                      <td className="num" style={{fontWeight:600}}>{avg}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5 trend */}
        <div className="card">
          <div className="card-h">
            <h3>{"5. \u041E\u0431\u044A\u0451\u043C\u044B \u043F\u0435\u0440\u0435\u0432\u043E\u0437\u043E\u043A \u00B7 30 \u0434\u043D\u0435\u0439"}</h3>
            <div className="sub">{"\u043C\u00B3 / \u0441\u0443\u0442\u043A\u0438 \u00B7 \u043F\u0435\u0441\u043E\u043A + \u0429\u041F\u0413\u0421"}</div>
          </div>
          <div className="card-b" style={{height:260}}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK.trendDays}>
                <defs>
                  <linearGradient id="wip-g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1a1a1a" stopOpacity={0.18}/>
                    <stop offset="100%" stopColor="#1a1a1a" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="wip-g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.22}/>
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7"/>
                <XAxis dataKey="date" tick={{fontSize:10, fill:"#6b6b6b"}} axisLine={{stroke:"#c9c9c9"}} tickLine={false} interval={3}/>
                <YAxis tick={{fontSize:10, fill:"#6b6b6b"}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{fontSize:12, border:"1px solid #c9c9c9", borderRadius:4, fontFamily:"JetBrains Mono, monospace"}}/>
                <Area type="monotone" dataKey="sand" name={"\u041F\u0435\u0441\u043E\u043A"} stroke="#1a1a1a" fill="url(#wip-g1)" strokeWidth={1.5}/>
                <Area type="monotone" dataKey="shpgs" name={"\u0429\u041F\u0413\u0421"} stroke="var(--accent-red)" fill="url(#wip-g2)" strokeWidth={1.5}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <toast.Toast/>
    </div>
  );
}
