import type { QuarryReportRow } from '../../pages/DailyQuarryReport'

interface Props {
  sectionNumber: number
  rows: QuarryReportRow[]
  fmt: (n: number) => string
}

export function QuarryReportTable({ sectionNumber, rows, fmt }: Props) {
  // Section total row
  const totalRow = {
    planTrips: rows.reduce((a, r) => a + r.planTrips, 0),
    techDay: rows.reduce((a, r) => a + r.techDay, 0),
    techNight: rows.reduce((a, r) => a + r.techNight, 0),
    outputDay: rows.reduce((a, r) => a + r.outputDay, 0),
    outputNight: rows.reduce((a, r) => a + r.outputNight, 0),
    outputTotal: rows.reduce((a, r) => a + r.outputTotal, 0),
  }

  return (
    <div className="bg-bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-2.5 bg-bg-sidebar text-text-on-dark flex items-center gap-2">
        <span className="text-sm font-heading font-semibold">
          {`\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u2116${sectionNumber}`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-surface text-xs text-text-muted">
              <th className="text-left px-3 py-2.5 font-medium whitespace-nowrap w-8">#</th>
              <th className="text-left px-3 py-2.5 font-medium whitespace-nowrap min-w-[200px]">{'\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u2116'}</th>
              <th className="text-left px-3 py-2.5 font-medium whitespace-nowrap min-w-[140px]">{'\u041A\u0430\u0440\u044C\u0435\u0440'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u041F\u043B\u0435\u0447\u043E, \u043A\u043C'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u041F\u043B\u0430\u043D \u0440\u0435\u0439\u0441\u043E\u0432\n\u0432 \u0441\u043C\u0435\u043D\u0443'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u0414'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u041D'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u0412\u044B\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0414\n(\u043C\u00B3)'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u0412\u044B\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u041D\n(\u043C\u00B3)'}</th>
              <th className="text-center px-3 py-2.5 font-medium whitespace-nowrap">{'\u0412\u044B\u0440\u0430\u0431\u043E\u0442\u043A\u0430\n\u0441\u0443\u0442\u043A\u0438 (\u043C\u00B3)'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.category}
                className={`border-b border-border/30 ${
                  i % 2 === 0 ? 'bg-white' : 'bg-bg-surface/50'
                }`}
              >
                <td className="px-3 py-2 text-xs text-text-muted font-mono">{i + 1}</td>
                <td className="px-3 py-2 text-xs text-text-primary font-medium">{row.category}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{row.quarry}</td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-secondary">
                  {row.armKm > 0 ? row.armKm : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-secondary">
                  {row.planTrips > 0 ? fmt(row.planTrips) : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-secondary">
                  {row.techDay > 0 ? fmt(row.techDay) : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-secondary">
                  {row.techNight > 0 ? fmt(row.techNight) : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-primary">
                  {row.outputDay > 0 ? fmt(row.outputDay) : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono text-text-primary">
                  {row.outputNight > 0 ? fmt(row.outputNight) : '\u2014'}
                </td>
                <td className="px-3 py-2 text-center text-xs font-mono font-semibold text-text-primary">
                  {row.outputTotal > 0 ? fmt(row.outputTotal) : '\u2014'}
                </td>
              </tr>
            ))}
            {/* Section total */}
            <tr className="border-t-2 border-accent-red/30 bg-bg-surface font-semibold">
              <td className="px-3 py-2.5" colSpan={2}>
                <span className="text-xs text-text-primary">
                  {`\u0418\u0442\u043E\u0433\u043E \u043F\u043E ${sectionNumber} \u0443\u0447\u0430\u0441\u0442\u043A\u0443`}
                </span>
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-center text-xs font-mono text-text-primary">
                {totalRow.planTrips > 0 ? fmt(totalRow.planTrips) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-mono text-text-primary">
                {totalRow.techDay > 0 ? fmt(totalRow.techDay) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-mono text-text-primary">
                {totalRow.techNight > 0 ? fmt(totalRow.techNight) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-mono text-accent-red">
                {totalRow.outputDay > 0 ? fmt(totalRow.outputDay) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-mono text-accent-red">
                {totalRow.outputNight > 0 ? fmt(totalRow.outputNight) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 text-center text-xs font-mono font-bold text-accent-red">
                {totalRow.outputTotal > 0 ? fmt(totalRow.outputTotal) : '\u2014'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
