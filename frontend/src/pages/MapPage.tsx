import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { VsmMap } from '../components/map/VsmMap'

export function MapPage() {
  return (
    <div className="relative h-[100dvh] lg:h-full w-full">
      <div className="absolute top-0 left-0 right-0 z-[1000] bg-white/90 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-4">
        <Link to="/" className="text-sm text-accent-red hover:text-accent-dark flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <span className="text-sm font-heading font-semibold text-text-primary">Карта ВСМ</span>
      </div>
      <VsmMap />
    </div>
  )
}
