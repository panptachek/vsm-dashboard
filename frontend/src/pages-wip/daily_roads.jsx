import React, { useState, useCallback } from 'react';
import { Icon, fmt, useToast, downloadPdf } from './core.jsx';
import { Badge, PageHeader, FilterBar } from './shell.jsx';
import { MOCK } from './mock.js';

function DailySection(){
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const filters = { date, sectionsFilter, workFilter };

  const handlePdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadPdf('/api/pdf/quarry-report', { date }, "VSM_\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0439_" + date + ".pdf");
      toast.show("PDF \u0441\u043A\u0430\u0447\u0430\u043D");
    } catch (e) {
      toast.show("\u041E\u0448\u0438\u0431\u043A\u0430 PDF: " + (e.message || e));
    } finally {
      setPdfLoading(false);
    }
  }, [date]);

  const handleXlsx = useCallback(() => {
    toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435");
  }, []);

  const setFilters = {
    setDate, setSectionsFilter, setWorkFilter,
    onReset: () => { setSectionsFilter([]); setWorkFilter([]); },
    onStub: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportCsv: handleXlsx,
    onExportPdf: handlePdf,
  };

  const totalsAll = { techD:0, techN:0, outD:0, outN:0, total:0 };
  MOCK.dailyQuarry.forEach(s => s.rows.forEach(r => {
    totalsAll.techD += r.techD; totalsAll.techN += r.techN;
    totalsAll.outD += r.outD;   totalsAll.outN += r.outN;
    totalsAll.total += r.total;
  }));
  return (
    <>
      <PageHeader title={"\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 \u043F\u043E \u043A\u0430\u0440\u044C\u0435\u0440\u0430\u043C (WIP)"}
        subtitle={"\u0421\u043C\u0435\u043D\u0430 \u0414+\u041D \u00B7 " + new Date().toLocaleDateString("ru-RU",{day:"2-digit",month:"long",year:"numeric"})}
        actions={<>
          <button className="btn" onClick={handleXlsx}><Icon name="download" size={14}/>XLSX</button>
          <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14}/>{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF-\u0440\u0430\u043F\u043E\u0440\u0442"}</button>
        </>}/>
      <FilterBar {...filters} {...setFilters}/>

      <div className="card" style={{marginBottom:12}}>
        <div className="card-b" style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14}}>
          <div><div style={{fontSize:10,color:"var(--n-500)",textTransform:"uppercase",letterSpacing:".04em"}}>{"\u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u0414"}</div><div className="mono" style={{fontSize:20, fontWeight:600}}>{fmt(totalsAll.techD)}</div></div>
          <div><div style={{fontSize:10,color:"var(--n-500)",textTransform:"uppercase",letterSpacing:".04em"}}>{"\u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u041D"}</div><div className="mono" style={{fontSize:20, fontWeight:600}}>{fmt(totalsAll.techN)}</div></div>
          <div><div style={{fontSize:10,color:"var(--n-500)",textTransform:"uppercase",letterSpacing:".04em"}}>{"\u0412\u044B\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0414"}</div><div className="mono" style={{fontSize:20, fontWeight:600}}>{fmt(totalsAll.outD)} <span style={{fontSize:12,color:"var(--n-500)"}}>{"\u043C\u00B3"}</span></div></div>
          <div><div style={{fontSize:10,color:"var(--n-500)",textTransform:"uppercase",letterSpacing:".04em"}}>{"\u0412\u044B\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u041D"}</div><div className="mono" style={{fontSize:20, fontWeight:600}}>{fmt(totalsAll.outN)} <span style={{fontSize:12,color:"var(--n-500)"}}>{"\u043C\u00B3"}</span></div></div>
          <div><div style={{fontSize:10,color:"var(--n-500)",textTransform:"uppercase",letterSpacing:".04em"}}>{"\u0421\u0443\u0442\u043A\u0438"}</div><div className="mono" style={{fontSize:20, fontWeight:600, color:"var(--accent-red)"}}>{fmt(totalsAll.total)} <span style={{fontSize:12,color:"var(--n-500)"}}>{"\u043C\u00B3"}</span></div></div>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(520px,1fr))", gap:12}}>
        {MOCK.dailyQuarry.map(({sec, rows})=>{
          const tD = rows.reduce((a,r)=>a+r.techD,0);
          const tN = rows.reduce((a,r)=>a+r.techN,0);
          const oD = rows.reduce((a,r)=>a+r.outD,0);
          const oN = rows.reduce((a,r)=>a+r.outN,0);
          const tot= rows.reduce((a,r)=>a+r.total,0);
          return (
            <div className="card" key={sec.id}>
              <div className="card-h">
                <h3>{sec.title}</h3>
                <div className="sub">{sec.pk}</div>
                <div className="actions"><Badge kind="info">{rows.length} {"\u043A\u0430\u0440\u044C\u0435\u0440"}{rows.length>1?"\u0430":""}</Badge></div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{"\u041A\u0430\u0440\u044C\u0435\u0440"}</th><th>{"\u041C\u0430\u0442\u0435\u0440."}</th><th className="num">{"\u041F\u043B\u0435\u0447\u043E, \u043A\u043C"}</th><th className="num">{"\u0420\u0435\u0439\u0441\u043E\u0432/\u0441\u043C."}</th>
                      <th className="num">{"\u0422\u0435\u0445. \u0414"}</th><th className="num">{"\u0422\u0435\u0445. \u041D"}</th>
                      <th className="num">{"\u0412\u044B\u0440\u0430\u0431. \u0414"}</th><th className="num">{"\u0412\u044B\u0440\u0430\u0431. \u041D"}</th>
                      <th className="num">{"\u0421\u0443\u0442\u043A\u0438"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={i}>
                        <td>{r.q}</td>
                        <td style={{color:"var(--n-500)"}}>{r.mat}</td>
                        <td className="num">{r.arm}</td>
                        <td className="num">{r.rides}</td>
                        <td className="num">{r.techD}</td>
                        <td className="num">{r.techN}</td>
                        <td className="num">{fmt(r.outD)}</td>
                        <td className="num">{fmt(r.outN)}</td>
                        <td className="num" style={{fontWeight:600}}>{fmt(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={2}>{"\u0418\u0442\u043E\u0433\u043E \u043F\u043E "}{sec.title.toLowerCase()}</td>
                      <td className="num">{"\u2014"}</td><td className="num">{"\u2014"}</td>
                      <td className="num">{tD}</td>
                      <td className="num">{tN}</td>
                      <td className="num">{fmt(oD)}</td>
                      <td className="num">{fmt(oN)}</td>
                      <td className="num" style={{color:"var(--accent-red)"}}>{fmt(tot)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <toast.Toast/>
    </>
  );
}

function RoadsSection(){
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const filters = { date, sectionsFilter, workFilter };

  const handlePdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadPdf('/api/pdf/analytics', { date }, "VSM_\u0412\u0440\u0435\u043C\u0410\u0414_" + date + ".pdf");
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

  const sections = [...new Set(MOCK.tads.map(t=>t.sec))].map(id => ({
    id, title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u2116"+id, items: MOCK.tads.filter(t=>t.sec===id)
  }));
  return (
    <>
      <PageHeader title={"\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0430\u0432\u0442\u043E\u0434\u043E\u0440\u043E\u0433\u0438 (WIP)"}
        subtitle={MOCK.tads.length + " \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432 \u00B7 \u0441\u0442\u0430\u0442\u0443\u0441 \u043E\u0442\u0441\u044B\u043F\u043A\u0438 \u043F\u043E \u0441\u0442\u0430\u0434\u0438\u044F\u043C"}
        actions={<>
          <button className="btn" onClick={handleCsv}><Icon name="download" size={14}/>CSV</button>
          <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14}/>{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF"}</button>
        </>}/>
      <FilterBar {...filters} {...setFilters}/>

      <div className="tad-legend" style={{marginBottom:14, padding:"8px 12px", background:"var(--n-0)", border:"1px solid var(--n-100)", borderRadius:6}}>
        <span className="zp">{"\u0417\u041F \u0433\u043E\u0442\u043E\u0432\u043E"}</span>
        <span className="wr">{"\u0412 \u0440\u0430\u0431\u043E\u0442\u0435"}</span>
        <span className="pi">{"\u041F\u0438\u043E\u043D\u0435\u0440\u043D\u044B\u0439"}</span>
        <span className="no">{"\u041D\u0435 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435"}</span>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(460px,1fr))", gap:12}}>
        {sections.map(s => (
          <div key={s.id} className="card">
            <div className="card-h">
              <h3>{s.title}</h3>
              <div className="sub">{s.items.length} {"\u043E\u0431\u044A\u0435\u043A\u0442"}{s.items.length>1?"\u0430":""}</div>
            </div>
            <div className="card-b" style={{display:"flex", flexDirection:"column", gap:10}}>
              {s.items.map(t => (
                <div key={t.name}>
                  <div style={{display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3}}>
                    <span style={{fontWeight:600}}>{t.name}</span>
                    <span className="mono" style={{color:"var(--n-500)", fontSize:11}}>{t.pk}</span>
                  </div>
                  <div className="tad">
                    <span className="zp" style={{width:t.zp+"%"}}/>
                    <span className="wr" style={{width:t.wr+"%"}}/>
                    <span className="pi" style={{width:t.pi+"%"}}/>
                    <span className="no" style={{width:t.no+"%"}}/>
                  </div>
                  <div className="mono" style={{fontSize:10, color:"var(--n-500)", marginTop:3, display:"flex", gap:10}}>
                    <span>{"\u0433\u043E\u0442\u043E\u0432\u043E"} {t.zp}%</span>
                    <span>{"\u0432 \u0440\u0430\u0431\u043E\u0442\u0435"} {t.wr}%</span>
                    <span>{"\u043F\u0438\u043E\u043D."} {t.pi}%</span>
                    <span>{"\u043D\u0435\u0442"} {t.no}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <toast.Toast/>
    </>
  );
}

export function WipDailyRoadsPage(){
  const [tab, setTab] = useState("daily");
  return (
    <div className="wip-shell">
      <div className="page">
        <div style={{display:"flex", gap:8, marginBottom:16}}>
          <button className={"btn " + (tab==="daily"?"primary":"")} onClick={()=>setTab("daily")}>{"\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442"}</button>
          <button className={"btn " + (tab==="roads"?"primary":"")} onClick={()=>setTab("roads")}>{"\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0410\u0414"}</button>
        </div>
        {tab === "daily" ? <DailySection/> : <RoadsSection/>}
      </div>
    </div>
  );
}

export default WipDailyRoadsPage;
