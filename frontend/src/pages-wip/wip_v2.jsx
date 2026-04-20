import React from 'react';
import './wip_v2.css';

// This file is deprecated. Routes now use pages-wip-v2/ components.
// Kept as a stub to avoid import errors from any stale references.

export function OverviewV2() {
  return <div style={{padding:40, textAlign:'center', color:'#6b6b6b'}}>Перенаправлено на /wip/overview-v2</div>;
}

export function AnalyticsV2() {
  return <div style={{padding:40, textAlign:'center', color:'#6b6b6b'}}>Перенаправлено на /wip/analytics-v2</div>;
}

export function MapV2() {
  return <div style={{padding:40, textAlign:'center', color:'#6b6b6b'}}>Перенаправлено на /wip/map-v2</div>;
}

export default function WipV2Page() {
  return <OverviewV2 />;
}
