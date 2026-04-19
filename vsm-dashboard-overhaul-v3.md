# VSM Dashboard Overhaul v3 — Multi-Agent edition

> «А сколько голов у трёхголового пса?» — Ральф
> Больше голов — больше рук. **GSD быстрее.**

Это orchestrator-план для main Claude Code. Ты не пишешь код сам на Этапе 2 — ты **делегируешь** пяти субагентам (`.claude/agents/*.md`) через Task tool, собираешь результаты, ставишь merge-чекпойнты.

**Что поменялось vs v2:**
- Введены 5 субагентов с чётко разграниченными ролями и файловыми зонами.
- Фазы A, B, C распараллелены — гоняются одновременно.
- Выделен Этап 1 (блокеры, последовательно) и Этап 3 (финал).
- Правило антиконфликта: все shared-файлы orchestrator создаёт в Этапе 1, дальше агенты их **только импортируют**.

---

## 0. Контекст проекта

- VSM-1, 3 этап, 8 участков (ПК2641–ПК3325).
- React 18 + Tailwind + Framer Motion + Leaflet/react-leaflet + PostgreSQL (`works_db_v2`) + Prisma + Express + Recharts.
- DB: `postgresql://works_user:27052775@127.0.0.1:5433/works_db_v2`.
- Фиксированные договорённости (не трогать): палетт (`#f5f5f5`, `#1a1a1a`, `#dc2626`, `#7f1d1d`, red/amber/green прогресс-бары), формат ПК (`ПК2642+22.72`), правила искривления объектов, главная = дашборд.
- Референсы в uploads: `Условные_обозначения_карты.html`, xlsx `Анализ выполнения`, pdf `сьарый вонючий отчёт`.

**Про участок 3:** в БД это **два** active-ряда — `UCH_31` и `UCH_32`. Родителя `UCH_3` нет и создавать нельзя. Привязка данных идёт по пикету через `construction_section_versions.pk_start/pk_end`. На UI оба куска схлопываются в «Участок №3».

---

## Состав команды

| Agent | Роль | Файловая зона (owns) |
|---|---|---|
| `db-engineer` | SQL, Prisma, миграции, API endpoints, демо-сидинг | `prisma/`, `server/routes/`, `server/db/`, `scripts/seed-*` |
| `map-specialist` | Leaflet, SVG-рендер, гео-математика | `src/components/map/`, `src/features/map/` |
| `frontend-engineer` | React pages — Analytics, Overview, Quarry Report, фильтры, тултипы | `src/pages/`, `src/components/analytics/`, `src/components/quarry-report/`, `src/features/analytics/` |
| `pdf-engineer` | Weasyprint HTML-шаблоны, бэкендные PDF-роуты | `server/pdf/`, `templates/pdf/` |
| `qa-playwright` | Скрины, white-screen audit, регрессия | `tests/playwright/`, `/tmp/vsm-*-audit/` |

**Shared файлы (owned by orchestrator, read-only для агентов):**
- `src/lib/sections.ts` — helpers `sectionCodeToNumber`, `sectionCodeToUILabel`
- `src/constants/quarries.ts` — справочник карьеров × участки
- `src/constants/productivity-norms.ts` — нормативы техники
- `src/constants/section-codes.ts` — константа `ACTIVE_SECTION_CODES`, правила агрегации

Их создаёт и редактирует **только orchestrator** (на Этапе 1.4). Агенты импортируют и всё.

---

## Дерево зависимостей

```
                   ┌────────────────────────┐
                   │ 0A  DB audit           │   db-engineer (solo)
                   └────────────┬───────────┘
                                │
                   ┌────────────▼───────────┐
                   │ 0B.1 Demo infra        │   db-engineer (solo)
                   └────────────┬───────────┘
                                │
                   ┌────────────▼───────────┐
                   │ D1  Overview fix       │   frontend-engineer (solo)
                   └────────────┬───────────┘
                                │
                   ┌────────────▼───────────┐
                   │ orchestrator: shared   │   YOU (main)
                   │ constants + helpers    │
                   └────────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┬─────────────────┐
              │                 │                 │                 │
         ┌────▼────┐       ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
         │ Phase A │       │ Phase B │       │ Phase C │       │ B.API   │
         │   Map   │       │  UI     │       │  UI     │       │ + PDFs  │
         │ map-spec│       │ frontend│       │ frontend│       │ db +pdf │
         └────┬────┘       └────┬────┘       └────┬────┘       └────┬────┘
              │                 │                 │                 │
              └─────────────────┴────────┬────────┴─────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  Merge + integration│
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ D2-4 QA-свип        │   qa-playwright
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ 0B.2 Demo seeder    │   db-engineer
                              │ (after Jan's files) │
                              └─────────────────────┘
```

---

## Этап 1 — Последовательно, блокеры

### 1.1. 0A — DB audit (db-engineer, solo)

Делегируй через Task. Агент выполняет SQL из `0A_audit_queries.sql` (см. ниже), пишет `/tmp/vsm-db-audit.md`, возвращает 3-пункт-резюме. Orchestrator читает резюме, принимает решение о вариантах для 0B.1.

**SQL (передай агенту в prompt):**

```sql
-- 1. Объекты по типам
SELECT ot.code, ot.name, COUNT(o.id) AS total,
       COUNT(o.id) FILTER (WHERE o.is_active) AS active
FROM object_types ot LEFT JOIN objects o ON o.object_type_id = ot.id
GROUP BY ot.code, ot.name ORDER BY total DESC;

-- 2. Сегменты с координатами / без
SELECT ot.code, ot.name, COUNT(os.id) AS segments,
       COUNT(*) FILTER (WHERE os.start_lat IS NOT NULL) AS with_coords,
       COUNT(*) FILTER (WHERE os.start_lat IS NULL) AS no_coords
FROM object_segments os
JOIN objects o ON os.object_id = o.id
JOIN object_types ot ON o.object_type_id = ot.id
GROUP BY ot.code, ot.name ORDER BY 3 DESC;

-- 3. Свайные поля
SELECT field_type, COUNT(*) AS fields,
       COUNT(*) FILTER (WHERE start_lat IS NOT NULL) AS with_coords,
       SUM(pile_count) AS total_piles, SUM(dynamic_test_count) AS total_tests
FROM pile_fields GROUP BY field_type;

-- 4. Объекты по участкам
SELECT cs.code, cs.name, ot.name AS type, COUNT(DISTINCT o.id) AS n
FROM construction_sections cs
JOIN construction_section_versions csv ON csv.section_id = cs.id AND csv.is_current = true
JOIN object_segments os ON os.pk_start >= csv.pk_start AND os.pk_end <= csv.pk_end
JOIN objects o ON os.object_id = o.id
JOIN object_types ot ON o.object_type_id = ot.id
WHERE o.is_active
GROUP BY 1, 2, 3 ORDER BY 1, 3;

-- 5. Свайные поля по участкам
SELECT cs.code, cs.name, pf.field_type, COUNT(*) AS n,
       SUM(pf.pile_count) AS piles, SUM(pf.dynamic_test_count) AS tests
FROM pile_fields pf
JOIN construction_section_versions csv
  ON pf.pk_start >= csv.pk_start AND pf.pk_end <= csv.pk_end AND csv.is_current = true
JOIN construction_sections cs ON csv.section_id = cs.id
GROUP BY 1, 2, 3 ORDER BY 1, 3;

-- 6. Участки — подтверди UCH_31, UCH_32, оба active
SELECT id, code, name, is_active, sort_order FROM construction_sections
ORDER BY sort_order NULLS LAST, code;

-- 7. Наличие данных выработки
SELECT 'daily_reports' AS t, COUNT(*) FROM daily_reports
UNION ALL SELECT 'daily_work_items', COUNT(*) FROM daily_work_items
UNION ALL SELECT 'daily_work_item_segments', COUNT(*) FROM daily_work_item_segments
UNION ALL SELECT 'material_movements', COUNT(*) FROM material_movements
UNION ALL SELECT 'material_movement_equipment_usage', COUNT(*) FROM material_movement_equipment_usage
UNION ALL SELECT 'report_equipment_units', COUNT(*) FROM report_equipment_units
UNION ALL SELECT 'stockpiles', COUNT(*) FROM stockpiles
UNION ALL SELECT 'stockpile_balance_snapshots', COUNT(*) FROM stockpile_balance_snapshots;

-- 8. Существующие source_type
SELECT source_type, COUNT(*) FROM daily_reports GROUP BY source_type;

-- 9. Каскадные FK на daily_reports
SELECT conname, conrelid::regclass AS child_table, confdeltype
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'daily_reports'::regclass;
```

**Ожидаемый output от агента**: `/tmp/vsm-db-audit.md` + 3-пункт-резюме в чат.

---

### 1.2. 0B.1 — Demo infrastructure (db-engineer, solo)

После того как orchestrator прочитал audit:
- Если все FK каскадные → вариант A: тег через `daily_reports.source_type = 'demo'`.
- Если нет → вариант B: миграция на ON DELETE CASCADE.
- Если B рискованно → вариант C: колонка `is_demo` в 10 таблицах.

Orchestrator выбирает вариант, пишет агенту: «делай вариант X». Агент пишет миграцию, прогоняет её, возвращает подтверждение.

**Важно**: 0B.2 (сам генератор демо-данных) НЕ делаем на этом этапе. Ждём, пока Ян скинет реальные отчёты.

---

### 1.3. D1 — Фикс белого экрана на Обзоре (frontend-engineer, solo)

Это приоритетный баг, Ян на него смотрит прямо сейчас. Первая подозреваемая причина — старый код ждёт `UCH_3`, а получает `UCH_31`/`UCH_32`.

Агент:
1. Открывает `/` (Обзор), кликает по участку, снимает стектрейс.
2. Находит код, чинит, проверяет все 8 участков.
3. Playwright-скрины ДО/ПОСЛЕ.

---

### 1.4. Orchestrator: Shared файлы

**Делаешь сам, не делегируешь.** После того как 1.1-1.3 закончены, создай:

**`src/lib/sections.ts`:**
```ts
export const ACTIVE_SECTION_CODES = [
  'UCH_1', 'UCH_2', 'UCH_31', 'UCH_32', 'UCH_4',
  'UCH_5', 'UCH_6', 'UCH_7', 'UCH_8',
] as const;

export type SectionCode = typeof ACTIVE_SECTION_CODES[number];

export function sectionCodeToNumber(code: string): number {
  const m = code.match(/^UCH_(\d)/);
  if (!m) throw new Error(`Unknown section code: ${code}`);
  return parseInt(m[1], 10);
}

export function sectionCodeToUILabel(code: string): string {
  return `Участок №${sectionCodeToNumber(code)}`;
}

/** Для SQL WHERE: список всех кодов участка N */
export function sectionNumberToCodes(n: number): string[] {
  if (n === 3) return ['UCH_31', 'UCH_32'];
  return [`UCH_${n}`];
}
```

**`src/constants/quarries.ts`:**
```ts
export const QUARRIES_BY_SECTION: Record<number, Array<{name: string; armKm: number}>> = {
  1: [{name: 'Боровенка-3', armKm: 42}, {name: 'Зорька-2', armKm: 26}, {name: 'Васильки', armKm: 10}],
  2: [{name: 'Боровенка-3', armKm: 55}, {name: 'Зорька-2', armKm: 45}, {name: 'Васильки', armKm: 22.7}],
  3: [{name: 'УССК', armKm: 7.5}, {name: 'Пирус', armKm: 32}, {name: 'Васильки АЛМАЗ', armKm: 38}],
  4: [{name: 'Пирус', armKm: 44}, {name: 'Васильки АЛМАЗ', armKm: 44}],
  5: [{name: 'Пирус', armKm: 16}, {name: 'Васильки АЛМАЗ', armKm: 16}],
  6: [{name: 'Южные Маяки', armKm: 24}, {name: 'Добывалово', armKm: 28}],
  7: [{name: 'Выползово', armKm: 12}, {name: '"Великий" АЛМАЗ', armKm: 25}],
  8: [{name: 'Выползово', armKm: 8.2}, {name: '"Великий" АЛМАЗ', armKm: 3}],
};
```

**`src/constants/productivity-norms.ts`:**
```ts
export const NORMS = {
  dumpTruck: { perTripM3: 16 },
  excavator: { excavationM3PerShift: 1038, soilM3PerShift: 850 },
  bulldozer: { excavationM3PerShift: 1070, soilM3PerShift: 892 },
} as const;
```

Закоммить эти три файла одним коммитом «chore: shared constants for v3 overhaul». **С этого момента агенты их только читают.**

---

## Этап 2 — Параллельный дождь

### 2.0. Как ты делегируешь

В одном сообщении **одновременно** спавнишь 4 Task-вызова (map-specialist, frontend-engineer для B, frontend-engineer для C, и split db+pdf на api/templates). Передаёшь каждому агенту его секцию плана + ссылки на референсы.

**Файловые лейны** (повторяю, крайне важно):
- `src/components/map/*` — **только** map-specialist
- `src/pages/analytics/*`, `src/components/analytics/*` — **только** frontend-engineer (Phase B UI)
- `src/pages/quarry-report/*` — **только** frontend-engineer (Phase C UI)
- `src/pages/overview/*` — заморожен после 1.3 (трогать только в D)
- `server/routes/analytics/*`, `server/routes/quarry/*` — **только** db-engineer
- `server/pdf/*`, `templates/pdf/*` — **только** pdf-engineer
- `src/lib/sections.ts`, `src/constants/*` — **заморожены после 1.4** (read-only)

Если агенту нужна ещё какая-то константа — пусть напишет orchestrator'у, orchestrator добавит в `src/constants/`. Сами не редактируют.

### 2.1. Track A — Карта (map-specialist)

Отправляешь задание по Phase A из v2 (A1-A6). Агент работает только в `src/components/map/` и `src/features/map/`. Читает `Условные_обозначения_карты.html`, `src/lib/sections.ts`, `src/constants/section-codes.ts`.

Ожидаемый output: коммит «feat(map): объекты по легенде + пикет-засечки + фильтр типов», скрины в `/tmp/vsm-map-screenshots/`, 1-экранный отчёт.

### 2.2. Track B — Аналитика UI (frontend-engineer #1)

Phase B из v2, блоки B1-B6 (UI). Работает в `src/pages/analytics/`, `src/components/analytics/`. Данные берёт от db-engineer через API (эндпоинты тот готовит параллельно; если ещё не готовы — заглушки с той же формой ответа).

Важно: блок B5 («объёмы перевозок») — **в самом низу, компактно**.

Ожидаемый output: коммит «feat(analytics): перекомпоновка + новые блоки», скрины в `/tmp/vsm-analytics-screenshots/`.

### 2.3. Track B-API (db-engineer)

Параллельно с 2.2 делает эндпоинты:
- `GET /api/analytics/temp-roads?date=YYYY-MM-DD` — данные для B1.
- `GET /api/analytics/sand-flow?date=...&section=...` — для B2.
- `GET /api/analytics/piles?section=...` — для B3.
- `GET /api/analytics/equipment-productivity?date=...&section=...` — для B4.
- `GET /api/analytics/transport-volumes?date=...` — для B5.
- Каждый поддерживает `section` param с кодами `UCH_31,UCH_32` для «Участка №3».

Ожидаемый output: коммит «feat(api): analytics endpoints», OpenAPI/README с форматами ответов в `/tmp/vsm-api-contracts.md`.

### 2.4. Track C — Суточный отчёт UI (frontend-engineer #2)

Phase C из v2 (C1-C3). Новая вкладка `/daily-quarry-report`, иконка `Truck`. Работает в `src/pages/quarry-report/`, `src/components/quarry-report/`.

Ожидаемый output: коммит «feat(quarry-report): новая вкладка», скрины.

### 2.5. Track C-API (db-engineer, последовательно после 2.3)

- `GET /api/quarry-report?date=YYYY-MM-DD` — возвращает структуру для 8 участков × строки-категории × подытоги.

### 2.6. Track PDF (pdf-engineer)

Два независимых шаблона:

**`templates/pdf/analytics.html`** (для Phase B)
- A4 **landscape**, 3 страницы.
- Стр.1 — сводная таблица План/Факт × 8 участков (ПРС, Песок[Всего/Свои/Алмаз/Наёмники], Выемка, Выемка ОХ, Щебень, ЩПС с завозом в накопитель, Перевозка), день/ночь, за сутки/неделю/месяц + блок «% выполнения нормы техники» (Самосвал/Экскаватор/Бульдозер × 8 участков) + текстовая сводка «Выполнение за DD.MM.YYYY» из xlsx `S7`.
- Стр.2 — 19 временных АД: штабель-диаграммы статусов, группировка по участкам, легенда.
- Стр.3 — верх: свайные поля по участкам; низ: возка с карьеров (свои/Алмаз/наёмники, плечо).
- Эндпоинт: `POST /api/pdf/analytics` → `VSM_Аналитика_YYYY-MM-DD.pdf`.

**`templates/pdf/quarry-report.html`** (для Phase C)
- Layout 1-в-1 с исходным `сьарый_вонючий_отчеь.pdf` (A4 landscape, 1-2 страницы).
- Эндпоинт: `POST /api/pdf/quarry-report` → `VSM_Суточный_YYYY-MM-DD.pdf`.

Weasyprint из `/home/aboba/.openclaw/workspace/.venv-pdf/`.

Ожидаемый output: коммит «feat(pdf): weasyprint templates», 2 сэмпла PDF в `/tmp/vsm-pdf-samples/`.

### 2.7. Merge checkpoint (orchestrator)

Когда все 5 треков зарапортовали готовность:
1. Pull → проверь, что нет merge-конфликтов (их и не должно быть по правилу лейнов).
2. `npm run build` — должно собраться.
3. Быстрый smoke: открой `/`, `/map`, `/analytics`, `/daily-quarry-report` — все маршруты ходят, нет 500, нет белых экранов.
4. Если что-то сломалось — отправь соответствующему агенту fixup-таску.

---

## Этап 3 — Финал

### 3.1. D2-4 — QA-свип (qa-playwright)

Агент:
- Проходит все маршруты из `src/router.tsx`.
- Кликает все кнопки верхнего уровня.
- Скрины в `/tmp/vsm-tabs-audit/*.png`.
- Список белых экранов в `/tmp/vsm-white-screens.md` с causes.

По списку orchestrator диспатчит fixup-таски соответствующим агентам (обычно frontend-engineer).

### 3.2. 0B.2 — Demo seeder (db-engineer, ждёт Яна)

Когда Ян скинет 2–3 реальных суточных отчёта:
1. db-engineer парсит их через существующий парсер.
2. Размножает пропорционально на все 8 участков × 3–5 дат.
3. Вставляет с тегом из 1.2.
4. Печатает итог.

Идемпотентный скрипт `scripts/seed-demo-data.ts`: перед вставкой чистит свои demo-записи.

### 3.3. Regression screenshot (qa-playwright)

Финальный прогон Playwright, скрины всех вкладок в `/tmp/vsm-final/`. Показать Яну для приёмки.

---

## Правила работы между агентами

- **Границы лейнов — святое.** Если агент пишет файл вне своей зоны — orchestrator откатывает и перевыдаёт задачу.
- **Shared constants заморожены после 1.4.** Любое изменение → через orchestrator.
- **API-контракты согласуются в `/tmp/vsm-api-contracts.md`.** db-engineer пишет первым, frontend-engineer читает. Если frontend нужна другая форма ответа — пишет комментарий в `/tmp/vsm-api-feedback.md`, orchestrator разруливает.
- **Коммит-сообщения префиксами**: `feat(map):`, `feat(analytics):`, `feat(quarry-report):`, `feat(api):`, `feat(pdf):`, `fix(overview):`, `test:`, `chore:`.
- **Не сливать ветки** — работаем на одной, лейны разделены по файлам. Если хочется feature-бранчей, скажи Яну отдельно, он решит.

---

## Установка агентов

В корне проекта:
```
.claude/
└── agents/
    ├── db-engineer.md
    ├── map-specialist.md
    ├── frontend-engineer.md
    ├── pdf-engineer.md
    └── qa-playwright.md
```

Claude Code подхватит автоматически. Этот файл (`vsm-dashboard-overhaul-v3.md`) кидаешь в корень и говоришь main-агенту: «читай этот план, работай как orchestrator».

---

## Что в какой момент спрашивать у Яна

- После 0A audit — резюме на 3 пункта.
- Перед 0B.1 — какой вариант миграции выбрал (если выбор неочевиден).
- После 1.4 — «shared constants готовы, запускать Этап 2?» — да/нет.
- После 2.7 merge — «вот скрины всех треков, смотри, что править».
- Перед 3.2 — «инфра для demo готова, скинь реальные отчёты».
- После 3.3 — финальный прогон.

**Между этими точками — не дёргать.** GSD.

---

> «Я — кирпич!» — Ральф
> Вас пять. Кладите кирпичи параллельно. **GSD.**
