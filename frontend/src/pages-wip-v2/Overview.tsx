/**
 * WIP Overview v2 — 4 блока, все данные из /api/wip/*.
 * Ни одного mock. Есть три режима отображения:
 *   'table' — плотная матрица,
 *   'cards' — карточки по участкам,
 *   'timeline' — таймлайн событий.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { LayoutGrid, Table2, Clock3 } from 'lucide-react'
import { PeriodBar, usePeriod } from './PeriodBar'
import { TempRoadsBlock } from './blocks/TempRoadsBlock'
import { MaterialFlowBlock } from './blocks/MaterialFlowBlock'
import { PilesBlock } from './blocks/PilesBlock'
import { EquipmentBlock } from './blocks/EquipmentBlock'

type ViewMode = 'table' | 'cards' | 'timeline'

export default function WipOverviewV2() {
  const { from, to } = usePeriod()
  const [view, setView] = useState<ViewMode>('cards')

  // Предзагрузка подрядчиков — используется в MaterialFlowBlock
  useQuery({
    queryKey: ['wip', 'contractors'],
    queryFn: () => fetch('/api/wip/contractors').then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="flex flex-col min-h-full bg-bg-primary">
      <PeriodBar />

      <div className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-border bg-white">
        <h1 className="text-xl font-heading font-bold text-text-primary mr-auto">
          Обзор (WIP v2)
        </h1>
        <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-1">
          <ViewChip icon={Table2}    active={view==='table'}    onClick={() => setView('table')} label="Таблица" />
          <ViewChip icon={LayoutGrid} active={view==='cards'}    onClick={() => setView('cards')} label="Карточки" />
          <ViewChip icon={Clock3}     active={view==='timeline'} onClick={() => setView('timeline')} label="Таймлайн" />
        </div>
      </div>

      <div className="p-4 sm:p-6 pb-24 lg:pb-6 space-y-6">
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <TempRoadsBlock to={to} view={view} />
        </motion.div>
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.05}}>
          <MaterialFlowBlock from={from} to={to} view={view} />
        </motion.div>
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.1}}>
          <PilesBlock from={from} to={to} view={view} />
        </motion.div>
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.15}}>
          <EquipmentBlock from={from} to={to} view={view} />
        </motion.div>
      </div>
    </div>
  )
}

function ViewChip({ icon: Icon, active, onClick, label }: {
  icon: React.ElementType; active: boolean; onClick: () => void; label: string
}) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition ${
        active ? 'bg-white shadow-sm text-text-primary' : 'text-text-muted hover:text-text-primary'
      }`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}
