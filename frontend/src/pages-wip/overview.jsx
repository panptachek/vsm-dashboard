import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Icon, fmt, riskCls, trendArrow, useToast, downloadPdf, fetchJson } from './core.jsx';
import { ProgressRow, Kpi, Badge, PageHeader, FilterBar } from './shell.jsx';

function LoadingSkeleton({ h = 200 }) {
  return <div className="card" style={{ height: h, display: 'grid', placeItems: 'center', color: 'var(--n-400)' }}>Загрузка...</div>;
}

function NoData({ text = "Нет данных" }) {
  return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--n-400)' }}>{text}</div>;
}

function SectionCard({ sec, onOpen }) {
  const pct = Math.round(sec.progress_percent ?? 0);
  const risk = pct >= 70 ? "good" : pct >= 50 ? "warn" : "bad";
  return (
    <div className="card" style={{ cursor: "pointer" }} onClick={() => onOpen && onOpen(sec.code)}>
      <div className="card-h">
        <div>
          <h3>{sec.name}</h3>
          <div className="sub">{sec.pk_range}</div>
        </div>
        <div className="actions"><Badge kind={risk}>{risk === "good" ? "\u0432 \u043F\u043B\u0430\u043D\u0435" : risk === "warn" ? "\u0440\u0438\u0441\u043A" : "\u043E\u0442\u0441\u0442\u0430\u0432\u0430\u043D\u0438\u0435"}</Badge></div>
      </div>
      <div className="card-b" style={{ paddingTop: 10 }}>
        <ProgressRow label={"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"} val={pct} trend={0} />
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--n-75)",
                       display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px",
                       fontSize: 11, color: "var(--n-700)" }}>
          <div><span style={{ color: "var(--n-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{"\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E"}</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>{fmt(Math.round(sec.completed_volume || 0))} <span style={{ fontSize: 10, color: "var(--n-500)" }}>{"\u043C\u00B3"}</span></div></div>
          <div><span style={{ color: "var(--n-500)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{"\u041F\u043B\u0430\u043D"}</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>{fmt(Math.round(sec.planned_volume || 0))} <span style={{ fontSize: 10, color: "var(--n-500)" }}>{"\u043C\u00B3"}</span></div></div>
        </div>
      </div>
    </div>
  );
}

function SectionTable({ sections, onOpen }) {
  if (!sections || !sections.length) return <NoData text={"\u041D\u0435\u0442 \u0443\u0447\u0430\u0441\u0442\u043A\u043E\u0432"} />;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr>
            <th>{"\u0423\u0447\u0430\u0441\u0442\u043E\u043A"}</th><th>{"\u041F\u0438\u043A\u0435\u0442\u0430\u0436"}</th>
            <th className="num">{"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"}</th>
            <th className="num">{"\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E, \u043C\u00B3"}</th>
            <th className="num">{"\u041F\u043B\u0430\u043D, \u043C\u00B3"}</th>
            <th>{"\u0421\u0442\u0430\u0442\u0443\u0441"}</th><th></th>
          </tr></thead>
          <tbody>
            {sections.map((s) => {
              const pct = Math.round(s.progress_percent ?? 0);
              const risk = pct >= 70 ? "good" : pct >= 50 ? "warn" : "bad";
              return (
                <tr key={s.code} onClick={() => onOpen && onOpen(s.code)} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td className="mono" style={{ color: "var(--n-500)" }}>{s.pk_range}</td>
                  <td className="num"><div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                    <div className="progress" style={{ width: 60 }}><div className={"bar " + riskCls(pct)} style={{ width: pct + "%" }} /></div>
                    <span style={{ width: 30 }}>{pct}%</span></div></td>
                  <td className="num">{fmt(Math.round(s.completed_volume || 0))}</td>
                  <td className="num">{fmt(Math.round(s.planned_volume || 0))}</td>
                  <td><Badge kind={risk}>{risk === "good" ? "\u0432 \u043F\u043B\u0430\u043D\u0435" : risk === "warn" ? "\u0440\u0438\u0441\u043A" : "\u043E\u0442\u0441\u0442\u0430\u0432\u0430\u043D\u0438\u0435"}</Badge></td>
                  <td><Icon name="chevronRight" size={14} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionChartsView({ sections, onOpen }) {
  if (!sections || !sections.length) return <NoData text={"\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445"} />;
  const data = sections.map((s) => ({
    name: s.name, "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441": Math.round(s.progress_percent ?? 0), code: s.code
  }));
  return (
    <div className="card">
      <div className="card-h"><h3>{"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}</h3><div className="sub">{"\u0025 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u043D\u0430"}</div></div>
      <div className="card-b" style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="22%" onClick={(e) => e && e.activePayload && onOpen && onOpen(e.activePayload[0].payload.code)}>
            <CartesianGrid strokeDasharray="2 4" stroke="#e7e7e7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b6b6b", fontFamily: "Saira" }} axisLine={{ stroke: "#e7e7e7" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#6b6b6b", fontFamily: "Saira" }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #e7e7e7", borderRadius: 8, padding: "8px 10px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey={"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"} fill="#1a1a1a" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, kind }) {
  return (
    <div className={"kpi " + (kind || "")}>
      <div className="label">{label}</div>
      <div className="value">{fmt(value)}<span className="unit">{unit}</span></div>
    </div>
  );
}

export default function WipOverviewPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("cards");
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJson('/api/dashboard/summary')
      .then(d => setSummary(d))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [date]);

  const filters = { date, sectionsFilter, workFilter };
  const setFilters = {
    setDate, setSectionsFilter, setWorkFilter,
    onReset: () => { setSectionsFilter([]); setWorkFilter([]); },
    onStub: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportCsv: () => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435"),
    onExportPdf: () => handlePdf(),
  };

  const onOpenSection = useCallback((code) => {
    navigate("/sections/" + code);
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

  const sections = summary?.sections || [];
  const totalCompleted = sections.reduce((s, sec) => s + (sec.completed_volume || 0), 0);
  const totalPlanned = sections.reduce((s, sec) => s + (sec.planned_volume || 0), 0);
  const overallPct = totalPlanned > 0 ? Math.round(totalCompleted / totalPlanned * 100) : 0;

  return (
    <div className="wip-shell">
      <div className="page">
        <PageHeader title={"\u041E\u0431\u0437\u043E\u0440 (WIP)"}
          subtitle={sections.length + " \u0443\u0447\u0430\u0441\u0442\u043A\u043E\u0432 \u00B7 " + new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}
          actions={<>
            <div className="segmented">
              <button className={viewMode === "cards" ? "on" : ""} onClick={() => setViewMode("cards")}>{"\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438"}</button>
              <button className={viewMode === "table" ? "on" : ""} onClick={() => setViewMode("table")}>{"\u0422\u0430\u0431\u043B\u0438\u0446\u0430"}</button>
              <button className={viewMode === "charts" ? "on" : ""} onClick={() => setViewMode("charts")}>{"\u0413\u0440\u0430\u0444\u0438\u043A\u0438"}</button>
            </div>
            <button className="btn" onClick={() => toast.show("\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435")}><Icon name="download" size={14} />{"\u042D\u043A\u0441\u043F\u043E\u0440\u0442"}</button>
            <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14} />{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF"}</button>
          </>} />
        <FilterBar {...filters} {...setFilters} />

        {loading ? <LoadingSkeleton h={300} /> : !summary ? <NoData text={"\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435"} /> : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, marginBottom: 14 }}>
            <KpiCard label={"\u041E\u0431\u0449\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"} value={overallPct} unit={"%"} kind="accent" />
            <KpiCard label={"\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E"} value={Math.round(totalCompleted)} unit={"\u043C\u00B3"} />
            <KpiCard label={"\u041F\u043B\u0430\u043D"} value={Math.round(totalPlanned)} unit={"\u043C\u00B3"} />
          </div>

          <div>
            {viewMode === "cards" && (<>
              <div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</h2><div className="hint">{sections.length}</div><div className="rule" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {sections.map((s) => <SectionCard key={s.code} sec={s} onOpen={onOpenSection} />)}
              </div>
            </>)}
            {viewMode === "table" && (<><div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438 \u00B7 \u0442\u0430\u0431\u043B\u0438\u0446\u0430"}</h2><div className="rule" /></div><SectionTable sections={sections} onOpen={onOpenSection} /></>)}
            {viewMode === "charts" && (<><div className="section-title"><h2>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438 \u00B7 \u0433\u0440\u0430\u0444\u0438\u043A\u0438"}</h2><div className="rule" /></div><SectionChartsView sections={sections} onOpen={onOpenSection} /></>)}
          </div>
        </>)}
      </div>
      <toast.Toast />
    </div>
  );
}
