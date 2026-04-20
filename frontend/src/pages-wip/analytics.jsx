import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
         ComposedChart, Line } from 'recharts';
import { Icon, fmt, riskCls, useToast, downloadPdf, fetchJson } from './core.jsx';
import { Badge, PageHeader, FilterBar } from './shell.jsx';

function LoadingSkeleton({ title }) {
  return (
    <div className="card" style={{ marginBottom: 14, padding: 24, textAlign: 'center', color: 'var(--n-400)' }}>
      <div style={{ marginBottom: 8, fontWeight: 600 }}>{title}</div>
      Загрузка...
    </div>
  );
}

function NoData({ title }) {
  return (
    <div className="card" style={{ marginBottom: 14, padding: 24, textAlign: 'center', color: 'var(--n-400)' }}>
      <div style={{ marginBottom: 8, fontWeight: 600 }}>{title}</div>
      Нет данных
    </div>
  );
}

export default function WipAnalyticsPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sectionsFilter, setSectionsFilter] = useState([]);
  const [workFilter, setWorkFilter] = useState([]);
  const toast = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [quarries, setQuarries] = useState(null);
  const [piles, setPiles] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchJson('/api/dashboard/analytics/summary').catch(() => null),
      fetchJson('/api/dashboard/analytics/quarries').catch(() => null),
      fetchJson('/api/wip/piles').catch(() => null),
      fetchJson('/api/wip/equipment-productivity?from=2026-04-01&to=' + date).catch(() => null),
    ]).then(([s, q, p, e]) => {
      setSummary(s);
      setQuarries(q);
      setPiles(p);
      setEquipment(e);
    }).finally(() => setLoading(false));
  }, [date]);

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

  // Quarry chart data
  const quarryData = (quarries?.quarries || []).map(q => ({
    name: q.name,
    "\u041E\u0431\u044A\u0451\u043C": Math.round(q.today_volume || 0),
    mat: q.material,
  }));

  // Piles chart data
  const pilesBySec = {};
  (piles?.rows || []).forEach(r => {
    const sec = r.section_code;
    if (!pilesBySec[sec]) pilesBySec[sec] = { main: 0, test: 0 };
    if (r.field_type === 'test') pilesBySec[sec].test += (r.pile_count || 0);
    else pilesBySec[sec].main += (r.pile_count || 0);
  });
  const pileData = Object.entries(pilesBySec).sort(([a],[b]) => a.localeCompare(b)).map(([sec, d]) => ({
    name: sec, "\u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435": d.main, "\u041F\u0440\u043E\u0431\u043D\u044B\u0435": d.test,
  }));

  // Equipment matrix
  const eqRows = (equipment?.rows || []);
  const eqTypes = [...new Set(eqRows.map(r => r.equipment_type))];
  const eqSections = [...new Set(eqRows.map(r => r.section_code))].sort();
  const cellColor = (v) => v >= 85 ? "var(--progress-good)" : v >= 60 ? "var(--progress-warn)" : "var(--progress-bad)";

  return (
    <div className="wip-shell">
      <div className="page">
        <PageHeader title={"\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 (WIP)"} subtitle={"\u0421\u0440\u0430\u0432\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u0438 \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}
          actions={<>
            <button className="btn" onClick={handleCsv}><Icon name="download" size={14} />CSV</button>
            <button className="btn primary" disabled={pdfLoading} onClick={handlePdf}><Icon name="file" size={14} />{pdfLoading ? "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F..." : "PDF-\u043E\u0442\u0447\u0451\u0442"}</button>
          </>} />
        <FilterBar {...filters} {...setFilters} />

        {loading ? (<>
          <LoadingSkeleton title="1. \u0421\u0432\u043E\u0434\u043A\u0430" />
          <LoadingSkeleton title="2. \u041A\u0430\u0440\u044C\u0435\u0440\u044B" />
          <LoadingSkeleton title="3. \u0421\u0432\u0430\u0438" />
          <LoadingSkeleton title="4. \u0422\u0435\u0445\u043D\u0438\u043A\u0430" />
        </>) : (<>

        {/* 1. Summary KPIs */}
        {summary ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h"><h3>{"1. \u0421\u0432\u043E\u0434\u043A\u0430 \u0437\u0430 \u0441\u043C\u0435\u043D\u0443"}</h3></div>
            <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {[
                ["\u041F\u0435\u0441\u043E\u043A", summary.sand],
                ["\u0412\u043E\u0437\u043A\u0430", summary.transport],
                ["\u0429\u041F\u0413\u0421", summary.shps],
                ["\u041F\u0420\u0421", summary.prs],
              ].map(([label, d]) => d && (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "var(--n-500)", textTransform: "uppercase" }}>{label}</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmt(Math.round(d.fact || 0))} <span style={{ fontSize: 11, color: "var(--n-500)" }}>{"\u043C\u00B3"}</span></div>
                  <div style={{ fontSize: 11, color: "var(--n-500)" }}>{"\u043F\u043B\u0430\u043D: "}{fmt(Math.round(d.plan || 0))} {"\u00B7 "}{Math.round(d.percent || 0)}%</div>
                </div>
              ))}
            </div>
          </div>
        ) : <NoData title="1. \u0421\u0432\u043E\u0434\u043A\u0430" />}

        {/* 2. Quarries */}
        {quarryData.length > 0 ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h"><h3>{"2. \u0412\u043E\u0437\u043A\u0430 \u0441 \u043A\u0430\u0440\u044C\u0435\u0440\u043E\u0432"}</h3><div className="sub">{"\u043C\u00B3 \u0437\u0430 \u0441\u0443\u0442\u043A\u0438"}</div></div>
            <div className="card-b" style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={quarryData} layout="vertical" margin={{ left: 120 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#6b6b6b" }} axisLine={{ stroke: "#c9c9c9" }} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#262626" }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #c9c9c9", borderRadius: 4 }} />
                  <Bar dataKey={"\u041E\u0431\u044A\u0451\u043C"} fill="#1a1a1a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <NoData title="2. \u041A\u0430\u0440\u044C\u0435\u0440\u044B" />}

        {/* 3. Piles */}
        {pileData.length > 0 ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h"><h3>{"3. \u0417\u0430\u0431\u0438\u0432\u043A\u0430 \u0441\u0432\u0430\u0439"}</h3><div className="sub">{"\u043A\u043E\u043B-\u0432\u043E \u043F\u043E \u0443\u0447\u0430\u0441\u0442\u043A\u0430\u043C"}</div></div>
            <div className="card-b" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pileData}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#e7e7e7" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b6b6b" }} axisLine={{ stroke: "#c9c9c9" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b6b6b" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #c9c9c9", borderRadius: 4 }} />
                  <Bar dataKey={"\u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435"} fill="var(--accent-red)" />
                  <Bar dataKey={"\u041F\u0440\u043E\u0431\u043D\u044B\u0435"} fill="#858585" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <NoData title="3. \u0421\u0432\u0430\u0439\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B" />}

        {/* 4. Equipment matrix */}
        {eqTypes.length > 0 ? (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h"><h3>{"4. \u041F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u0442\u0435\u0445\u043D\u0438\u043A\u0438"}</h3><div className="sub">{"% \u043E\u0442 \u043D\u043E\u0440\u043C\u044B"}</div></div>
            <div className="card-b" style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>{"\u0422\u0438\u043F"}</th>
                    {eqSections.map(c => <th key={c} className="num">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {eqTypes.map(t => (
                    <tr key={t}>
                      <td style={{ fontWeight: 600 }}>{t}</td>
                      {eqSections.map(sec => {
                        const row = eqRows.find(r => r.equipment_type === t && r.section_code === sec);
                        const pct = row ? Math.round(row.percent) : 0;
                        return (
                          <td key={sec} className="num">
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                              <div style={{ width: 36, height: 6, background: "var(--n-100)", position: "relative" }}>
                                <div style={{ position: "absolute", inset: 0, width: Math.min(100, pct) + "%", background: cellColor(pct) }} />
                              </div>
                              <span style={{ minWidth: 34 }}>{pct}%</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <NoData title="4. \u0422\u0435\u0445\u043D\u0438\u043A\u0430" />}

        </>)}
      </div>
      <toast.Toast />
    </div>
  );
}
