import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Map, BarChart3, Train, Truck, FileText, Database, Settings, LandPlot } from 'lucide-react'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Обзор' },
  { to: '/map', icon: Map, label: 'Карта трассы' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
  { to: '/mechanization', icon: Truck, label: 'Механизация' },
  { to: '/reinforcement', icon: LandPlot, label: 'Участки усиления' },
  { to: '/reports', icon: FileText, label: 'Отчёты' },
  { to: '/database', icon: Database, label: 'База данных' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
]

export function Layout() {
  const loc = useLocation()
  // Карта — full-bleed, без max-w. Остальные страницы ограничиваем на широких мониторах.
  const isMap = loc.pathname.startsWith('/map')
  return (
    <div className="flex min-h-dvh bg-bg-primary">
      <aside className="hidden lg:flex flex-col w-64 bg-bg-sidebar border-r border-neutral-800 p-4">
        <div className="flex items-center gap-3 mb-8 px-2">
          <Train className="w-8 h-8 text-accent-red" />
          <div>
            <h1 className="text-lg font-bold font-heading text-text-on-dark leading-tight">
              ВСМ ЖДС
            </h1>
            <span className="text-xs text-neutral-400 block leading-tight">Аналитическое табло</span>
            <span className="text-[10px] text-neutral-500 block leading-tight">3 этап</span>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-accent-burg text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto bg-bg-primary">
        {isMap ? (
          <Outlet />
        ) : (
          <div className="max-w-[1800px] mx-auto">
            <Outlet />
          </div>
        )}
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border flex justify-around py-2 px-2 z-50">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 text-[10px] transition-colors shrink-0 px-2 ${
                isActive ? 'text-accent-red' : 'text-text-muted'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="whitespace-nowrap">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
