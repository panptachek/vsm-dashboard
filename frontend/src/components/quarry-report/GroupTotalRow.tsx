interface Props {
  label: string
  techDay: number
  techNight: number
  outputDay: number
  outputNight: number
  outputTotal: number
  fmt: (n: number) => string
  isGrand?: boolean
}

export function GroupTotalRow({
  label,
  techDay,
  techNight,
  outputDay,
  outputNight,
  outputTotal,
  fmt,
  isGrand,
}: Props) {
  const bgClass = isGrand
    ? 'bg-accent-burg text-white'
    : 'bg-bg-sidebar text-text-on-dark'

  return (
    <div className={`rounded-xl overflow-hidden shadow-sm ${bgClass}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="px-4 py-3 font-heading font-semibold text-sm whitespace-nowrap" style={{ minWidth: 320 }}>
                {label}
              </td>
              {/* Empty cells for: quarry, arm, plan trips */}
              <td className="px-3 py-3" />
              <td className="px-3 py-3" />
              <td className="px-3 py-3" />
              <td className="px-3 py-3 text-center font-mono text-xs">
                {techDay > 0 ? fmt(techDay) : '\u2014'}
              </td>
              <td className="px-3 py-3 text-center font-mono text-xs">
                {techNight > 0 ? fmt(techNight) : '\u2014'}
              </td>
              <td className="px-3 py-3 text-center font-mono text-xs">
                {outputDay > 0 ? fmt(outputDay) : '\u2014'}
              </td>
              <td className="px-3 py-3 text-center font-mono text-xs">
                {outputNight > 0 ? fmt(outputNight) : '\u2014'}
              </td>
              <td className="px-3 py-3 text-center font-mono text-sm font-bold">
                {outputTotal > 0 ? fmt(outputTotal) : '\u2014'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
