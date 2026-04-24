/**
 * MapV3 — карта ВСМ с восстановленным «богатым» дизайном из components/map
 * + выдвижной слева фильтр + слой техники на объектах.
 *
 * Фильтры (транзиентные, не сохраняются):
 *   - Дата (для слоя техники), по умолчанию сегодня.
 *   - Участок (мультивыбор UCH_1..UCH_8 или «все»).
 *   - Диапазон ПК (от/до в целых пикетах).
 *   - Тип объектов (checkbox-ы).
 *   - Тип техники (checkbox-ы).
 */
import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  SlidersHorizontal, X,
  Waypoints, Columns3, Route, GitFork, Building2,
} from 'lucide-react'

import { VsmMap } from '../components/map/VsmMap'
import type { EquipKey } from '../components/map/EquipmentLayer'
import type { ObjectTypeKey } from '../types/geo'

type LucideIcon = React.ComponentType<{ className?: string }>

// В БД участок 3 разбит на UCH_31 (до уч.4) и UCH_32 (после уч.4), т. к. уч.4
// географически внутри уч.3. Для UI объединяем: чекбокс «Уч. 3» тоггает обе
// группы разом. Пользователю не видно 3_1 / 3_2.
const SECTIONS_UI: { key: string; codes: string[]; label: string }[] = [
  { key: '1', codes: ['UCH_1'], label: 'Уч. 1' },
  { key: '2', codes: ['UCH_2'], label: 'Уч. 2' },
  { key: '3', codes: ['UCH_3'], label: 'Уч. 3' },
  { key: '4', codes: ['UCH_4'], label: 'Уч. 4' },
  { key: '5', codes: ['UCH_5'], label: 'Уч. 5' },
  { key: '6', codes: ['UCH_6'], label: 'Уч. 6' },
  { key: '7', codes: ['UCH_7'], label: 'Уч. 7' },
  { key: '8', codes: ['UCH_8'], label: 'Уч. 8' },
]
const ALL_SECTIONS = SECTIONS_UI.flatMap(s => s.codes)

// Для pile_field используем pile_driver.svg (копёр) вместо lucide Anchor.
// 'temp_road' — псевдо-ключ, не в ObjectTypeKey, обрабатываем отдельно.
const OBJ_TYPES: { key: ObjectTypeKey | 'temp_road'; label: string; Icon?: LucideIcon; iconSrc?: string; color: string }[] = [
  { key: 'bridge',            label: 'Мосты',                           Icon: Building2,                               color: '#1f2937' },
  { key: 'pipe',              label: 'Трубы',                           Icon: Route,                                    color: '#ff7f00' },
  { key: 'overpass',          label: 'Путепроводы (ИССО)',              Icon: Waypoints,                                color: '#05008e' },
  { key: 'pile_field',        label: 'Свайные поля',                    iconSrc: '/icons/pile_driver.svg',              color: '#007fff' },
  { key: 'intersection_fin',  label: 'Пересечения (фин.)',              Icon: GitFork,                                  color: '#00a84f' },
  { key: 'intersection_prop', label: 'Пересечения (имущ.)',             Icon: Columns3,                                 color: '#cc00cc' },
  { key: 'temp_road',         label: 'Временные притрассовые дороги',   Icon: Route,                                    color: '#0891b2' },
]

// Лёгкая палитра секций для свотчей в фильтре (совпадает со стилем map highlights).
const SECTION_SWATCH: Record<string, string> = {
  '1': '#ef4444', '2': '#f59e0b', '3': '#eab308', '4': '#22c55e',
  '5': '#06b6d4', '6': '#3b82f6', '7': '#8b5cf6', '8': '#ec4899',
}

const EQUIP_TYPES: { key: EquipKey; label: string }[] = [
  { key: 'dump_truck', label: 'Самосвал' },
  { key: 'excavator', label: 'Экскаватор' },
  { key: 'bulldozer', label: 'Бульдозер' },
  { key: 'motor_grader', label: 'Автогрейдер' },
  { key: 'road_roller', label: 'Каток' },
  { key: 'pile_driver', label: 'Копёр' },
]

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export default function MapV3() {
  const [open, setOpen] = useState(false)

  const [dateISO, setDateISO] = useState<string>(todayISO())
  const [sections, setSections] = useState<Set<string>>(new Set(ALL_SECTIONS))
  const [pkFrom, setPkFrom] = useState<string>('')
  const [pkTo, setPkTo] = useState<string>('')
  const [objTypes, setObjTypes] = useState<Set<ObjectTypeKey>>(
    new Set(OBJ_TYPES.filter((t) => t.key !== 'temp_road').map((t) => t.key) as ObjectTypeKey[]),
  )
  const [showTempRoads, setShowTempRoads] = useState<boolean>(true)
  const [equipTypes, setEquipTypes] = useState<Set<EquipKey>>(
    new Set(EQUIP_TYPES.map((t) => t.key)),
  )

  // Toggles a UI-section: flips ALL of its raw codes together (UCH_31/UCH_32 etc).
  const toggleSectionUI = useCallback((codes: string[]) => {
    setSections((prev) => {
      const next = new Set(prev)
      const allIn = codes.every((c) => next.has(c))
      if (allIn) codes.forEach((c) => next.delete(c))
      else codes.forEach((c) => next.add(c))
      return next
    })
  }, [])
  const selectAllSections = useCallback(() => setSections(new Set(ALL_SECTIONS)), [])
  const clearSections = useCallback(() => setSections(new Set()), [])

  const toggleObjType = useCallback((k: ObjectTypeKey | 'temp_road') => {
    if (k === 'temp_road') {
      setShowTempRoads((v) => !v)
      return
    }
    setObjTypes((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])
  const toggleEquipType = useCallback((k: EquipKey) => {
    setEquipTypes((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  const pkRange = useMemo<[number | null, number | null]>(() => {
    const from = pkFrom.trim() ? Number(pkFrom) : null
    const to = pkTo.trim() ? Number(pkTo) : null
    return [Number.isFinite(from) ? from : null, Number.isFinite(to) ? to : null]
  }, [pkFrom, pkTo])

  const enabledSectionCodes = sections.size === ALL_SECTIONS.length ? null : sections

  return (
    <div className="relative h-[100dvh] lg:h-full w-full">
      {/* Floating open-button — kept top-left; zoom controls moved to topright */}
      <button
        onClick={() => setOpen(true)}
        className="absolute top-4 left-4 z-[1100] flex items-center gap-2 px-4 py-2.5
                   rounded-lg bg-white/95 backdrop-blur-sm border border-border shadow-lg
                   text-base font-medium text-text-primary hover:bg-white transition-colors"
      >
        <SlidersHorizontal className="w-5 h-5" />
        Фильтр
      </button>

      {/* Map */}
      <div className="absolute inset-0">
        <VsmMap
          equipmentDateISO={dateISO}
          enabledEquipmentTypes={equipTypes}
          enabledSectionCodes={enabledSectionCodes}
          pkRange={pkRange}
          objectTypeFilterOverride={objTypes}
          enableTempRoads={showTempRoads}
          hideBuiltInControls
        />
      </div>

      {/* Slide-out filter drawer */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[1200] bg-black/20"
            />
            {/* Panel — wider for larger text/icons (was 320px) */}
            <motion.aside
              key="panel"
              initial={{ x: -420 }}
              animate={{ x: 0 }}
              exit={{ x: -420 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              className="fixed top-0 left-0 bottom-0 z-[1201] w-[400px] bg-white border-r border-border
                         shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-base font-heading font-semibold text-text-primary">
                  Фильтр карты
                </h2>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded hover:bg-bg-surface text-text-muted hover:text-text-primary"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 text-sm">
                {/* Дата */}
                <section>
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                    Дата
                  </div>
                  <input
                    type="date"
                    value={dateISO}
                    onChange={(e) => setDateISO(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-border text-base min-h-10
                               bg-white focus:outline-none focus:ring-1 focus:ring-accent-red/50"
                  />
                </section>

                {/* Участок */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Участок
                    </span>
                    <div className="flex gap-3 text-xs">
                      <button onClick={selectAllSections} className="text-accent-red hover:underline">
                        все
                      </button>
                      <button onClick={clearSections} className="text-text-muted hover:underline">
                        снять
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SECTIONS_UI.map(({ key, codes, label }) => {
                      const checked = codes.every((c) => sections.has(c))
                      return (
                        <label key={key} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-surface">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSectionUI(codes)}
                            className="accent-accent-red w-4 h-4"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: SECTION_SWATCH[key] ?? '#9ca3af' }}
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                </section>

                {/* Диапазон ПК */}
                <section>
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                    Диапазон ПК
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="от"
                      value={pkFrom}
                      onChange={(e) => setPkFrom(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-border text-base min-h-10"
                    />
                    <span className="text-text-muted">—</span>
                    <input
                      type="number"
                      placeholder="до"
                      value={pkTo}
                      onChange={(e) => setPkTo(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-border text-base min-h-10"
                    />
                  </div>
                </section>

                {/* Тип объектов */}
                <section>
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                    Объекты
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {OBJ_TYPES.map(({ key, label, Icon, iconSrc, color }) => {
                      const checked = key === 'temp_road' ? showTempRoads : objTypes.has(key as ObjectTypeKey)
                      return (
                        <label key={key} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-surface">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleObjType(key)}
                            className="accent-accent-red w-4 h-4"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ background: color }}
                          />
                          {iconSrc
                            ? <img src={iconSrc} alt="" className="w-4 h-4" />
                            : Icon && <Icon className="w-4 h-4 text-text-muted" />}
                          <span className="text-sm">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                </section>

                {/* Тип техники */}
                <section>
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                    Техника
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {EQUIP_TYPES.map((t) => (
                      <label key={t.key} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-surface">
                        <input
                          type="checkbox"
                          checked={equipTypes.has(t.key)}
                          onChange={() => toggleEquipType(t.key)}
                          className="accent-accent-red w-4 h-4"
                        />
                        <img
                          src={`/icons/${t.key}.svg`}
                          alt=""
                          className="w-4 h-4 opacity-90"
                        />
                        <span className="text-sm">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
