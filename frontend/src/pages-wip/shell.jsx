import React, { useState, useEffect } from 'react';
import { Icon, fmt, riskCls, trendArrow, fetchJson } from './core.jsx';

// ---------------- Small UI bits ----------------
export function ProgressRow({ label, val, unit = "%", trend }) {
  const cls = riskCls(val);
  return (
    <div className="progress-row">
      <div className="pr-label">{label}</div>
      <div className="progress"><div className={"bar " + cls} style={{ width: val + "%" }} /></div>
      <div className="pr-val">{val}{unit}</div>
      <div className={"pr-trend " + (trend > 0 ? "up" : trend < 0 ? "down" : "flat")}>{trendArrow(trend || 0)}</div>
    </div>
  );
}

export function Kpi({ label, value, unit, delta, deltaLabel }) {
  const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{fmt(value)}<span className="unit">{unit}</span></div>
      <div className={"delta " + cls}>
        {delta != null && <>{delta > 0 ? "\u25B2" : delta < 0 ? "\u25BC" : "\u2014"} {Math.abs(delta)}%</>}
        {deltaLabel && <span style={{ color: "var(--n-500)", marginLeft: 4 }}>{deltaLabel}</span>}
      </div>
    </div>
  );
}

export function Badge({ kind = "neutral", children }) {
  return <span className={"badge " + kind}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="meta" style={{ marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}

// Filter bar — sections fetched from API
export function FilterBar({ date, setDate, sectionsFilter, setSectionsFilter, workFilter, setWorkFilter, onReset, onExportPdf, onExportCsv, onStub }) {
  const [sections, setSections] = useState([]);

  useEffect(() => {
    fetchJson('/api/geo/sections')
      .then(d => setSections(Array.isArray(d) ? d.filter(s => s.pk_start) : []))
      .catch(() => setSections([]));
  }, []);

  const works = [
    { id: "sand", label: "\u041F\u0435\u0441\u043E\u043A" },
    { id: "shpgs", label: "\u0429\u041F\u0413\u0421" },
    { id: "pile", label: "\u0421\u0432\u0430\u0438" },
    { id: "bridge", label: "\u0418\u0441\u043A\u0443\u0441\u0441\u0442\u0432.\u0441\u043E\u043E\u0440." },
    { id: "roads", label: "\u0412\u0440\u0435\u043C. \u0410\u0414" },
  ];
  const toggle = (set, arr, id) => set(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  const fallback = onStub || (() => {});
  return (
    <div className="filters">
      <span className="label">{"\u0414\u0430\u0442\u0430"}</span>
      <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
      <span className="label" style={{ marginLeft: 6 }}>{"\u0423\u0447\u0430\u0441\u0442\u043A\u0438"}</span>
      {sections.map(s => (
        <span key={s.code}
          className={"chip " + (sectionsFilter.includes(s.code) ? "on" : "")}
          onClick={() => toggle(setSectionsFilter, sectionsFilter, s.code)}>
          {s.name.replace("\u0423\u0447\u0430\u0441\u0442\u043E\u043A ", "\u2116")}
        </span>
      ))}
      <span className="label" style={{ marginLeft: 6 }}>{"\u0420\u0430\u0431\u043E\u0442\u044B"}</span>
      {works.map(w => (
        <span key={w.id}
          className={"chip " + (workFilter.includes(w.id) ? "on" : "")}
          onClick={() => toggle(setWorkFilter, workFilter, w.id)}>
          {w.label}
        </span>
      ))}
      <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onReset}>{"\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C"}</button>
      <button className="btn sm" onClick={onExportCsv || fallback}><Icon name="download" size={13} />{"\u042D\u043A\u0441\u043F\u043E\u0440\u0442"}</button>
      <button className="btn primary sm" onClick={onExportPdf || fallback}><Icon name="file" size={13} />PDF</button>
    </div>
  );
}
