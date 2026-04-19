/* ==================================================================
   Mock data — ВСЖМ-1, 3 этап.
   Fallback data for WIP pages when API is unavailable.
   ================================================================== */

const sections = [
  { id: 1, title: "Участок №1", pk: "ПК2641+00 — ПК2720+00", km: 79, lead: "Поляков А.В." },
  { id: 2, title: "Участок №2", pk: "ПК2720+00 — ПК2800+00", km: 80, lead: "Громов И.С." },
  { id: 3, title: "Участок №3", pk: "ПК2800+00 — ПК2870+00", km: 70, lead: "Савельев Д.А." },
  { id: 4, title: "Участок №4", pk: "ПК2870+00 — ПК2950+00", km: 80, lead: "Ершов К.М." },
  { id: 5, title: "Участок №5", pk: "ПК2950+00 — ПК3030+00", km: 80, lead: "Цаплин П.Н." },
  { id: 6, title: "Участок №6", pk: "ПК3030+00 — ПК3110+00", km: 80, lead: "Андреев С.В." },
  { id: 7, title: "Участок №7", pk: "ПК3110+00 — ПК3210+00", km: 100, lead: "Кузьмин В.Е." },
  { id: 8, title: "Участок №8", pk: "ПК3210+00 — ПК3325+00", km: 115, lead: "Латыпов Р.Р." },
];

const metrics = [
  {id:1, sand:38,  shpgs:22, pileMain:64, pileTrial:50, sand24: 1980, shpgs24: 312, pMain24: 10, pTr24: 2, issues: 1, risk:"warn"},
  {id:2, sand:51,  shpgs:34, pileMain:72, pileTrial:60, sand24: 2340, shpgs24: 540, pMain24: 14, pTr24: 1, issues: 0, risk:"good"},
  {id:3, sand:27,  shpgs:12, pileMain:44, pileTrial:38, sand24: 1120, shpgs24: 140, pMain24:  6, pTr24: 3, issues: 3, risk:"bad"},
  {id:4, sand:62,  shpgs:48, pileMain:81, pileTrial:70, sand24: 3010, shpgs24: 680, pMain24: 16, pTr24: 2, issues: 0, risk:"good"},
  {id:5, sand:42,  shpgs:18, pileMain:71, pileTrial:50, sand24: 2620, shpgs24: 248, pMain24: 12, pTr24: 2, issues: 2, risk:"warn"},
  {id:6, sand:33,  shpgs:20, pileMain:55, pileTrial:42, sand24: 1590, shpgs24: 360, pMain24:  8, pTr24: 1, issues: 1, risk:"warn"},
  {id:7, sand:58,  shpgs:40, pileMain:68, pileTrial:55, sand24: 2880, shpgs24: 712, pMain24: 11, pTr24: 3, issues: 0, risk:"good"},
  {id:8, sand:19,  shpgs:8,  pileMain:31, pileTrial:20, sand24:  820, shpgs24:  90, pMain24:  4, pTr24: 0, issues: 4, risk:"bad"},
];

const quarries = [
  {name: "Боровенка-3",   arm: 42, sec: 1, mat:"песок"},
  {name: "Зорька-2",       arm: 26, sec: 1, mat:"ЩПГС"},
  {name: "Окуловка-Южн.",  arm: 31, sec: 2, mat:"песок"},
  {name: "Крестцы-1",      arm: 54, sec: 2, mat:"ЩПГС"},
  {name: "Мстинский-В",    arm: 18, sec: 3, mat:"песок"},
  {name: "Валдай-6",       arm: 67, sec: 3, mat:"ЩПГС"},
  {name: "Любница-2",      arm: 22, sec: 4, mat:"песок"},
  {name: "Спасская Полесть",arm: 48, sec: 4, mat:"ЩПГС"},
  {name: "Трегубово",      arm: 29, sec: 5, mat:"песок"},
  {name: "Чудово-З",       arm: 34, sec: 5, mat:"ЩПГС"},
  {name: "Лажины",         arm: 25, sec: 6, mat:"песок"},
  {name: "Грузино",        arm: 51, sec: 6, mat:"ЩПГС"},
  {name: "Кузьминка-4",    arm: 19, sec: 7, mat:"песок"},
  {name: "Березайка",      arm: 63, sec: 7, mat:"ЩПГС"},
  {name: "Бронница",       arm: 38, sec: 8, mat:"песок"},
  {name: "Тосно-2",        arm: 72, sec: 8, mat:"ЩПГС"},
];

function rowFor(sec){
  return quarries.filter(q => q.sec === sec).map(q => {
    const rides = 4 + ((q.arm * 7) % 4);
    const techD = 10 + (q.arm % 20);
    const techN = 4 + (q.arm % 6);
    const outD = (techD * rides * (22 + q.arm % 10));
    const outN = (techN * rides * (28 + q.arm % 15));
    return { q: q.name, mat: q.mat, arm: q.arm, rides, techD, techN, outD, outN, total: outD+outN };
  });
}
const dailyQuarry = sections.map(s => ({sec: s, rows: rowFor(s.id)}));

const tads = [
  {name:"АД-8 №1",  sec:1, pk:"ПК2680+00 — ПК2685+20", zp:40, wr:15, pi:25, no:20},
  {name:"АД-8 №2",  sec:1, pk:"ПК2700+00 — ПК2707+40", zp:55, wr:20, pi:10, no:15},
  {name:"АД-6 №1",  sec:2, pk:"ПК2735+00 — ПК2742+60", zp:70, wr:10, pi:10, no:10},
  {name:"АД-6 №2",  sec:2, pk:"ПК2760+00 — ПК2768+00", zp:80, wr:15, pi:5,  no:0},
  {name:"АД-6 №3",  sec:2, pk:"ПК2785+20 — ПК2792+40", zp:45, wr:25, pi:15, no:15},
  {name:"АД-4 №1",  sec:3, pk:"ПК2815+00 — ПК2820+40", zp:30, wr:20, pi:30, no:20},
  {name:"АД-4 №2",  sec:3, pk:"ПК2840+00 — ПК2848+20", zp:25, wr:15, pi:35, no:25},
  {name:"АД-4 №3",  sec:3, pk:"ПК2860+00 — ПК2866+00", zp:15, wr:20, pi:30, no:35},
  {name:"АД-2 №1",  sec:4, pk:"ПК2880+00 — ПК2890+40", zp:60, wr:20, pi:15, no:5},
  {name:"АД-2 №2",  sec:4, pk:"ПК2910+00 — ПК2918+00", zp:75, wr:12, pi:8,  no:5},
  {name:"АД-2 №3",  sec:4, pk:"ПК2935+00 — ПК2942+00", zp:50, wr:25, pi:15, no:10},
  {name:"АД-1 №1",  sec:5, pk:"ПК2960+00 — ПК2968+20", zp:55, wr:20, pi:15, no:10},
  {name:"АД-1 №2",  sec:5, pk:"ПК2990+00 — ПК2997+40", zp:42, wr:18, pi:20, no:20},
  {name:"АД-3 №1",  sec:6, pk:"ПК3040+00 — ПК3047+00", zp:35, wr:25, pi:25, no:15},
  {name:"АД-3 №2",  sec:6, pk:"ПК3080+00 — ПК3088+60", zp:50, wr:20, pi:20, no:10},
  {name:"АД-5 №1",  sec:7, pk:"ПК3125+00 — ПК3133+20", zp:62, wr:18, pi:10, no:10},
  {name:"АД-5 №2",  sec:7, pk:"ПК3170+00 — ПК3178+00", zp:70, wr:15, pi:10, no:5},
  {name:"АД-7 №1",  sec:8, pk:"ПК3225+00 — ПК3232+40", zp:20, wr:10, pi:35, no:35},
  {name:"АД-7 №2",  sec:8, pk:"ПК3280+00 — ПК3287+60", zp:15, wr:15, pi:30, no:40},
];

const objects = [
  {id:"МСТ-28", kind:"bridge",     name:"Мост через р. Мста",         pk:"ПК2815+50 — ПК2817+20", length:170, piles:"84/96", status:"в работе", sec:3},
  {id:"МСТ-31", kind:"bridge",     name:"Мост через р. Полометь",     pk:"ПК2960+10 — ПК2961+50", length:140, piles:"62/96", status:"в работе", sec:5},
  {id:"ПП-14",  kind:"putoprovod", name:"Путепровод ПК2744",          pk:"ПК2744+20",             length: 48, piles:"22/24", status:"в работе", sec:2},
  {id:"ПП-22",  kind:"putoprovod", name:"Путепровод ПК2902",          pk:"ПК2902+40",             length: 56, piles:"28/28", status:"готов",    sec:4},
  {id:"ПП-31",  kind:"putoprovod", name:"Путепровод ПК3055",          pk:"ПК3055+10",             length: 44, piles:"16/22", status:"в работе", sec:6},
  {id:"ТР-08",  kind:"truba",      name:"Труба d1.5 м",               pk:"ПК2690+20",             length:  18, piles:"—",     status:"готов",    sec:1},
  {id:"ТР-11",  kind:"truba",      name:"Труба d2 м",                 pk:"ПК2812+40",             length:  22, piles:"—",     status:"в работе", sec:3},
  {id:"ТР-18",  kind:"truba",      name:"Труба d1.2 м",               pk:"ПК2990+10",             length:  16, piles:"—",     status:"не в работе", sec:5},
  {id:"СП-03",  kind:"pile",       name:"Свайное поле СП-03",         pk:"ПК2756+10 — ПК2758+40", length:230, piles:"412/610", status:"в работе", sec:2},
  {id:"СП-07",  kind:"pile",       name:"Свайное поле СП-07",         pk:"ПК2875+00 — ПК2878+00", length:300, piles:"520/680", status:"в работе", sec:4},
  {id:"СП-11",  kind:"pile",       name:"Свайное поле СП-11",         pk:"ПК3145+20 — ПК3148+60", length:340, piles:"380/720", status:"отставание", sec:7},
  {id:"ПЖДС-5", kind:"crossJds",   name:"Пересечение ж/д сети М-10",  pk:"ПК2725+50",             length:  12, piles:"—",     status:"согласование", sec:2},
  {id:"ПБ-3",   kind:"crossBal",   name:"Пересечение ВЛ 110 кВ",      pk:"ПК2968+20",             length:  10, piles:"—",     status:"в работе", sec:5},
];

const issues = [
  { id:"INC-1204", sec:5, kind:"техника",   title:"Отказ экскаватора CAT-329 на карьере Трегубово", sev:"warn", ago:"2 ч" },
  { id:"INC-1203", sec:3, kind:"поставка",  title:"Задержка ЩПГС с Валдай-6 (68 км, пробка на М-11)", sev:"bad",  ago:"4 ч" },
  { id:"INC-1202", sec:8, kind:"качество",  title:"Пересорт песка по фракции — Тосно-2", sev:"bad", ago:"6 ч" },
  { id:"INC-1201", sec:5, kind:"безопасность", title:"Нарушение СИЗ — бригада подрядчика СУ-4", sev:"warn", ago:"1 д" },
  { id:"INC-1200", sec:6, kind:"погода",    title:"Приостановка свайных работ — ветер 19 м/с", sev:"warn", ago:"1 д" },
  { id:"INC-1199", sec:3, kind:"документ.", title:"Нет акта приёмки земполотна по АД-4 №2", sev:"bad", ago:"2 д" },
];

const equipmentMatrix = {
  rows: ["Самосвалы", "Экскаваторы", "Свайные агрегаты"],
  cols: sections.map(s=>"№"+s.id),
  values: [
    [ 88, 104, 72, 112, 96, 82, 101, 58],
    [ 92, 108, 68, 116, 101, 90, 105, 64],
    [ 80, 111, 66, 122, 107, 78, 108, 60],
  ],
};

function gantt(sec){
  const base = sec.id;
  return [
    {task:"Подготовка территории",    start:  0, end: 22, done: 95, status:"good"},
    {task:"Отсыпка временных АД",      start:  8, end: 38, done: 72, status:"warn"},
    {task:"Возка песка",               start: 14, end: 62, done: 55, status:"warn"},
    {task:"Возка ЩПГС",                start: 28, end: 70, done: 34, status:"warn"},
    {task:"Свайные работы (пробные)",  start: 18, end: 34, done: 60, status:"good"},
    {task:"Свайные работы (основные)", start: 30, end: 82, done: 44 + base*2, status: sec.id===3||sec.id===8?"bad":"good"},
    {task:"Искусственные сооружения",  start: 44, end: 90, done: 28, status:"warn"},
    {task:"Земляное полотно",          start: 48, end: 96, done: 20, status:"warn"},
  ];
}

const trendDays = [];
for (let i=0; i<30; i++){
  const d = new Date(2026, 2, 20 + i);
  const base = 14000 + 4000*Math.sin(i/5) + (i*120) + (i%7===0 ? -3500 : 0);
  const own  = Math.max(0, Math.round(base * (0.42 + 0.05*Math.sin(i/6))));
  const alma = Math.max(0, Math.round(base * (0.34 + 0.04*Math.sin(i/4+1))));
  const hire = Math.max(0, Math.round(base - own - alma));
  const shpgs = 3800 + 900*Math.sin(i/4+1) + (i*60) + (i%7===6 ? -1200 : 0);
  trendDays.push({
    date: d.toLocaleDateString("ru-RU", { day:"2-digit", month:"2-digit" }),
    sand: own + alma + hire,
    own, alma, hire,
    shpgs: Math.max(0, Math.round(shpgs)),
  });
}

const sandBreakdown = metrics.map(m => {
  const own  = Math.round(m.sand24 * (0.40 + (m.id%3)*0.04));
  const alma = Math.round(m.sand24 * (0.32 + (m.id%2)*0.03));
  const hire = Math.max(0, m.sand24 - own - alma);
  return { sec: m.id, total: m.sand24, own, alma, hire };
});
const sandTotals = sandBreakdown.reduce((a,r)=>(
  { own:a.own+r.own, alma:a.alma+r.alma, hire:a.hire+r.hire, total:a.total+r.total }
), {own:0,alma:0,hire:0,total:0});

function overall(){
  const avg = (f) => Math.round(metrics.reduce((s,m)=>s+m[f],0)/metrics.length);
  return {
    sand: avg("sand"),
    shpgs: avg("shpgs"),
    pileMain: avg("pileMain"),
    pileTrial: avg("pileTrial"),
    sand24:  metrics.reduce((s,m)=>s+m.sand24,0),
    shpgs24: metrics.reduce((s,m)=>s+m.shpgs24,0),
    pMain24: metrics.reduce((s,m)=>s+m.pMain24,0),
    pTr24:   metrics.reduce((s,m)=>s+m.pTr24,0),
    issues:  issues.length,
  };
}

export const MOCK = {
  sections, metrics, quarries, dailyQuarry, tads, objects,
  issues, equipmentMatrix, gantt, trendDays,
  sandBreakdown, sandTotals,
  overall: overall()
};
