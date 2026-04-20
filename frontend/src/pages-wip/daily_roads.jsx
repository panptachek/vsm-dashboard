import React, { useState, useEffect, useCallback } from 'react';
import { Icon, fmt, useToast, downloadPdf, fetchJson } from './core.jsx';
import { Badge, PageHeader, FilterBar } from './shell.jsx';

function LoadingSkeleton() {
  return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--n-400)' }}>Загрузка...</div>;
}

function NoData({ text = "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445" }) {
  return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--n-400)' }}>{text}</div>;
}

function DailySection() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [quarries, setQuarries] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJson('/api/dashboard/analytics/quarries')
      .then(d => setQuarries(d))
      .catch(() => setQuarries(null))
      .finally(() => setLoading(false));
  }, [date]);

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

  const quarryList = quarries?.quarries || [];
  const totalVol = quarryList.reduce((a, q) => a + (q.today_volume || 0), 0);

  return (
    <>
      <PageHeader title={"\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442 \u043F\u043E \u043A\u0430\u0440\u044C\u0435\u0440\u0430\u043C (WIP)"}
        subtitle={"\u0421\u043C\u0435\u043D\u0430 \u0414+\u041D \u00B7 " + new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}
        actions={<>
          <button className="btn" onClick={handleXlsx}><Icon name="download" size={14} />XLSX</button>
          <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14} />{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF-\u0440\u0430\u043F\u043E\u0440\u0442"}</button>
        </>} />
      <FilterBar {...filters} {...setFilters} />

      {loading ? <LoadingSkeleton /> : quarryList.length === 0 ? <NoData /> : (<>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            <div><div style={{ fontSize: 10, color: "var(--n-500)", textTransform: "uppercase" }}>{"\u041A\u0430\u0440\u044C\u0435\u0440\u043E\u0432"}</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{quarryList.length}</div></div>
            <div><div style={{ fontSize: 10, color: "var(--n-500)", textTransform: "uppercase" }}>{"\u041E\u0431\u044A\u0451\u043C \u0437\u0430 \u0441\u0443\u0442\u043A\u0438"}</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmt(Math.round(totalVol))} <span style={{ fontSize: 12, color: "var(--n-500)" }}>{"\u043C\u00B3"}</span></div></div>
            <div><div style={{ fontSize: 10, color: "var(--n-500)", textTransform: "uppercase" }}>{"\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B"}</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{[...new Set(quarryList.map(q => q.material))].join(", ")}</div></div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>{"\u041A\u0430\u0440\u044C\u0435\u0440\u044B"}</h3><div className="sub">{quarryList.length + " \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432"}</div></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr>
                <th>{"\u041A\u0430\u0440\u044C\u0435\u0440"}</th><th>{"\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B"}</th>
                <th className="num">{"\u041F\u043B\u0435\u0447\u043E, \u043A\u043C"}</th>
                <th>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</th>
                <th className="num">{"\u041E\u0431\u044A\u0451\u043C, \u043C\u00B3"}</th>
              </tr></thead>
              <tbody>
                {quarryList.map((q, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{q.name}</td>
                    <td style={{ color: "var(--n-500)" }}>{q.material}</td>
                    <td className="num">{q.distance_km || "\u2014"}</td>
                    <td>{(q.sections || []).join(", ")}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(Math.round(q.today_volume || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}
      <toast.Toast />
    </>
  );
}

function RoadsSection() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [roads, setRoads] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJson('/api/dashboard/analytics/temp-roads')
      .then(d => setRoads(d))
      .catch(() => setRoads(null))
      .finally(() => setLoading(false));
  }, [date]);

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

  const roadList = roads?.roads || [];

  const STATUS_COLORS = {
    shpgs_done: "#16a34a",
    ready_for_shpgs: "#f59e0b",
    subgrade_not_to_grade: "#dc2626",
    pioneer_fill: "#7f1d1d",
  };
  const STATUS_LABELS = {
    shpgs_done: "\u0417\u041F \u0433\u043E\u0442\u043E\u0432\u043E",
    ready_for_shpgs: "\u0413\u043E\u0442\u043E\u0432\u043E \u043A \u0429\u041F\u0413\u0421",
    subgrade_not_to_grade: "\u041D\u0435 \u0432 \u043E\u0442\u043C\u0435\u0442\u043A\u0435",
    pioneer_fill: "\u041F\u0438\u043E\u043D\u0435\u0440\u043D\u044B\u0439",
  };

  return (
    <>
      <PageHeader title={"\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0430\u0432\u0442\u043E\u0434\u043E\u0440\u043E\u0433\u0438 (WIP)"}
        subtitle={roadList.length + " \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432 \u00B7 \u0441\u0442\u0430\u0442\u0443\u0441 \u043E\u0442\u0441\u044B\u043F\u043A\u0438"}
        actions={<>
          <button className="btn" onClick={handleCsv}><Icon name="download" size={14} />CSV</button>
          <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14} />{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF"}</button>
        </>} />
      <FilterBar {...filters} {...setFilters} />

      {loading ? <LoadingSkeleton /> : roadList.length === 0 ? <NoData /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px,1fr))", gap: 12 }}>
          {roadList.map((r, i) => {
            const totalLen = r.length_km ? (r.length_km * 1000) : 0;
            const statuses = r.per_status || {};
            return (
              <div key={i} className="card">
                <div className="card-h">
                  <h3>{r.road_code || r.code}</h3>
                  <div className="sub">{totalLen > 0 ? (r.length_km.toFixed(2) + " \u043A\u043C") : ""}</div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {totalLen > 0 && (
                    <div className="tad" style={{ height: 10, display: "flex", borderRadius: 4, overflow: "hidden" }}>
                      {Object.entries(statuses).map(([st, d]) => (
                        <span key={st} style={{ width: (d.length_m / totalLen * 100) + "%", background: STATUS_COLORS[st] || "#ccc" }} />
                      ))}
                    </div>
                  )}
                  <div className="mono" style={{ fontSize: 10, color: "var(--n-500)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {Object.entries(statuses).map(([st, d]) => (
                      <span key={st}>{STATUS_LABELS[st] || st}: {Math.round(d.length_m)} \u043C</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <toast.Toast />
    </>
  );
}

export function WipDailyRoadsPage() {
  const [tab, setTab] = useState("daily");
  return (
    <div className="wip-shell">
      <div className="page">
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className={"btn " + (tab === "daily" ? "primary" : "")} onClick={() => setTab("daily")}>{"\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0439 \u043E\u0442\u0447\u0451\u0442"}</button>
          <button className={"btn " + (tab === "roads" ? "primary" : "")} onClick={() => setTab("roads")}>{"\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0410\u0414"}</button>
        </div>
        {tab === "daily" ? <DailySection /> : <RoadsSection />}
      </div>
    </div>
  );
}

export default WipDailyRoadsPage;
