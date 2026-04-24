/**
 * ObjectInfoPopup — содержимое Leaflet-popup для объектов на карте.
 * Ленится: при первом рендере вызывает /api/wip/map/object-info.
 */
import { useQuery } from '@tanstack/react-query'
import { formatPK } from '../../utils/geometry'

interface Props {
  /** object_code или field_code */
  id: string
  /** object_type.code (PIPE/BRIDGE/MAIN_TRACK/…) или 'pile_field' */
  type: string
  /** YYYY-MM-DD */
  dateISO: string
  /** Заголовок для fallback-а пока загружается */
  fallbackTitle?: string
  fallbackSubtitle?: string
}

interface WorkSummaryRow {
  work: string
  unit: string | null
  project_volume: number | null
  completed_volume: number
  completion_pct: number | null
}

interface WorkTotalsRow {
  project_volume: number | null
  completed_volume: number
  completion_pct: number | null
}

interface ObjectInfoResponse {
  kind: 'object' | 'pile_field'
  // Pile field
  field_code?: string
  field_type?: string
  pile_type?: string
  pile_count?: number
  dynamic_test_count?: number
  project_works?: { work: string; unit: string; project_volume: number }[]
  // Object
  type_code?: string
  type_name?: string
  object_code?: string
  name?: string
  pk_start?: number | null
  pk_end?: number | null
  pk_raw_text?: string | null
  cumulative?: { work: string; unit: string; volume: number }[]
  day?: { work: string; unit: string; volume: number }[]
  works_summary?: WorkSummaryRow[]
  works_total?: WorkTotalsRow
  recent_movements?: { material: string; movement_type: string; volume: number; count: number }[]
}

/** Format number with thousand separators: 12500 → "12 500". */
function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

export function ObjectInfoPopup({ id, type, dateISO, fallbackTitle, fallbackSubtitle }: Props) {
  const { data, isLoading, error } = useQuery<ObjectInfoResponse>({
    queryKey: ['wip-map-object-info', id, type, dateISO],
    queryFn: () =>
      fetch(`/api/wip/map/object-info?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}&date=${dateISO}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        }),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div style={{ minWidth: 240, fontSize: 12 }}>
        <strong>{fallbackTitle ?? '…'}</strong>
        <div style={{ color: '#888', marginTop: 4 }}>загружаем…</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div style={{ minWidth: 240, fontSize: 12 }}>
        <strong>{fallbackTitle ?? id}</strong>
        {fallbackSubtitle && <div style={{ color: '#666', fontSize: 11 }}>{fallbackSubtitle}</div>}
        <div style={{ color: '#c22', marginTop: 4 }}>Нет данных</div>
      </div>
    )
  }

  if (data.kind === 'pile_field') {
    return (
      <div style={{ minWidth: 240, fontSize: 12 }}>
        <strong>Свайное поле {data.field_code}</strong>
        <div style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>
          {data.pk_start != null && data.pk_end != null
            ? `${formatPK(data.pk_start)} — ${formatPK(data.pk_end)}`
            : (data.pk_raw_text ?? '—')}
        </div>
        <table style={tblStyle}>
          <tbody>
            <tr><td style={tdL}>Тип поля</td><td style={tdR}>{data.field_type === 'main' ? 'основное' : 'пробное'}</td></tr>
            <tr><td style={tdL}>Тип свай</td><td style={tdR}>{data.pile_type}</td></tr>
            <tr><td style={tdL}>Свай</td><td style={tdR}>{data.pile_count}</td></tr>
            <tr><td style={tdL}>Испытаний</td><td style={tdR}>{data.dynamic_test_count ?? 0}</td></tr>
          </tbody>
        </table>
        {data.works_summary && data.works_summary.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={hdr}>Работы: план / факт на дату</div>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={{ ...tdL, fontWeight: 600 }}>Работа</th>
                  <th style={{ ...tdR, fontWeight: 600 }}>Проект</th>
                  <th style={{ ...tdR, fontWeight: 600 }}>Факт</th>
                  <th style={{ ...tdR, fontWeight: 600 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {data.works_summary.map((r, i) => (
                  <tr key={i}>
                    <td style={tdL}>{r.work}</td>
                    <td style={tdR}>{r.project_volume != null ? `${fmt(r.project_volume)} ${r.unit ?? ''}` : '—'}</td>
                    <td style={tdR}>{fmt(r.completed_volume ?? 0)} {r.unit ?? ''}</td>
                    <td style={tdR}>{r.completion_pct != null ? `${Math.round(r.completion_pct)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data.project_works && data.project_works.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={hdr}>Плановые объёмы</div>
            <table style={tblStyle}>
              <tbody>
                {data.project_works.map((r, i) => (
                  <tr key={i}>
                    <td style={tdL}>{r.work}</td>
                    <td style={tdR}>{fmt(r.project_volume)} {r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ marginTop: 6, color: '#888', fontSize: 11 }}>Нет данных по работам</div>
        )}
      </div>
    )
  }

  // kind === 'object' — формат ПК всегда «ПК####+##.##», игнорируем pk_raw_text
  // из БД (там может лежать «323730.67-324037.27» — сырые метры).
  const pkRange = data.pk_start != null
    ? `${formatPK(data.pk_start)}${data.pk_end != null ? ` — ${formatPK(data.pk_end)}` : ''}`
    : (data.pk_raw_text ?? null)

  return (
    <div style={{ minWidth: 260, maxWidth: 420, fontSize: 12 }}>
      <strong>{data.name ?? data.object_code}</strong>
      <div style={{ color: '#666', fontSize: 11 }}>{data.type_name}</div>
      {pkRange && <div style={{ color: '#666', fontSize: 11, marginBottom: 6 }}>{pkRange}</div>}

      {data.works_summary && data.works_summary.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={hdr}>Работы: план / факт</div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thL}>Работа</th>
                <th style={thR}>Проект</th>
                <th style={thR}>Факт</th>
                <th style={thR}>%</th>
              </tr>
            </thead>
            <tbody>
              {data.works_summary.map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{r.work}</td>
                  <td style={tdR}>
                    {r.project_volume != null ? `${fmt(r.project_volume)} ${r.unit ?? ''}` : '—'}
                  </td>
                  <td style={tdR}>
                    {r.completed_volume > 0 ? `${fmt(r.completed_volume)} ${r.unit ?? ''}` : '—'}
                  </td>
                  <td style={tdR}>{r.completion_pct != null ? `${r.completion_pct}%` : '—'}</td>
                </tr>
              ))}
              {data.works_total && (
                <tr>
                  <td style={tdTotalL}>Итого по объекту</td>
                  <td style={tdTotalR}>
                    {data.works_total.project_volume != null ? fmt(data.works_total.project_volume) : '—'}
                  </td>
                  <td style={tdTotalR}>{fmt(data.works_total.completed_volume)}</td>
                  <td style={tdTotalR}>
                    {data.works_total.completion_pct != null ? `${data.works_total.completion_pct}%` : '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data.works_summary && data.works_summary.length === 0 && (
        <div style={{ marginTop: 6, color: '#888', fontSize: 11, fontStyle: 'italic' }}>
          Нет плановых объёмов
        </div>
      )}

      {data.day && data.day.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={hdr}>За {dateISO}</div>
          <table style={tblStyle}>
            <tbody>
              {data.day.map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{r.work}</td>
                  <td style={tdR}>{r.volume} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.cumulative && data.cumulative.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={hdr}>Накопительно</div>
          <table style={tblStyle}>
            <tbody>
              {data.cumulative.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{r.work}</td>
                  <td style={tdR}>{r.volume} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.recent_movements && data.recent_movements.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={hdr}>Движение материала (30 дн.)</div>
          <table style={tblStyle}>
            <tbody>
              {data.recent_movements.map((r, i) => (
                <tr key={i}>
                  <td style={tdL}>{r.material}</td>
                  <td style={tdR}>{r.volume} · {r.count}шт</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const tblStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
}
// Текстовая колонка «Работа» — обычный шрифт.
const tdL: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid #eee', color: '#333' }
// Числовые — моно.
const tdR: React.CSSProperties = {
  padding: '2px 4px', borderBottom: '1px solid #eee', textAlign: 'right', whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, monospace',
}
const thL: React.CSSProperties = {
  padding: '2px 4px', borderBottom: '1px solid #ccc', textAlign: 'left',
  fontSize: 10, color: '#666', fontWeight: 600, textTransform: 'uppercase',
}
const thR: React.CSSProperties = {
  padding: '2px 4px', borderBottom: '1px solid #ccc', textAlign: 'right', whiteSpace: 'nowrap',
  fontSize: 10, color: '#666', fontWeight: 600, textTransform: 'uppercase',
}
const hdr: React.CSSProperties = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  color: '#888', fontWeight: 700, marginBottom: 2,
}
// Итог по объекту — выделенный стиль в духе Excel: двойная отсечка сверху, серый фон, bold.
const tdTotalL: React.CSSProperties = {
  padding: '4px', borderTop: '2px solid #333', background: '#f3f4f6',
  color: '#111', fontWeight: 700,
}
const tdTotalR: React.CSSProperties = {
  padding: '4px', borderTop: '2px solid #333', background: '#f3f4f6',
  textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700,
  fontFamily: 'ui-monospace, monospace',
}
