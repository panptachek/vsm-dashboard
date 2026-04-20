import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Map, FileText, Train, BarChart3, Truck, Eye, LineChart, Route, MapPin, Layers, TrendingUp } from 'lucide-react'

const NAV = [
  { to: '/', icon: BarChart3, label: 'Аналитика' },
  { to: '/map', icon: Map, label: 'Карта' },
  { to: '/reports', icon: FileText, label: 'Отчёты' },
  { to: '/daily-quarry-report', icon: Truck, label: 'Производительность а/с' },
  { to: '/overview', icon: LayoutDashboard, label: 'Обзор' },
]

const WIP_NAV = [
  { to: '/wip/overview', icon: Eye, label: 'Обзор (WIP)' },
  { to: '/wip/analytics', icon: LineChart, label: 'Аналитика (WIP)' },
  { to: '/wip/daily-roads', icon: Route, label: 'Суточный / АД (WIP)' },
  { to: '/wip/map', icon: MapPin, label: 'Карта (WIP)' },
  { to: '/wip/secondary', icon: Layers, label: 'Техника / Отчёт (WIP)' },
  { to: '/wip/overview-v2', icon: Eye, label: 'Обзор v2 (WIP)' },
  { to: '/wip/analytics-v2', icon: TrendingUp, label: 'Аналитика v2 (WIP)' },
  { to: '/wip/map-v2', icon: Map, label: 'Карта v2 (WIP)' },
]

export function Layout() {
  return (
    <div className="flex min-h-dvh bg-bg-primary">
      {/* Sidebar - desktop (dark) */}
      <aside className="hidden lg:flex flex-col w-64 bg-bg-sidebar border-r border-neutral-800 p-4">
        <div className="flex items-center gap-3 mb-8 px-2">
          <Train className="w-8 h-8 text-accent-red" />
          <div>
            <h1 className="text-lg font-bold font-heading text-text-on-dark leading-tight">
              ВСМ Dashboard
            </h1>
            <span className="text-xs text-neutral-500">СПб — Москва</span>
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

        {/* WIP section */}
        <div className="mt-6 pt-4 border-t border-neutral-700">
          <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            WIP (дизайн)
          </div>
          <nav className="flex flex-col gap-1">
            {WIP_NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-accent-burg text-white'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content (light) */}
      <main className="flex-1 overflow-auto bg-bg-primary">
        <Outlet />
      </main>

      {/* Bottom tab bar - mobile (main + WIP v2) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border flex justify-around py-2 px-2 z-50 overflow-x-auto">
        {[...NAV, ...WIP_NAV].map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 text-[9px] transition-colors shrink-0 px-1 ${
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
