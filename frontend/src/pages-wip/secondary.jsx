import React, { useState, useCallback } from 'react';
import { Icon, fmt, useToast } from './core.jsx';
import { Badge, PageHeader } from './shell.jsx';
import { MOCK } from './mock.js';

// Equipment page
function EquipmentSection(){
  const toast = useToast();

  const handleExport = useCallback(() => {
    toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435");
  }, []);

  return (
    <>
      <PageHeader title={"\u0422\u0435\u0445\u043D\u0438\u043A\u0430 (WIP)"} subtitle={"\u043F\u0430\u0440\u043A \u0441\u0430\u043C\u043E\u0441\u0432\u0430\u043B\u043E\u0432, \u044D\u043A\u0441\u043A\u0430\u0432\u0430\u0442\u043E\u0440\u043E\u0432, \u0441\u0432\u0430\u0439\u043D\u044B\u0445 \u0430\u0433\u0440\u0435\u0433\u0430\u0442\u043E\u0432"}
        actions={<button className="btn primary" onClick={handleExport}><Icon name="file" size={14}/>{"\u0412\u044B\u0433\u0440\u0443\u0437\u0438\u0442\u044C"}</button>}/>
      <div className="card">
        <div style={{overflowX:"auto"}}>
        <table className="tbl">
          <thead><tr>
            <th>{"\u0422\u0438\u043F"}</th><th>{"\u041C\u0430\u0440\u043A\u0430"}</th><th>{"\u0420\u0435\u0433. \u043D\u043E\u043C\u0435\u0440"}</th>
            <th>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</th><th>{"\u041A\u0430\u0440\u044C\u0435\u0440 / \u043E\u0431\u044A\u0435\u043A\u0442"}</th>
            <th className="num">{"\u0421\u043C\u0435\u043D\u0430"}</th><th className="num">{"\u041C\u043E\u0442\u043E\u0447\u0430\u0441"}</th><th className="num">{"\u0420\u0430\u0441\u0445., \u043B"}</th>
            <th>{"\u0421\u0442\u0430\u0442\u0443\u0441"}</th>
          </tr></thead>
          <tbody>
            {[
              ["\u0421\u0430\u043C\u043E\u0441\u0432\u0430\u043B","\u041A\u0430\u043C\u0410\u0417-65115","\u0412 782 \u041C\u0420","\u21161","\u0411\u043E\u0440\u043E\u0432\u0435\u043D\u043A\u0430-3","\u0414","9.2","186","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u0421\u0430\u043C\u043E\u0441\u0432\u0430\u043B","Scania P-400","\u041A 311 \u041A\u041A","\u21162","\u041A\u0440\u0435\u0441\u0442\u0446\u044B-1","\u041D","11.1","228","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u042D\u043A\u0441\u043A\u0430\u0432\u0430\u0442\u043E\u0440","Caterpillar 329D","\u2014","\u21165","\u0422\u0440\u0435\u0433\u0443\u0431\u043E\u0432\u043E","\u0414","7.8","142","\u043E\u0442\u043A\u0430\u0437"],
              ["\u042D\u043A\u0441\u043A\u0430\u0432\u0430\u0442\u043E\u0440","Volvo EC300","\u2014","\u21164","\u041B\u044E\u0431\u043D\u0438\u0446\u0430-2","\u0414","10.4","195","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u0421\u0432\u0430\u0439\u043D\u044B\u0439 \u0430\u0433\u0440\u0435\u0433\u0430\u0442","Junttan PMx22","\u2014","\u21164","\u0421\u041F-07","\u0414","6.5","168","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u0421\u0432\u0430\u0439\u043D\u044B\u0439 \u0430\u0433\u0440\u0435\u0433\u0430\u0442","Junttan PMx25","\u2014","\u21167","\u0421\u041F-11","\u041D","8.0","201","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u0421\u0430\u043C\u043E\u0441\u0432\u0430\u043B","Shacman F3000","\u041E 904 \u0421\u0422","\u21168","\u0422\u043E\u0441\u043D\u043E-2","\u0414","5.1","102","\u0422\u041E"],
              ["\u041F\u043E\u0433\u0440\u0443\u0437\u0447\u0438\u043A","Liebherr L566","\u2014","\u21166","\u041B\u0430\u0436\u0438\u043D\u044B","\u0414","9.8","172","\u0440\u0430\u0431\u043E\u0442\u0430"],
              ["\u0413\u0440\u0435\u0439\u0434\u0435\u0440","\u0414\u0417-98","\u2014","\u21163","\u0410\u0414-4 \u21162","\u0414","6.2","86","\u0440\u0430\u0431\u043E\u0442\u0430"],
            ].map((r,i)=>(
              <tr key={i}>
                {r.slice(0,5).map((c,j)=><td key={j}>{c}</td>)}
                <td className="num">{r[5]}</td>
                <td className="num">{r[6]}</td>
                <td className="num">{r[7]}</td>
                <td><Badge kind={r[8]==="\u0440\u0430\u0431\u043E\u0442\u0430"?"good":r[8]==="\u0422\u041E"?"info":"bad"}>{r[8]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <toast.Toast/>
    </>
  );
}

// New report form
function NewReportSection(){
  const [sec, setSec] = useState(5);
  const [sand, setSand] = useState(2620);
  const [shpgs, setShpgs] = useState(248);
  const [pMain, setPMain] = useState(12);
  const [pTr, setPTr] = useState(2);
  const [issues, setIssues] = useState("");
  const [saved, setSaved] = useState(false);
  const [errs, setErrs] = useState({});
  const toast = useToast();

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (sand < 0 || isNaN(sand)) er.sand = "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E";
    if (shpgs < 0 || isNaN(shpgs)) er.shpgs = "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E";
    setErrs(er);
    if (Object.keys(er).length === 0){
      setSaved(true);
      toast.show("\u041E\u0442\u0447\u0451\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u00B7 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D \u0432 \u0436\u0443\u0440\u043D\u0430\u043B");
      setTimeout(()=>setSaved(false), 2400);
    }
  };

  const handleCancel = useCallback(() => {
    setSec(5); setSand(2620); setShpgs(248); setPMain(12); setPTr(2); setIssues(""); setErrs({});
    toast.show("\u0424\u043E\u0440\u043C\u0430 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u0430");
  }, []);

  return (
    <>
      <PageHeader title={"\u041D\u043E\u0432\u044B\u0439 \u0441\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 (WIP)"}
        subtitle={"\u0421\u043C\u0435\u043D\u0430 " + new Date().toLocaleDateString("ru-RU",{day:"2-digit",month:"long"})}
        actions={<><button className="btn" onClick={handleCancel}>{"\u041E\u0442\u043C\u0435\u043D\u0430"}</button><button className="btn primary" onClick={submit}>{"\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"}</button></>}/>

      <form onSubmit={submit} style={{display:"grid", gridTemplateColumns:"minmax(0,2fr) minmax(0,1fr)", gap:14}}>
        <div className="card">
          <div className="card-h"><h3>{"\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u0441\u043C\u0435\u043D\u044B"}</h3><div className="sub">{"\u043A\u0443\u0431\u043E\u043C\u0435\u0442\u0440\u044B, \u0448\u0442\u0443\u043A\u0438"}</div></div>
          <div className="card-b" style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</div>
              <select className="select" value={sec} onChange={e=>setSec(+e.target.value)} style={{width:"100%"}}>
                {MOCK.sections.map(s=><option key={s.id} value={s.id}>{s.title} {"\u00B7"} {s.pk}</option>)}
              </select>
            </label>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0414\u0430\u0442\u0430"}</div>
              <input type="date" className="input" defaultValue={new Date().toISOString().slice(0,10)} style={{width:"100%"}}/>
            </label>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0412\u043E\u0437\u043A\u0430 \u043F\u0435\u0441\u043A\u0430, \u043C\u00B3"}</div>
              <input className="input" type="number" value={sand} onChange={e=>setSand(+e.target.value)} style={{width:"100%", borderColor: errs.sand?"var(--danger)":""}}/>
              {errs.sand && <div style={{color:"var(--danger)", fontSize:10, marginTop:3}}>{errs.sand}</div>}
            </label>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0412\u043E\u0437\u043A\u0430 \u0429\u041F\u0413\u0421, \u043C\u00B3"}</div>
              <input className="input" type="number" value={shpgs} onChange={e=>setShpgs(+e.target.value)} style={{width:"100%", borderColor: errs.shpgs?"var(--danger)":""}}/>
            </label>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435, \u0448\u0442"}</div>
              <input className="input" type="number" value={pMain} onChange={e=>setPMain(+e.target.value)} style={{width:"100%"}}/>
            </label>
            <label>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0421\u0432\u0430\u0438 \u043F\u0440\u043E\u0431\u043D\u044B\u0435, \u0448\u0442"}</div>
              <input className="input" type="number" value={pTr} onChange={e=>setPTr(+e.target.value)} style={{width:"100%"}}/>
            </label>
            <label style={{gridColumn:"span 2"}}>
              <div style={{fontSize:11, color:"var(--n-500)", marginBottom:4}}>{"\u0417\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u044F / \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B"}</div>
              <textarea className="input" rows={4} style={{width:"100%", height:"auto", padding:"8px 10px"}}
                value={issues} onChange={e=>setIssues(e.target.value)}
                placeholder={"\u041D\u0430\u043F\u0440.: \u043E\u0442\u043A\u0430\u0437 \u044D\u043A\u0441\u043A\u0430\u0432\u0430\u0442\u043E\u0440\u0430, \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0430 \u0429\u041F\u0413\u0421, \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u043F\u043E \u043F\u043E\u0433\u043E\u0434\u0435\u2026"}/>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>{"\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440"}</h3><div className="sub">{"\u043A\u0430\u043A \u043F\u043E\u043F\u0430\u0434\u0451\u0442 \u0432 \u0440\u0430\u043F\u043E\u0440\u0442"}</div></div>
          <div className="card-b" style={{fontSize:12, display:"flex", flexDirection:"column", gap:10}}>
            <div><span style={{color:"var(--n-500)"}}>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A:"}</span> <b>{MOCK.sections.find(s=>s.id===sec)?.title}</b></div>
            <table className="tbl">
              <tbody>
                <tr><td>{"\u041F\u0435\u0441\u043E\u043A"}</td><td className="num mono">{fmt(sand)} {"\u043C\u00B3"}</td></tr>
                <tr><td>{"\u0429\u041F\u0413\u0421"}</td><td className="num mono">{fmt(shpgs)} {"\u043C\u00B3"}</td></tr>
                <tr><td>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}</td><td className="num mono">{pMain} {"\u0448\u0442"}</td></tr>
                <tr><td>{"\u0421\u0432\u0430\u0438 \u043F\u0440."}</td><td className="num mono">{pTr} {"\u0448\u0442"}</td></tr>
              </tbody>
            </table>
            <div style={{color:"var(--n-500)", fontSize:11}}>{"\u0417\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u044F:"}</div>
            <div style={{fontSize:12, fontStyle: issues?"normal":"italic", color: issues?"var(--n-900)":"var(--n-400)"}}>{issues || "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B"}</div>
          </div>
        </div>
      </form>

      {saved && (
        <div className="toast-wrap">
          <div className="toast"><span className="dot good"/>{"\u041E\u0442\u0447\u0451\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u00B7 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D \u0432 \u0436\u0443\u0440\u043D\u0430\u043B"}</div>
        </div>
      )}
      <toast.Toast/>
    </>
  );
}

export default function WipSecondaryPage(){
  const [tab, setTab] = useState("equipment");
  return (
    <div className="wip-shell">
      <div className="page">
        <div style={{display:"flex", gap:8, marginBottom:16}}>
          <button className={"btn " + (tab==="equipment"?"primary":"")} onClick={()=>setTab("equipment")}>{"\u0422\u0435\u0445\u043D\u0438\u043A\u0430"}</button>
          <button className={"btn " + (tab==="report"?"primary":"")} onClick={()=>setTab("report")}>{"\u041D\u043E\u0432\u044B\u0439 \u043E\u0442\u0447\u0451\u0442"}</button>
        </div>
        {tab === "equipment" ? <EquipmentSection/> : <NewReportSection/>}
      </div>
    </div>
  );
}
