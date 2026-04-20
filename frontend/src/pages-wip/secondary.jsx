import React, { useState, useEffect, useCallback } from 'react';
import { Icon, fmt, useToast, fetchJson } from './core.jsx';
import { Badge, PageHeader } from './shell.jsx';

function LoadingSkeleton() {
  return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--n-400)' }}>Загрузка...</div>;
}

function NoData({ text = "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445" }) {
  return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--n-400)' }}>{text}</div>;
}

// Equipment page
function EquipmentSection() {
  const toast = useToast();
  const [equipment, setEquipment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetchJson('/api/wip/equipment-productivity?from=2026-04-01&to=' + today)
      .then(d => setEquipment(d))
      .catch(() => setEquipment(null))
      .finally(() => setLoading(false));
  }, []);

  const handleExport = useCallback(() => {
    toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435");
  }, []);

  const rows = equipment?.rows || [];

  return (
    <>
      <PageHeader title={"\u0422\u0435\u0445\u043D\u0438\u043A\u0430 (WIP)"} subtitle={"\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}
        actions={<button className="btn primary" onClick={handleExport}><Icon name="file" size={14} />{"\u0412\u044B\u0433\u0440\u0443\u0437\u0438\u0442\u044C"}</button>} />
      {loading ? <LoadingSkeleton /> : rows.length === 0 ? <NoData /> : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr>
                <th>{"\u0422\u0438\u043F"}</th><th>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</th>
                <th className="num">{"\u0415\u0434\u0438\u043D\u0438\u0446"}</th>
                <th className="num">{"\u0424\u0430\u043A\u0442, \u043C\u00B3"}</th>
                <th className="num">{"\u041D\u043E\u0440\u043C\u0430, \u043C\u00B3"}</th>
                <th className="num">{"\u0420\u0435\u0439\u0441\u043E\u0432"}</th>
                <th className="num">{"% \u043E\u0442 \u043D\u043E\u0440\u043C\u044B"}</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{r.equipment_type}</td>
                    <td>{r.section_code}</td>
                    <td className="num">{r.units}</td>
                    <td className="num">{fmt(Math.round(r.fact_volume || 0))}</td>
                    <td className="num">{fmt(Math.round(r.norm_total || 0))}</td>
                    <td className="num">{r.trips}</td>
                    <td className="num">
                      <Badge kind={r.percent >= 85 ? "good" : r.percent >= 60 ? "warn" : "bad"}>
                        {Math.round(r.percent)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <toast.Toast />
    </>
  );
}

// New report form — uses sections from API
function NewReportSection() {
  const [sections, setSections] = useState([]);
  const [sec, setSec] = useState("");
  const [sand, setSand] = useState(0);
  const [shpgs, setShpgs] = useState(0);
  const [pMain, setPMain] = useState(0);
  const [pTr, setPTr] = useState(0);
  const [issues, setIssues] = useState("");
  const [saved, setSaved] = useState(false);
  const [errs, setErrs] = useState({});
  const toast = useToast();

  useEffect(() => {
    fetchJson('/api/geo/sections')
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setSections(list);
        if (list.length > 0) setSec(list[0].code);
      })
      .catch(() => setSections([]));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (sand < 0 || isNaN(sand)) er.sand = "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E";
    if (shpgs < 0 || isNaN(shpgs)) er.shpgs = "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E";
    setErrs(er);
    if (Object.keys(er).length === 0) {
      setSaved(true);
      toast.show("\u041E\u0442\u0447\u0451\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D");
      setTimeout(() => setSaved(false), 2400);
    }
  };

  const handleCancel = useCallback(() => {
    setSand(0); setShpgs(0); setPMain(0); setPTr(0); setIssues(""); setErrs({});
    toast.show("\u0424\u043E\u0440\u043C\u0430 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u0430");
  }, []);

  const selectedSec = sections.find(s => s.code === sec);

  return (
    <>
      <PageHeader title={"\u041D\u043E\u0432\u044B\u0439 \u0441\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 (WIP)"}
        subtitle={"\u0421\u043C\u0435\u043D\u0430 " + new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })}
        actions={<><button className="btn" onClick={handleCancel}>{"\u041E\u0442\u043C\u0435\u043D\u0430"}</button><button className="btn primary" onClick={submit}>{"\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"}</button></>} />

      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}>
        <div className="card">
          <div className="card-h"><h3>{"\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u0441\u043C\u0435\u043D\u044B"}</h3></div>
          <div className="card-b" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</div>
              <select className="select" value={sec} onChange={e => setSec(e.target.value)} style={{ width: "100%" }}>
                {sections.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0414\u0430\u0442\u0430"}</div>
              <input type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} style={{ width: "100%" }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0412\u043E\u0437\u043A\u0430 \u043F\u0435\u0441\u043A\u0430, \u043C\u00B3"}</div>
              <input className="input" type="number" value={sand} onChange={e => setSand(+e.target.value)} style={{ width: "100%", borderColor: errs.sand ? "var(--danger)" : "" }} />
              {errs.sand && <div style={{ color: "var(--danger)", fontSize: 10, marginTop: 3 }}>{errs.sand}</div>}
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0412\u043E\u0437\u043A\u0430 \u0429\u041F\u0413\u0421, \u043C\u00B3"}</div>
              <input className="input" type="number" value={shpgs} onChange={e => setShpgs(+e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435, \u0448\u0442"}</div>
              <input className="input" type="number" value={pMain} onChange={e => setPMain(+e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0421\u0432\u0430\u0438 \u043F\u0440\u043E\u0431\u043D\u044B\u0435, \u0448\u0442"}</div>
              <input className="input" type="number" value={pTr} onChange={e => setPTr(+e.target.value)} style={{ width: "100%" }} />
            </label>
            <label style={{ gridColumn: "span 2" }}>
              <div style={{ fontSize: 11, color: "var(--n-500)", marginBottom: 4 }}>{"\u0417\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u044F"}</div>
              <textarea className="input" rows={4} style={{ width: "100%", height: "auto", padding: "8px 10px" }}
                value={issues} onChange={e => setIssues(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>{"\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440"}</h3></div>
          <div className="card-b" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div><span style={{ color: "var(--n-500)" }}>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A:"}</span> <b>{selectedSec?.name || "\u2014"}</b></div>
            <table className="tbl">
              <tbody>
                <tr><td>{"\u041F\u0435\u0441\u043E\u043A"}</td><td className="num mono">{fmt(sand)} {"\u043C\u00B3"}</td></tr>
                <tr><td>{"\u0429\u041F\u0413\u0421"}</td><td className="num mono">{fmt(shpgs)} {"\u043C\u00B3"}</td></tr>
                <tr><td>{"\u0421\u0432\u0430\u0438 \u043E\u0441\u043D."}</td><td className="num mono">{pMain} {"\u0448\u0442"}</td></tr>
                <tr><td>{"\u0421\u0432\u0430\u0438 \u043F\u0440."}</td><td className="num mono">{pTr} {"\u0448\u0442"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </form>

      {saved && (
        <div className="toast-wrap">
          <div className="toast"><span className="dot good" />{"\u041E\u0442\u0447\u0451\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D"}</div>
        </div>
      )}
      <toast.Toast />
    </>
  );
}

export default function WipSecondaryPage() {
  const [tab, setTab] = useState("equipment");
  return (
    <div className="wip-shell">
      <div className="page">
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className={"btn " + (tab === "equipment" ? "primary" : "")} onClick={() => setTab("equipment")}>{"\u0422\u0435\u0445\u043D\u0438\u043A\u0430"}</button>
          <button className={"btn " + (tab === "report" ? "primary" : "")} onClick={() => setTab("report")}>{"\u041D\u043E\u0432\u044B\u0439 \u043E\u0442\u0447\u0451\u0442"}</button>
        </div>
        {tab === "equipment" ? <EquipmentSection /> : <NewReportSection />}
      </div>
    </div>
  );
}
