// Rep Tally. All data lives only on this phone (localStorage); nothing is ever sent anywhere.
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const sortLog = () => log.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t);

  // =============================== dates (days are 'YYYY-MM-DD' strings, local time) ===============================
  const parts = key => key.split('-').map(Number);
  function dayKey(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  const toDate = key => { const [y, m, d] = parts(key); return new Date(y, m - 1, d); };
  const shiftDay = (key, n) => { const [y, m, d] = parts(key); return dayKey(new Date(y, m - 1, d + n)); };
  const weekday = key => toDate(key).getDay();
  const weekStart = d => shiftDay(d, -weekday(d));                   // weeks run Sunday-Saturday
  function daysBetween(a, b) {
    const t = k => { const [y, m, d] = parts(k); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000);
  }
  const pretty = key => toDate(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  // =============================== storage: keys and formats never change, so old data and backups keep working ===============================
  const K = { events: 'rep-tally-events-v1', log: 'rep-tally-v1', max: 'rep-tally-maxset-v1', goals: 'rep-tally-goals-v1',
              dayGoals: 'rep-tally-daygoals-v1', records: 'rep-tally-records-v1', backup: 'rep-tally-lastbackup-v1', rest: 'rep-tally-rest-v1' };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
  const save = (...what) => { for (const w of what) write(K[w], { events: allEvents, log, max: maxSet, goals, dayGoals, rest }[w]); };

  const MAX_EVENTS = 9;
  const PALETTE = ['#ff7a45', '#3ec7a0', '#5b9dff', '#c084fc', '#f472b6', '#facc15', '#22d3ee', '#a3e635', '#fb923c'];
  const DEFAULT_EVENTS = () => [{ id: 'push', name: 'Pushups', color: PALETTE[0] }, { id: 'squat', name: 'Squats', color: PALETTE[1] }];
  const ID_RE = /^[a-z0-9_-]{1,30}$/i;
  const okDay = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d);
  const okInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

  // Events in display order. A removed event stays in the list with archived: true so its history is kept.
  function cleanEvents(v) {
    if (!Array.isArray(v)) return null;
    const seen = new Set(), out = [];
    let active = 0;
    for (const e of v) {
      if (!e || !ID_RE.test(e.id) || seen.has(e.id) || typeof e.name !== 'string') continue;
      const name = e.name.trim().slice(0, 20);
      if (!name) continue;
      const archived = !!e.archived || active >= MAX_EVENTS;
      if (!archived) active++;
      seen.add(e.id);
      out.push({ id: e.id, name, color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : PALETTE[out.length % PALETTE.length],
        ...(e.unit === 'min' ? { unit: 'min' } : {}), ...(archived ? { archived: true } : {}),
        ...(Array.isArray(e.buttons) && e.buttons.length === 4 && e.buttons.every(x => okInt(x, 1, 1000)) ? { buttons: e.buttons.slice() } : {}),
        ...(typeof e.icon === 'string' && /^[^\w\s<>&"']{1,16}$/u.test(e.icon) ? { icon: e.icon } : {}) });
      if (out.length === 40) break;
    }
    return active ? out : null;
  }
  const cleanLog = v => Array.isArray(v)
    ? v.filter(e => e && ID_RE.test(e.ex) && okInt(e.n, -100000, 100000) && okDay(e.d)).map(e => ({ d: e.d, ex: e.ex, n: e.n, t: Number(e.t) || 0 }))
    : [];
  function cleanMax(v, evs) {
    const out = {};
    for (const e of evs) { const x = v && v[e.id]; out[e.id] = okInt(x, 1, 1000) ? x : (e.id === 'push' ? 30 : e.id === 'squat' ? 25 : 20); }
    return out;
  }
  // A goal: start value n on day d, growing by `step` every day/week/month (or never), optionally stopping at `cap`.
  // per: 'week' = a Sunday-Saturday total. wait = only grow after periods that were fully met. Older goals ({d, n}) mean +1 every day.
  function cleanGoal(g) {
    if (!g || !okInt(g.n, 1, 100000) || !okDay(g.d)) return null;
    return { d: g.d, n: g.n, step: okInt(g.step, 1, 1000) ? g.step : 1, every: ['day', 'week', 'month', 'never'].includes(g.every) ? g.every : 'day',
             cap: okInt(g.cap, 1, 100000) ? g.cap : 0, wait: g.wait === true, per: g.per === 'week' ? 'week' : 'day' };
  }
  function cleanGoals(v, evs) {
    const out = {};
    for (const e of evs) { const g = v && v[e.id]; out[e.id] = cleanGoal(Number.isInteger(g) && g > 0 ? { d: dayKey(), n: g } : g); }
    return out;
  }
  function cleanDayGoals(v) {               // {day: {eventId: that day's goal}}, so past days keep the goal they had
    const out = {};
    if (v && typeof v === 'object') for (const [d, g] of Object.entries(v)) {
      if (!okDay(d) || !g || typeof g !== 'object') continue;
      const row = {};
      for (const [id, n] of Object.entries(g)) if (ID_RE.test(id) && Number.isInteger(n) && n >= 0) row[id] = n;
      out[d] = row;
    }
    return out;
  }

  // Rest days: whole days that bridge the streak. At most one in any `every` consecutive days.
  function cleanRest(v, every = 7) {
    const ok = v && typeof v === 'object';
    return { every: ok && okInt(v.every, 2, 60) ? v.every : every,
             days: ok && Array.isArray(v.days) ? [...new Set(v.days.filter(okDay))].sort() : [] };
  }

  // =============================== state ===============================
  let allEvents = cleanEvents(read(K.events, null)) || DEFAULT_EVENTS();
  let events = [];                                         // the active (not removed) events, in order
  const syncEvents = () => { events = allEvents.filter(e => !e.archived); };
  syncEvents();
  let log = cleanLog(read(K.log, []));                     // every tap: {d: day, ex: event id, n: amount, t: time}
  let maxSet = cleanMax(read(K.max, {}), allEvents);
  let goals = cleanGoals(read(K.goals, {}), allEvents);
  let dayGoals = cleanDayGoals(read(K.dayGoals, {}));
  let rest = cleanRest(read(K.rest, null));
  const isRest = d => rest.days.includes(d);
  // The rest day that's too close to d (fewer than `every` days apart), if any
  const restConflict = d => rest.days.find(r => r !== d && Math.abs(daysBetween(r, d)) < rest.every) || null;
  save('events');

  const evById = id => allEvents.find(e => e.id === id);
  const isActive = id => events.some(e => e.id === id);
  const nameOf = id => (evById(id) || { name: '?' }).name;
  const isMin = id => (evById(id) || {}).unit === 'min';   // minutes events (cardio, sports); others count reps
  const btnsOf = ev => ev.buttons || (ev.unit === 'min' ? [30, 15, 5, 1] : [20, 10, 5, 1]);
  // An emoji for each event: the one picked on the More page, otherwise a guess from its name
  const ICON_GUESSES = [
    [/skip|jump|jack|rope|burpee/, '🤸'], [/bench|dead|curl|lift|weight|kettle|dumbbell|barbell|\bdips?\b/, '🏋️'],
    [/push|press|chest|arm/, '💪'], [/pull|chin|climb|boulder/, '🧗'], [/squat|lunge|leg|calf|calves|step.?up/, '🦵'],
    [/plank/, '🧱'], [/sit.?up|crunch|\babs?\b|core/, '🔥'], [/rowing|\berg\b/, '🚣'], [/run|jog|sprint/, '🏃'],
    [/hike|hiking/, '🥾'], [/walk|steps/, '🚶'], [/bike|cycl|ride|spin|peloton/, '🚴'], [/swim/, '🏊'], [/hockey/, '🏒'],
    [/basketball|hoops/, '🏀'], [/soccer|futbol/, '⚽'], [/football/, '🏈'], [/baseball|softball/, '⚾'],
    [/pickle|ping.?pong|table tennis/, '🏓'], [/tennis/, '🎾'], [/volleyball/, '🏐'], [/golf/, '⛳'], [/skat/, '⛸️'], [/\bski/, '⛷️'],
    [/yoga|stretch|pilates|mobility/, '🧘'], [/box|punch|kick|martial/, '🥊'], [/danc|zumba/, '💃'], [/cardio|elliptical|stair/, '❤️'],
  ];
  const ICON_CHOICES = ['💪', '🦵', '🏋️', '🤸', '🔥', '🧱', '🧗', '🧘', '🏃', '🚶', '🥾', '🚴', '🏊', '🚣', '🥊', '💃',
                        '🏒', '🏀', '⚽', '🏈', '⚾', '🎾', '🏓', '🏐', '⛳', '⛷️', '⛸️', '❤️', '⏱️', '🎯', '🦶', '⭐'];
  function iconOf(ev) {
    if (ev.icon) return ev.icon;
    const n = ev.name.toLowerCase(), hit = ICON_GUESSES.find(([re]) => re.test(n));
    return hit ? hit[1] : ev.unit === 'min' ? '⏱️' : '💪';
  }
  const amount = (id, n) => isMin(id) ? `${n} min` : String(n);
  function fmtMinutes(m) {
    if (Math.abs(m) < 60) return m + ' min';
    const h = Math.trunc(m / 60), r = Math.abs(m % 60);
    return r ? `${h.toLocaleString()}h ${r}m` : `${h.toLocaleString()} hr`;
  }

  // Totals, rebuilt in one pass over the log whenever the log changes (every screen update starts with this)
  let byDay = {}, byEvent = {}, allTime = {}, firstDay = null;
  function indexLog() {
    byDay = {}; byEvent = {}; allTime = {}; firstDay = null;
    for (const e of log) {
      const d = (byDay[e.d] ??= {}), v = (byEvent[e.ex] ??= {});
      d[e.ex] = (d[e.ex] || 0) + e.n; v[e.d] = (v[e.d] || 0) + e.n; allTime[e.ex] = (allTime[e.ex] || 0) + e.n;
      if (!firstDay || e.d < firstDay) firstDay = e.d;
    }
  }
  const totalsFor = id => byEvent[id] || {};
  const dayTotal = (id, d) => (byDay[d] || {})[id] || 0;

  // =============================== goals ===============================
  const goalFor = (id, day = dayKey()) => goalValue(goals[id], id, day);
  const goalOn = (id, d) => (dayGoals[d] && Number.isInteger(dayGoals[d][id])) ? dayGoals[d][id] : 0;
  const isWeekly = id => !!(goals[id] && goals[id].per === 'week');
  function weekSum(id, d, tot = totalsFor(id)) {           // Sunday through d
    let sum = 0;
    for (let x = weekStart(d); x <= d; x = shiftDay(x, 1)) sum += tot[x] || 0;
    return sum;
  }
  // The whole Sun-Sat week containing d (through today for the current week) and that week's latest recorded goal
  function weekTotal(id, d, today = dayKey()) {
    const start = weekStart(d), end = shiftDay(start, 6), last = end < today ? end : today;
    let goal = 0;
    for (let x = last; x >= start && !goal; x = shiftDay(x, -1)) goal = goalOn(id, x);
    return { sum: weekSum(id, last), goal };
  }
  // A month-based goal grows on its start day-of-month, clamped to the month's last day
  function monthAnniv(base, y, m) {
    const dom = Number(base.slice(8)), last = new Date(y, m + 1, 0).getDate();
    return dayKey(new Date(y, m, Math.min(dom, last)));
  }
  // The days a goal goes up: strictly after g.d, up to and including `day`
  function boundaries(g, day) {
    const out = [];
    if (g.every === 'never' || day <= g.d) return out;
    if (g.every === 'day') for (let d = shiftDay(g.d, 1); d <= day; d = shiftDay(d, 1)) out.push(d);
    else if (g.every === 'week') for (let d = shiftDay(g.d, 7 - weekday(g.d)); d <= day; d = shiftDay(d, 7)) out.push(d);
    else { const [y, m] = parts(g.d); for (let k = 1, d; (d = monthAnniv(g.d, y, m - 1 + k)) <= day; k++) out.push(d); }
    return out;
  }
  function countBoundaries(g, day) {                       // same count as boundaries(), without listing every day
    if (g.every === 'never' || day <= g.d) return 0;
    if (g.every === 'day') return daysBetween(g.d, day);
    if (g.every === 'week') { const first = shiftDay(g.d, 7 - weekday(g.d)); return day < first ? 0 : Math.floor(daysBetween(first, day) / 7) + 1; }
    return boundaries(g, day).length;
  }
  function goalValue(g, id, day) {
    if (!g) return 0;
    const capIt = v => g.cap ? Math.min(v, Math.max(g.cap, g.n)) : v;
    // A period made up only of rest days (with daily growth: the rest day itself) doesn't earn an increase
    const allRest = (a, b) => { if (!rest.days.length || a >= b) return false; for (let d = a; d < b; d = shiftDay(d, 1)) if (!isRest(d)) return false; return true; };
    if (!g.wait) {
      if (!rest.days.length) return capIt(g.n + g.step * countBoundaries(g, day));
      let n = 0, start = g.d;
      for (const b of boundaries(g, day)) { if (!allRest(start, b)) n++; start = b; }
      return capIt(g.n + g.step * n);
    }
    // "wait for me": a period earns its increase only if every day in it hit that day's goal (rest days excused)
    // (weekly goals: every full Sun-Sat week inside it hit the weekly goal)
    const tot = totalsFor(id);
    let v = g.n, start = g.d;
    for (const b of boundaries(g, day)) {
      if (allRest(start, b)) { start = b; continue; }
      let ok = true;
      if (g.per === 'week') {
        let w = weekStart(start); if (w < start) w = shiftDay(w, 7);
        for (; shiftDay(w, 6) < b; w = shiftDay(w, 7)) if (weekSum(id, shiftDay(w, 6), tot) < v) { ok = false; break; }
      } else {
        for (let d = start; d < b; d = shiftDay(d, 1)) if ((tot[d] || 0) < v && !isRest(d)) { ok = false; break; }
      }
      if (ok) v = capIt(v + g.step);
      start = b;
    }
    return v;
  }
  function describeGoal(g) {
    if (g.every === 'never') return 'fixed';
    return `+${g.step} every ${g.every}` + (g.cap ? `, up to ${g.cap}` : '') + (g.wait ? ', waits if you miss' : '');
  }
  function snapshotToday() {                               // remember today's goals so this day keeps its colors later
    const d = dayKey(), cur = {};
    for (const e of events) cur[e.id] = goalFor(e.id, d);
    if (JSON.stringify(dayGoals[d] || {}) !== JSON.stringify(cur)) { dayGoals[d] = cur; save('dayGoals'); }
  }

  // =============================== sets ===============================
  // Fewest sets that stay at or under the max, sized as evenly as possible, preferring round numbers (multiples of 5).
  // Always adds up to the goal exactly: 61 with max 30 -> 21+20+20, 55 with max 30 -> 30+25, 55 with max 25 -> 20+20+15
  function splitSets(goal, max) {
    if (goal <= 0) return [];
    const k = Math.ceil(goal / max);
    const score = sets => (Math.max(...sets) - Math.min(...sets)) + 2.5 * sets.filter(x => x % 5).length;
    const base = Math.floor(goal / k), extra = goal % k;
    let best = Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0)), bestScore = score(best);
    for (let q = 5; q <= max; q += 5) {
      for (let m = 1; m <= k - 1; m++) {
        const round = [...Array(m).fill(q), ...Array(k - 1 - m).fill(q - 5)];
        if (round.some(x => x < 1)) continue;
        const rest = goal - round.reduce((a, b) => a + b, 0);
        if (rest < 1 || rest > max) continue;
        const sets = [...round, rest], sc = score(sets);
        if (sc < bestScore) { best = sets; bestScore = sc; }
      }
    }
    return best.sort((a, b) => b - a);
  }
  // Taps less than a minute apart count as one set (log each set right after doing it).
  // A minus tap after a break corrects the previous set instead of starting a new one.
  function setsDone(id, day) {
    const groups = [];
    let lastT = -Infinity;
    for (const e of log) {
      if (e.d !== day || e.ex !== id) continue;
      if (!groups.length || (e.t - lastT > 60000 && e.n > 0)) groups.push(0);
      groups[groups.length - 1] += e.n;
      lastT = e.t;
    }
    return groups.filter(x => x > 0);
  }

  // =============================== pop-ups ===============================
  let toastTimer, celeTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), msg.length > 30 ? 2600 : 1400);
  }
  function celebrate(msgs) {
    const c = $('cele'); c.textContent = '';
    c.append(el('b', null, '🎉'), ...msgs.slice(0, 3).map(m => el('div', null, m)));
    c.classList.add('show'); clearTimeout(celeTimer);
    celeTimer = setTimeout(() => c.classList.remove('show'), 4000);
    if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
  }

  // =============================== logging reps ===============================
  function add(id, n, asSet) {
    if (!isActive(id) || !Number.isInteger(n) || n === 0 || Math.abs(n) > 1000) return;
    if (n < 0 && dayTotal(id, dayKey()) + n < 0) return;      // never below zero
    log.push({ d: dayKey(), ex: id, n, t: Date.now() });
    save('log'); render();
    toast(asSet ? `Set done: ${n} ${nameOf(id).toLowerCase()}` : `${n > 0 ? '+' : '−'}${amount(id, Math.abs(n))} ${nameOf(id).toLowerCase()}`);
    if (n > 0) checkMilestones(false);
    if (navigator.vibrate) navigator.vibrate(15);
  }
  function undo() {
    const last = log[log.length - 1];
    if (!last || last.d !== dayKey()) return;               // only today's taps
    log.pop();
    save('log'); render(); toast(`Undid ${last.n > 0 ? '+' : '−'}${amount(last.ex, Math.abs(last.n))} ${nameOf(last.ex).toLowerCase()}`);
  }
  $('undo').onclick = undo;

  // =============================== main screen ===============================
  function buildCards() {
    const wrap = $('events');
    wrap.replaceChildren(suggestBox);
    document.body.classList.toggle('compact', events.length >= 3);
    for (const ev of events) {
      const sec = el('section', 'ex' + (ev.unit === 'min' ? ' mins' : '')); sec.dataset.ex = ev.id; sec.style.setProperty('--c', ev.color);
      const sets = el('button', 'sets'); sets.setAttribute('aria-label', 'Sets; tap to change max per set');
      const done = el('button', 'add doneset'); done.hidden = true;     // "✓25": logs the next planned set
      const sl = el('div', 'setline'); sl.append(sets);
      const title = el('div', 'title'); title.append(el('span', 'ic', iconOf(ev)), el('span', 'nm', ev.name));
      const lhs = el('div', 'lhs'); lhs.append(title, sl);
      const cnt = el('span', 'cnt'); cnt.append(el('span', 'total', '0'), el('span', 'unit', 'today'));
      const goal = el('button', 'goal'); goal.setAttribute('aria-label', 'Set daily goal'); goal.append(cnt, el('span', 'alltime'));
      const top = el('div', 'top'); top.append(lhs, goal);
      const bar = el('div', 'bar'); bar.append(el('i'));
      const row = el('div', 'row'); row.append(done);
      for (const n of btnsOf(ev)) { const b = el('button', 'add', '+' + n); b.dataset.n = n; row.append(b); }
      const minus = el('button', 'add minus', '−1'); minus.dataset.n = -1; minus.setAttribute('aria-label', 'Minus 1'); row.append(minus);
      sec.append(top, bar, row);
      wrap.append(sec);
    }
    $('legend-txt').textContent = events.length === 2 ? `Top: ${events[0].name} · Bottom: ${events[1].name}` : events.length > 2 ? 'Boxes follow event order' : '';
  }
  $('events').addEventListener('click', e => {
    const b = e.target.closest('button'), sec = b && b.closest('.ex'); if (!sec) return;   // (the suggestion banner handles its own buttons)
    const id = sec.dataset.ex, c = b.classList;
    if (c.contains('doneset')) add(id, parseInt(b.dataset.n, 10), true);
    else if (c.contains('add')) add(id, parseInt(b.dataset.n, 10));
    else if (c.contains('goal')) openGoal(id);
    else if (c.contains('sets')) openMax(id);
  });

  function renderCard(ev, today) {
    const sec = document.querySelector(`.ex[data-ex="${ev.id}"]`);
    if (!sec) return;
    const g = goalFor(ev.id), dayN = dayTotal(ev.id, today), weekly = isWeekly(ev.id), mins = ev.unit === 'min';
    const n = weekly ? weekSum(ev.id, today) : dayN;         // weekly goals show the week so far
    const fmt = x => mins ? fmtMinutes(x) : x.toLocaleString();
    sec.querySelector('.total').textContent = n;
    sec.querySelector('.alltime').textContent = (weekly ? `${fmt(dayN)} today · ` : '') + fmt(allTime[ev.id] || 0) + ' all-time';
    const setsEl = sec.querySelector('.sets'), doneBtn = sec.querySelector('.doneset');
    setsEl.textContent = '';
    doneBtn.hidden = true;
    if (g && !mins && !weekly) {
      // sets already done (what you actually did), then the rest of the goal re-planned
      const done = setsDone(ev.id, today), plan = splitSets(Math.max(0, g - n), maxSet[ev.id]);
      if (plan.length) {                                    // one tap logs the next planned set
        doneBtn.hidden = false; doneBtn.dataset.n = plan[0]; doneBtn.textContent = '✓' + plan[0];
        doneBtn.setAttribute('aria-label', `Log a set of ${plan[0]} ${ev.name}`);
      }
      setsEl.append('(');
      [...done.map(r => ['done', r]), ...plan.map((r, i) => [i ? '' : 'next', r])].forEach(([cls, r], i) => {
        if (i) setsEl.append('+');
        setsEl.append(el('span', 's ' + cls, r));
      });
      setsEl.append(')');
    }
    sec.querySelector('.row').classList.toggle('with-set', !doneBtn.hidden);
    sec.querySelector('.minus').disabled = dayN <= 0;
    sec.classList.remove('lo', 'mid', 'hit', 'has-goal');
    const unit = sec.querySelector('.unit');
    if (g) {
      const pct = n / g;
      sec.classList.add('has-goal', pct >= 1 ? 'hit' : pct >= 0.5 ? 'mid' : 'lo');
      // the goal number is as big as the count; the extras (min, /wk, ✓) stay small
      unit.replaceChildren(el('span', 'gnum', `/ ${g}`), `${mins ? ' min' : ''}${weekly ? '/wk' : ''}` + (pct >= 1 ? ' ✓' : ''));
      sec.querySelector('.bar i').style.width = Math.min(100, pct * 100) + '%';
    } else unit.textContent = mins ? 'min today' : 'today';
  }

  function render() {
    const today = dayKey();
    indexLog();
    $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    for (const ev of events) renderCard(ev, today);
    const undoBtn = $('undo'), last = log[log.length - 1], canUndo = last && last.d === today;
    undoBtn.disabled = !canUndo;
    undoBtn.textContent = canUndo ? `↶ ${last.n > 0 ? '+' : '−'}${Math.abs(last.n)}` : '↶ Undo';
    undoBtn.setAttribute('aria-label', canUndo ? `Undo ${last.n} ${nameOf(last.ex)}` : 'Undo');
    snapshotToday();
    renderSuggestion(today);
    renderStreak(today);
    renderNudge();
    const g30 = $('grid30');
    calendarGrid(g30);
    const start = gridStart(today);
    for (let i = 0; i < 35; i++) g30.append(square(shiftDay(start, i), today));
    if ($('more').open) renderMore();
    requestAnimationFrame(updateFade);
  }
  // Rebuild everything after events change (cards, screen, and the More page's event list if open)
  const refreshAll = () => { buildCards(); render(); renderEditor(); };
  function updateFade() {                                  // fade the last card when the list scrolls
    const e = $('events');
    e.classList.toggle('more-below', e.scrollHeight - e.scrollTop - e.clientHeight > 4);
  }
  $('events').addEventListener('scroll', updateFade, { passive: true });
  addEventListener('resize', updateFade);

  // =============================== streaks ===============================
  // A day counts if every event with a daily goal that day reached it (days with no goals count if anything was logged).
  // Weekly goals don't make or break a day. Today joins the streak only once it's done.
  // A rest day that wasn't done bridges the streak: it doesn't break it and doesn't add to it.
  function dayDone(d, today) {
    const v = byDay[d] || {};
    const withGoal = (d === today ? events.map(e => [e.id, goalFor(e.id, d)]) : allEvents.map(e => [e.id, goalOn(e.id, d)]))
      .filter(([id, g]) => g > 0 && !isWeekly(id));
    if (withGoal.length) return withGoal.every(([id, g]) => (v[id] || 0) >= g);
    return Object.values(v).some(n => n > 0);
  }
  let streakInfo = { n: 0, todayDone: false };
  function renderStreak(today) {
    const todayDone = dayDone(today, today);
    let n = todayDone ? 1 : 0;
    if (firstDay) for (let d = shiftDay(today, -1); d >= firstDay; d = shiftDay(d, -1)) {
      if (dayDone(d, today)) n++;
      else if (!isRest(d)) break;
    }
    streakInfo = { n, todayDone };
    $('streak').textContent = '🔥 ' + n;
    $('streak').classList.toggle('zero', n === 0);
  }
  function longestStreak(today = dayKey()) {
    let best = 0, run = 0;
    if (firstDay) for (let d = firstDay; d <= today; d = shiftDay(d, 1)) {
      if (dayDone(d, today)) best = Math.max(best, ++run);
      else if (d !== today && !isRest(d)) run = 0;
    }
    return best;
  }

  // =============================== milestones: celebrate new records once; ones already reached are marked silently ===============================
  let records = (() => { const r = read(K.records, null); return r && typeof r === 'object' && r.seen ? r : { seen: {}, longest: 0, init: false }; })();
  const REPS_MARKS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000], HOUR_MARKS = [10, 25, 50, 100, 250, 500, 1000];
  function checkMilestones(silent) {
    const today = dayKey(), found = [];
    silent = silent || !records.init;
    const mark = (key, msg) => { if (!records.seen[key]) { records.seen[key] = 1; found.push(msg); } };
    for (const ev of events) {
      const tot = totalsFor(ev.id), mins = ev.unit === 'min', all = allTime[ev.id] || 0, name = ev.name.toLowerCase();
      for (const m of mins ? HOUR_MARKS.map(h => h * 60) : REPS_MARKS)
        if (all >= m) mark(`at:${ev.id}:${m}`, `${mins ? m / 60 + ' hours of' : m.toLocaleString()} ${name} all-time!`);
      const t = tot[today] || 0;
      let prev = 0; for (const [d, v] of Object.entries(tot)) if (d !== today && v > prev) prev = v;
      if (prev > 0 && t > prev) mark(`best:${ev.id}:${today}`, `New best day: ${amount(ev.id, t)} ${name} (was ${amount(ev.id, prev)})`);
    }
    const longest = longestStreak(today);
    if (longest > (records.longest || 0)) {
      if (longest >= 3 && streakInfo.n === longest && records.longest > 0) found.push(`New longest streak: ${longest} days!`);
      records.longest = longest;
    }
    records.init = true;
    write(K.records, records);
    if (!silent && found.length) celebrate(found);
  }

  // =============================== calendar ===============================
  const gridStart = today => shiftDay(today, -(weekday(today) + 28));   // 5 Sun-Sat rows ending this week
  function calendarGrid(grid) {                            // empty a grid and add the S M T W T F S header
    grid.classList.toggle('nums', events.length <= 2);     // numbers fit inside the halves
    grid.classList.toggle('boxed', events.length >= 3);
    grid.textContent = '';
    for (const w of 'SMTWTFS') grid.append(el('span', 'wk', w));
  }
  function stripe(ev, n, goal, cmp = n) {                  // cmp: what's measured against the goal (week-to-date for weekly goals)
    const s = el('span', 'h ' + (n <= 0 ? 'none' : !goal ? '' : cmp >= goal ? 'hit' : cmp >= goal / 2 ? 'mid' : 'lo'), n);
    if (n > 0 && !goal) s.style.background = ev.color;
    return s;
  }
  function square(d, today) {
    const v = byDay[d] || {};
    const b = el('button', 'day k' + events.length + (d === today ? ' today' : '') + (d > today ? ' future' : ''));
    b.dataset.d = d;
    for (const ev of events) {
      const n = v[ev.id] || 0;
      // weekly goals: every day logged that week shares the week's color, so meeting the goal turns them all green
      if (isWeekly(ev.id)) { const w = weekTotal(ev.id, d, today); b.append(stripe(ev, n, w.goal, w.sum)); }
      else b.append(stripe(ev, n, goalOn(ev.id, d)));
    }
    b.append(el('span', 'dn', Number(d.slice(8))));
    if (isRest(d)) { b.classList.add('rest'); b.append(el('span', 'zz', '💤')); }
    b.setAttribute('aria-label', pretty(d) + ': ' + events.map(ev => `${v[ev.id] || 0} ${ev.name}`).join(', ') + (isRest(d) ? ', rest day' : ''));
    return b;
  }

  // Tap a square: show its numbers for a few seconds (tap again to close)
  let showTimer, shown;
  const shownOn = v => allEvents.filter(e => !e.archived || (v[e.id] || 0) > 0);   // removed events only if they have reps that day
  function hideReveal() {
    clearTimeout(showTimer);
    if (shown) shown.classList.remove('show');
    shown = null;
    $('caption').textContent = ''; $('caption').parentElement.classList.remove('has-cap');
    $('peek').classList.remove('show');
  }
  function reveal(sq) {
    const again = shown === sq;
    hideReveal();
    if (again) return;
    const d = sq.dataset.d, v = byDay[d] || {}, list = shownOn(v);
    sq.classList.add('show'); shown = sq;
    if (list.length <= 2) {                                // short: a caption line above the grid
      const cap = $('caption');
      cap.append(el('b', null, pretty(d)));
      for (const ev of list) cap.append(' · ' + ev.name + ' ', el('span', 'k', v[ev.id] || 0));
      if (isRest(d)) cap.append(' · 💤 rest day');
      cap.parentElement.classList.add('has-cap');
    } else {                                               // longer: a pop-up list
      const pk = $('peek'), rows = el('div', 'rows');
      pk.textContent = '';
      pk.classList.toggle('two', list.length > 5);
      pk.append(el('b', null, pretty(d)), rows);
      for (const ev of list) {
        const r = el('div', 'pr' + (ev.archived ? ' gone' : '')), dot = el('i'); dot.style.background = ev.color;
        const g = goalOn(ev.id, d), em = el('em', null, v[ev.id] || 0);
        if (ev.unit === 'min') em.append(el('small', null, ' min'));
        const w = isWeekly(ev.id) ? weekTotal(ev.id, d) : null;
        if (w && w.goal) em.append(el('small', null, ` · week ${w.sum}/${w.goal}${w.sum >= w.goal ? ' ✓' : ''}`));
        else if (g && !w) em.append(el('small', null, ' / ' + g));
        r.append(dot, el('span', null, ev.name), em); rows.append(r);
      }
      if (isRest(d)) rows.append(el('div', 'pr rest-note', '💤 Rest day'));
      pk.classList.add('show');
    }
    showTimer = setTimeout(hideReveal, events.length <= 2 ? 3500 : 5000);
  }
  $('grid30').addEventListener('click', e => { const sq = e.target.closest('.day'); if (sq) reveal(sq); });
  $('peek').onclick = hideReveal;

  // =============================== stats ===============================
  let stEv = null;
  function openStats() {
    if (!evById(stEv) || evById(stEv).archived) stEv = events[0].id;
    renderStats(); $('sdlg').showModal();
  }
  function renderStats() {
    const today = dayKey(), ev = evById(stEv), mins = ev.unit === 'min';
    const fmt = x => mins ? fmtMinutes(x) : x.toLocaleString();
    const box = (cls, k, v, sub) => { const t = el('div', cls); t.append(el('span', null, k), el('b', null, v)); if (sub) t.append(el('small', null, sub)); return t; };
    $('st-streak').replaceChildren(box(null, 'Current streak', '🔥 ' + streakInfo.n), box(null, 'Longest streak', '🏆 ' + longestStreak(today)));
    $('st-ev').replaceChildren(...events.map(e => {
      const b = el('button'), dot = el('i'); b.dataset.ex = e.id; b.setAttribute('aria-pressed', String(e.id === stEv));
      dot.style.background = e.color; b.append(dot, e.name); return b;
    }));
    const tot = totalsFor(ev.id), days = Object.keys(tot).filter(d => tot[d] > 0).sort();
    const sumRange = (a, b) => { let s = 0; for (let d = a; d <= b; d = shiftDay(d, 1)) s += tot[d] || 0; return s; };
    const ws = weekStart(today), ms = today.slice(0, 8) + '01';
    let bestD = null; for (const d of days) if (!bestD || tot[d] > tot[bestD]) bestD = d;
    const allT = days.reduce((s, d) => s + tot[d], 0), span = days.length ? daysBetween(days[0], today) + 1 : 0;
    $('st-tiles').replaceChildren(
      box('tile', 'This week', fmt(sumRange(ws, today))),
      box('tile', 'Last week', fmt(sumRange(shiftDay(ws, -7), shiftDay(ws, -1)))),
      box('tile', 'This month', fmt(sumRange(ms, today))),
      box('tile', 'Best day', bestD ? fmt(tot[bestD]) : '–', bestD ? pretty(bestD) : ''),
      box('tile', 'Daily average', span ? fmt(Math.round(allT / span)) : '–', span ? `over ${span} days` : ''),
      box('tile', 'All-time', fmt(allT), days.length ? `${days.length} active days` : ''));
    // last 12 Sun-Sat weeks as bars in the event's color; tap a bar for its total
    const weeks = []; for (let k = 11; k >= 0; k--) { const a = shiftDay(ws, -7 * k), b = shiftDay(a, 6); weeks.push({ a, v: sumRange(a, b < today ? b : today) }); }
    const W = 340, H = 150, top = 16, base = 128, gap = 6, bw = (W - gap * 11) / 12, max = Math.max(1, ...weeks.map(w => w.v));
    const mk = (t, a) => { const n = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) n.setAttribute(k, a[k]); return n; };
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${ev.name}, weekly totals for the last 12 weeks` });
    svg.append(mk('line', { x1: 0, x2: W, y1: base + .5, y2: base + .5, stroke: 'var(--line)', 'stroke-width': 1 }));
    weeks.forEach((w, i) => {
      const x = i * (bw + gap), h = w.v ? Math.max(3, (w.v / max) * (base - top)) : 0, y = base - h, r = Math.min(4, bw / 2, h);
      if (h) svg.append(mk('path', { class: 'wbar', 'data-i': i, fill: ev.color,
        d: `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z` }));
      if (i === 11 || (w.v && w.v === max)) {
        const t = mk('text', { class: 'val', x: x + bw / 2, y: y - 4, 'text-anchor': 'middle' });
        t.textContent = mins ? fmtMinutes(w.v).replace(' min', 'm') : w.v; svg.append(t);
      }
      if (i % 4 === 3 || i === 0) {
        const t = mk('text', { class: 'lbl', x: i === 0 ? x : i === 11 ? x + bw : x + bw / 2, y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 11 ? 'end' : 'middle' });
        t.textContent = i === 11 ? 'This wk' : toDate(w.a).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); svg.append(t);
      }
      svg.append(mk('rect', { class: 'hit', x: x - gap / 2, y: 0, width: bw + gap, height: base, 'data-i': i }));
    });
    const ch = $('st-chart'); ch.replaceChildren(svg); ch.classList.remove('has-sel'); $('st-tip').textContent = '';
    ch.onclick = e => {
      const i = e.target.dataset && e.target.dataset.i; if (i == null) return;
      const w = weeks[i], short = d => pretty(d).replace(/^\w+, /, '');
      ch.classList.add('has-sel');
      for (const b of svg.querySelectorAll('.wbar')) b.classList.toggle('sel', b.dataset.i === String(i));
      $('st-tip').textContent = `${short(w.a)} – ${short(shiftDay(w.a, 6))}: ${fmt(w.v)}`;
    };
  }
  $('st-ev').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { stEv = b.dataset.ex; renderStats(); } });
  $('st-close').onclick = () => $('sdlg').close();
  $('stats-btn').onclick = $('streak').onclick = openStats;

  // =============================== More page: month-by-month history ===============================
  // Newest month first, back to the earliest logged month (at least 2 months); "Show earlier month" adds one more each tap.
  let extraMonths = 0;
  function renderMore() {
    const list = $('more-list'), today = dayKey(), [ty, tm] = parts(today), [fy, fm] = parts(firstDay || today);
    list.textContent = '';
    const count = Math.max(2, (ty - fy) * 12 + (tm - fm) + 1) + extraMonths;
    for (let k = 0; k < count; k++) {
      const m0 = new Date(ty, tm - 1 - k, 1), month = dayKey(m0).slice(0, 7), grid = el('div', 'grid'), sec = el('div');
      calendarGrid(grid);
      for (let i = m0.getDay(); i > 0; i--) grid.append(el('span', 'pad'));
      for (let d = dayKey(m0); d.slice(0, 7) === month; d = shiftDay(d, 1)) grid.append(square(d, today));
      sec.append(el('h3', null, m0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), grid);
      list.append(sec);
    }
  }
  $('more-earlier').onclick = () => { extraMonths++; renderMore(); };
  $('rest-every').addEventListener('change', e => {
    const n = parseInt(e.target.value, 10);
    if (!okInt(n, 2, 60)) { e.target.value = rest.every; return; }
    rest.every = n; save('rest'); toast(`1 rest day every ${n} days`);
  });
  $('rest-every').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('more-list').addEventListener('click', e => { const sq = e.target.closest('.day'); if (sq && !sq.classList.contains('future')) openDayEditor(sq.dataset.d); });
  $('more-btn').onclick = () => { extraMonths = 0; $('rest-every').value = rest.every; renderEditor(); renderMore(); bkStatus(); $('more').showModal(); $('more-scroll').scrollTop = 0; };
  $('more-close').onclick = () => { hideReveal(); $('more').close(); };

  // =============================== day editor: set any day's totals, or mark it a rest day ===============================
  let edDay = null, edRest = false;
  function renderRestToggle() {
    const b = $('ed-rest'), note = $('ed-rest-note'), clash = !edRest && restConflict(edDay);
    b.setAttribute('aria-pressed', String(edRest));
    b.textContent = edRest ? '💤 Rest day ✓' : '💤 Mark as rest day';
    b.disabled = !!clash;
    note.textContent = clash ? `You can have 1 rest day every ${rest.every} days, and ${pretty(clash)} is one.` : '';
  }
  $('ed-rest').onclick = () => { edRest = !edRest; renderRestToggle(); };
  function openDayEditor(d) {
    if (d > dayKey()) return;
    edDay = d;
    $('ed-title').textContent = pretty(d) + (d === dayKey() ? ' (today)' : '');
    edRest = isRest(d);
    renderRestToggle();
    $('ed-rows').replaceChildren(...allEvents.filter(e => !e.archived || dayTotal(e.id, d) > 0).map(ev => {
      const r = el('div', 'er'), dot = el('i'), nm = el('span', 'en', ev.name);
      r.dataset.ex = ev.id; dot.style.background = ev.color;
      if (ev.archived) nm.append(el('small', null, ' (removed)'));
      const minus = el('button', null, '−'), plus = el('button', null, '+');
      minus.dataset.d = -1; plus.dataset.d = 1;
      minus.setAttribute('aria-label', 'Less ' + ev.name); plus.setAttribute('aria-label', 'More ' + ev.name);
      const inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = 0; inp.max = 100000;
      inp.value = dayTotal(ev.id, d); inp.dataset.orig = inp.value;
      r.append(dot, nm, minus, inp, plus, el('span', 'u', ev.unit === 'min' ? 'min' : ''));
      return r;
    }));
    $('edlg').showModal();
  }
  const markChanged = inp => inp.classList.toggle('changed', inp.value !== inp.dataset.orig);
  $('ed-rows').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const inp = b.parentElement.querySelector('input');
    inp.value = Math.max(0, Math.min(100000, (parseInt(inp.value, 10) || 0) + Number(b.dataset.d)));
    markChanged(inp);
  });
  $('ed-rows').addEventListener('input', e => { if (e.target.tagName === 'INPUT') markChanged(e.target); });
  $('ed-rows').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  $('ed-cancel').onclick = () => $('edlg').close();
  $('ed-save').onclick = () => {
    const d = edDay, today = dayKey(), now = Date.now();
    let changed = 0;
    for (const r of $('ed-rows').querySelectorAll('.er')) {
      const id = r.dataset.ex, v = parseInt(r.querySelector('input').value, 10), cur = dayTotal(id, d);
      if (!okInt(v, 0, 100000) || v === cur) continue;
      changed++;
      if (d === today) log.push({ d, ex: id, n: v - cur, t: now });        // today: an adjustment, so Undo can take it back
      else { log = log.filter(e => !(e.ex === id && e.d === d)); if (v > 0) log.push({ d, ex: id, n: v, t: 0 }); }
    }
    if (edRest !== isRest(d) && (!edRest || !restConflict(d))) {
      changed++;
      rest.days = edRest ? [...rest.days, d].sort() : rest.days.filter(x => x !== d);
      save('rest');
    }
    $('edlg').close();
    if (!changed) return;
    sortLog();
    const before = streakInfo.n;
    save('log'); render();                                 // render() recounts the streak from the full history
    checkMilestones(true);
    const after = streakInfo.n;
    toast(`${pretty(d)} updated` + (after > before ? ` · streak now 🔥 ${after}` : after < before ? ` · streak now ${after}` : ''));
  };

  // =============================== More page: events ===============================
  function renderEditor() {
    const list = $('ev-list');
    list.textContent = '';
    for (const [i, ev] of events.entries()) {
      const row = el('div', 'evrow'), icon = el('button', 'evicon', iconOf(ev)), name = el('input', 'evname');
      row.dataset.ex = ev.id; icon.style.borderColor = ev.color; icon.setAttribute('aria-label', `Change emoji for ${ev.name}`);
      name.type = 'text'; name.maxLength = 20; name.value = ev.name; name.setAttribute('aria-label', 'Event name'); name.autocapitalize = 'words';
      const lab = ev.unit === 'min' ? el('span', 'mintag', 'minutes') : el('label', null, 'Max');
      if (ev.unit !== 'min') { const max = el('input', 'evmax'); max.type = 'number'; max.inputMode = 'numeric'; max.min = 1; max.max = 1000; max.value = maxSet[ev.id]; lab.append(max); }
      const mv = el('span', 'mv'), up = el('button', 'up', '▲'), down = el('button', 'down', '▼');
      up.setAttribute('aria-label', 'Move ' + ev.name + ' up'); down.setAttribute('aria-label', 'Move ' + ev.name + ' down');
      up.disabled = i === 0; down.disabled = i === events.length - 1;
      mv.append(up, down);
      const del = el('button', 'evdel', '✕'); del.setAttribute('aria-label', 'Remove ' + ev.name);
      row.append(icon, name, lab, mv, del);
      const br = el('div', 'evrow evbtns'); br.dataset.ex = ev.id;
      br.append(el('span', 'bl', 'Buttons'), ...btnsOf(ev).map((v, k) => {
        const inp = el('input', 'evbtn'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = 1; inp.max = 1000;
        inp.value = v; inp.dataset.k = k; inp.setAttribute('aria-label', `${ev.name} button ${k + 1}`); return inp;
      }), el('span', 'bl', ev.unit === 'min' ? 'min' : ''));
      list.append(row, br);
    }
    const full = events.length >= MAX_EVENTS;
    $('ev-add').disabled = $('ev-add-min').disabled = full;
    $('ev-add').textContent = full ? 'Up to 9 events' : '+ Reps event';
    $('ev-add-min').hidden = full;
    const gone = allEvents.filter(e => e.archived), arch = $('ev-arch');
    arch.textContent = '';
    arch.hidden = !gone.length;
    if (gone.length) arch.append(el('h4', null, 'Removed (history kept)'), ...gone.map(ev => {
      const row = el('div', 'evrow gone'), dot = el('span', 'dot'), days = Object.keys(totalsFor(ev.id)).length;
      row.dataset.ex = ev.id; dot.style.background = ev.color;
      const nm = el('span', 'gname', ev.name); nm.append(el('small', null, ' ' + plural(days, 'day')));
      row.append(dot, nm, el('button', 'restore', 'Restore'), el('button', 'erase', 'Erase'));
      return row;
    }));
  }
  function moveEvent(id, dir) {
    const order = events.map(e => e.id), i = order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    allEvents = [...order.map(evById), ...allEvents.filter(e => e.archived)];
    syncEvents(); save('events'); refreshAll();
  }
  function eraseEvent(id) {
    const ev = evById(id);
    if (!confirm(`Erase all history for ${ev.name}? This can't be undone (a backup made before now still has it).`)) return;
    allEvents = allEvents.filter(x => x.id !== id);
    log = log.filter(x => x.ex !== id);
    delete goals[id]; delete maxSet[id];
    for (const g of Object.values(dayGoals)) delete g[id];
    syncEvents(); save('events', 'log', 'goals', 'max', 'dayGoals');
    refreshAll(); toast(ev.name + ' erased');
  }
  function newEvent(name, unit, fallback) {                // a new active event with an unused color and a fresh id
    const used = new Set(allEvents.map(e => e.color)), color = PALETTE.find(c => !used.has(c)) || PALETTE[fallback % PALETTE.length];
    let id; do { id = 'e' + Math.random().toString(36).slice(2, 9); } while (evById(id));
    allEvents = [...events, { id, name, color, ...(unit === 'min' ? { unit: 'min' } : {}) }, ...allEvents.filter(e => e.archived)];
    syncEvents(); maxSet[id] = 20; goals[id] = null;
    return id;
  }
  function addEvent(unit) {
    if (events.length >= MAX_EVENTS) return;
    const base = unit === 'min' ? 'Cardio' : 'Event';
    let k = unit === 'min' ? 1 : events.length + 1, name;
    do { name = unit === 'min' && k === 1 ? base : base + ' ' + k; k++; } while (allEvents.some(e => e.name === name));
    const id = newEvent(name, unit, events.length);
    save('events', 'max', 'goals'); refreshAll();
    const input = $('ev-list').querySelector(`.evrow[data-ex="${id}"] .evname`);
    if (input) { input.focus(); input.select(); }
  }
  $('ev-add').onclick = () => addEvent('reps');
  $('ev-add-min').onclick = () => addEvent('min');
  $('ev-list').addEventListener('change', e => {
    const row = e.target.closest('.evrow'), ev = row && evById(row.dataset.ex), c = e.target.classList;
    if (!ev) return;
    if (c.contains('evname')) {
      const v = e.target.value.trim().slice(0, 20);
      if (!v) { e.target.value = ev.name; return; }
      ev.name = v; save('events'); buildCards(); render(); toast('Renamed to ' + v);
    } else if (c.contains('evbtn')) {
      const n = parseInt(e.target.value, 10), b = btnsOf(ev).slice(), k = Number(e.target.dataset.k);
      if (!okInt(n, 1, 1000)) { e.target.value = b[k]; return; }
      b[k] = n; ev.buttons = b; save('events'); buildCards(); render(); toast(`${ev.name} buttons: ${b.map(x => '+' + x).join(' ')}`);
    } else if (c.contains('evmax')) {
      const n = parseInt(e.target.value, 10);
      if (!okInt(n, 1, 1000)) { e.target.value = maxSet[ev.id]; return; }
      maxSet[ev.id] = n; save('max'); render(); toast(`${ev.name}: max ${n} per set`);
    }
  });
  $('ev-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  let delId = null;
  $('ev-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.evrow').dataset.ex, ev = evById(id); if (!ev) return;
    if (b.classList.contains('evicon')) return openIcons(id);
    if (b.classList.contains('up')) return moveEvent(id, -1);
    if (b.classList.contains('down')) return moveEvent(id, 1);
    if (!b.classList.contains('evdel')) return;
    if (events.length === 1) { toast('Keep at least one event'); return; }
    delId = id;
    $('del-title').textContent = `Remove ${ev.name}?`;
    $('deldlg').showModal();
  });
  $('del-keep').onclick = () => {
    $('deldlg').close();
    const ev = evById(delId); if (!ev) return;
    ev.archived = true; syncEvents(); save('events');
    refreshAll(); toast(ev.name + ' removed, history kept');
  };
  $('del-erase').onclick = () => { $('deldlg').close(); if (evById(delId)) eraseEvent(delId); };
  $('del-cancel').onclick = () => $('deldlg').close();
  $('ev-arch').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.evrow').dataset.ex, ev = evById(id); if (!ev) return;
    if (b.classList.contains('erase')) return eraseEvent(id);
    if (!b.classList.contains('restore')) return;
    if (events.length >= MAX_EVENTS) { toast('Remove an event first (9 max)'); return; }
    delete ev.archived;
    allEvents = [...events, ev, ...allEvents.filter(x => x.archived && x !== ev)];
    syncEvents(); save('events'); refreshAll(); toast(ev.name + ' restored');
  });

  // =============================== backup, restore, import, CSV ===============================
  // Files go out through the share sheet (Save to Files / iCloud Drive / Google Drive), or a download where that isn't available
  async function shareFile(file, okMsg, failMsg) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); toast(okMsg); return true; }
      catch (e) { if (e && e.name !== 'AbortError') toast(failMsg); return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast(okMsg); return true;
  }
  function backupAge() {                                   // days since the last backup, or Infinity if never
    let t = 0; try { t = Number(localStorage.getItem(K.backup)) || 0; } catch {}
    return t ? Math.floor((Date.now() - t) / 86400000) : Infinity;
  }
  function bkStatus() {
    const s = $('bk-status'), days = backupAge();
    s.textContent = days === Infinity ? 'Not backed up yet' : 'Last backup: ' + (days < 1 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago');
    s.className = days >= 7 ? 'warn' : '';
  }
  const renderNudge = () => { $('bk-nudge').hidden = !(log.length && backupAge() >= 7); };
  async function doBackup() {
    const data = { app: 'rep-tally', v: 2, saved: new Date().toISOString(), events: allEvents, log, goals, dayGoals, maxSet, rest };
    const file = new File([JSON.stringify(data)], `rep-tally-backup-${dayKey()}.json`, { type: 'application/json' });
    if (await shareFile(file, 'Backed up', 'Backup failed')) {
      try { localStorage.setItem(K.backup, String(Date.now())); } catch {}
      bkStatus(); renderNudge();
    }
  }
  $('bk-nudge').onclick = $('bk-save').onclick = () => doBackup();
  // One row per day with anything logged, one column per event (removed events included if they have history)
  $('csv-btn').onclick = () => {
    const cols = allEvents.filter(e => allTime[e.id] !== undefined);
    const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const withRest = rest.days.length > 0;                 // a "Rest day" column only once there are rest days
    const lines = [['Date', ...cols.map(e => e.name + (e.unit === 'min' ? ' (min)' : '')), ...(withRest ? ['Rest day'] : [])].map(q).join(',')];
    const days = [...new Set([...Object.keys(byDay).filter(d => cols.some(e => byDay[d][e.id])), ...rest.days])].sort();
    for (const d of days) lines.push([d, ...cols.map(e => (byDay[d] || {})[e.id] || 0), ...(withRest ? [isRest(d) ? 'yes' : ''] : [])].join(','));
    shareFile(new File([lines.join('\n') + '\n'], `rep-tally-${dayKey()}.csv`, { type: 'text/csv' }), 'Spreadsheet exported', 'Export failed');
  };
  $('bk-load').onclick = () => $('bk-file').click();
  $('bk-file').onchange = async () => {
    const f = $('bk-file').files[0]; $('bk-file').value = '';
    if (!f) return;
    let data;
    try { if (f.size > 5e6) throw 0; data = JSON.parse(await f.text()); } catch { toast("That file isn't a backup"); return; }
    if (data && data.app === 'rep-tally' && data.kind === 'add') return addHistory(data);
    if (!data || data.app !== 'rep-tally' || !Array.isArray(data.log)) { toast("That file isn't a backup"); return; }
    const newEvents = cleanEvents(data.events) || DEFAULT_EVENTS(), ids = new Set(newEvents.map(e => e.id));
    const newLog = cleanLog(data.log).filter(e => ids.has(e.ex)), days = [...new Set(newLog.map(e => e.d))].sort();
    const msg = (days.length
      ? `Replace what's on this phone with the backup?\n\n${plural(days.length, 'day')}, ${pretty(days[0])} to ${pretty(days[days.length - 1])}.`
      : 'This backup has no days in it. Replace everything on this phone anyway?')
      + `\nEvents: ${newEvents.filter(e => !e.archived).map(e => e.name).join(', ')}`;
    if (!confirm(msg)) return;
    allEvents = newEvents; syncEvents(); log = newLog;
    goals = cleanGoals(data.goals, allEvents); maxSet = cleanMax(data.maxSet, allEvents); dayGoals = cleanDayGoals(data.dayGoals);
    if (data.rest || rest.days.length) { rest = cleanRest(data.rest, rest.every); save('rest'); }   // older backups have no rest days
    save('events', 'log', 'goals', 'max', 'dayGoals');
    refreshAll(); toast('Restored');
    checkMilestones(true);
  };
  // "Add to history" files set an event's total on past days, matched by event name:
  // { app: 'rep-tally', kind: 'add', events: [{ name, unit }], days: [{ d, name, n }] }
  function addHistory(data) {
    const today = dayKey(), wanted = new Map();             // lower-case name -> { name, unit }
    for (const e of Array.isArray(data.events) ? data.events : [])
      if (e && typeof e.name === 'string' && e.name.trim()) wanted.set(e.name.trim().toLowerCase().slice(0, 20), { name: e.name.trim().slice(0, 20), unit: e.unit === 'min' ? 'min' : 'reps' });
    const days = (Array.isArray(data.days) ? data.days : []).filter(x => x && okDay(x.d) && x.d <= today && typeof x.name === 'string' && okInt(x.n, 0, 100000))
      .map(x => ({ d: x.d, key: x.name.trim().toLowerCase().slice(0, 20), n: x.n }));
    if (!days.length) { toast('Nothing to add in that file'); return; }
    for (const x of days) if (!wanted.has(x.key)) wanted.set(x.key, { name: x.key, unit: 'reps' });
    const findEv = key => allEvents.find(e => e.name.toLowerCase() === key), keys = [...new Set(days.map(x => x.key))];
    const toCreate = keys.filter(k => !findEv(k));
    if (events.length + toCreate.length > MAX_EVENTS) { toast('Too many events: remove one first (9 max)'); return; }
    const summary = keys.map(k => {
      const list = days.filter(x => x.key === k), w = wanted.get(k), ev = findEv(k);
      const label = ev ? ev.name : w.name + ' (new event' + (w.unit === 'min' ? ', minutes' : '') + ')';
      return `${label}: ${plural(list.length, 'day')}, ${pretty(list[0].d)} – ${pretty(list[list.length - 1].d)}`;
    }).join('\n');
    if (!confirm(`Add to your history?\n\n${summary}\n\nThis sets the total for those days. Anything already logged for that event on those days is replaced; nothing else changes.`)) return;
    for (const k of toCreate) { const w = wanted.get(k); newEvent(w.name.replace(/^./, c => c.toUpperCase()), w.unit, allEvents.length); }
    for (const x of days) {
      const ev = findEv(x.key); if (!ev) continue;
      log = log.filter(e => !(e.ex === ev.id && e.d === x.d));
      if (x.n > 0) log.push({ d: x.d, ex: ev.id, n: x.n, t: 0 });
    }
    sortLog();
    save('events', 'log', 'max', 'goals');
    refreshAll(); toast(`Added ${plural(days.length, 'day')} to history`);
    checkMilestones(true);
  }

  // =============================== "raise your goal?" suggestions ===============================
  // If an event beat its goal by 20%+ on each of the last 5 days (weekly goals: the last 3 full weeks), suggest the lowest of
  // those totals as the new goal, rounded down to a multiple of 5. "Not now" hides it for a week. Capped goals are left alone.
  const SUGKEY = 'rep-tally-suggest-v1';
  let snoozed = (() => { const v = read(SUGKEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
  const suggestBox = el('div', 'suggest'); suggestBox.hidden = true;
  let suggested = null;
  function findSuggestion(today) {
    for (const ev of events) {
      const g = goals[ev.id], cur = goalFor(ev.id, today);
      if (!g || g.cap || !cur || (okDay(snoozed[ev.id]) && snoozed[ev.id] > today)) continue;
      const weekly = g.per === 'week', totals = [];
      for (let k = 1, back = 0; totals.length < (weekly ? 3 : 5) && back < 14; k++) {
        let tot, goal;
        if (weekly) ({ sum: tot, goal } = weekTotal(ev.id, shiftDay(weekStart(today), -7 * k + 6), today));
        else { const d = shiftDay(today, -++back); if (isRest(d)) { k--; continue; } tot = dayTotal(ev.id, d); goal = goalOn(ev.id, d); }
        if (!goal || tot < goal * 1.2) break;
        totals.push(tot);
      }
      if (totals.length < (weekly ? 3 : 5)) continue;
      const low = Math.min(...totals), to = ev.unit === 'min' || low >= 20 ? Math.floor(low / 5) * 5 : low;
      if (to > cur) return { ev, low, cur, to, weekly };
    }
    return null;
  }
  function renderSuggestion(today) {
    suggested = findSuggestion(today);
    suggestBox.hidden = !suggested;
    document.body.classList.toggle('has-sg', !!suggested);   // cards scroll instead of squeezing the calendar
    if (!suggested) return;
    const { ev, low, cur, to, weekly } = suggested, u = ev.unit === 'min' ? ' min' : '';
    const msg = el('div', 'sg-msg');
    msg.append(el('b', null, `${iconOf(ev)} ${ev.name}: `), weekly
      ? `${low}+${u} each of the last 3 weeks. Raise this week's goal ${cur} → ${to}?`
      : `${low}+${u} every day for 5 days. Raise today's goal ${cur} → ${to}?`);
    const yes = el('button', 'sg-yes', `Raise to ${to}`), no = el('button', 'sg-no', '✕');
    no.setAttribute('aria-label', 'Not now');
    suggestBox.replaceChildren(msg, yes, no);
  }
  suggestBox.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !suggested) return;
    const { ev, to } = suggested, today = dayKey();
    if (b.classList.contains('sg-yes')) {                  // keep how the goal grows; start it again from the new number today
      goals[ev.id] = { ...goals[ev.id], d: today, n: to }; save('goals');
      delete snoozed[ev.id]; write(SUGKEY, snoozed);
      render(); toast(`${ev.name} goal raised to ${amount(ev.id, to)}`);
    } else if (b.classList.contains('sg-no')) {
      snoozed[ev.id] = shiftDay(today, 7); write(SUGKEY, snoozed);
      render(); toast(`OK, I'll ask again in a week`);
    }
  });

  // =============================== emoji picker ===============================
  let iconEx = null;
  function openIcons(id) {
    iconEx = id;
    const ev = evById(id);
    $('ic-title').textContent = `Emoji for ${ev.name}`;
    $('ic-grid').replaceChildren(...ICON_CHOICES.map(c => {
      const b = el('button', c === iconOf(ev) ? 'on' : null, c); b.dataset.ic = c; return b;
    }));
    $('icdlg').showModal();
  }
  $('ic-grid').addEventListener('click', e => {
    const b = e.target.closest('button'), ev = evById(iconEx); if (!b || !ev) return;
    ev.icon = b.dataset.ic; save('events'); $('icdlg').close(); refreshAll();
  });
  $('ic-auto').onclick = () => { const ev = evById(iconEx); if (ev) { delete ev.icon; save('events'); refreshAll(); } $('icdlg').close(); };
  $('ic-cancel').onclick = () => $('icdlg').close();

  // =============================== max-per-set dialog ===============================
  let maxEx = null;
  function openMax(id) {
    maxEx = id;
    $('dlg-title').textContent = `Max ${nameOf(id).toLowerCase()} per set`;
    $('dlg-input').value = maxSet[id];
    $('dlg').showModal(); setTimeout(() => $('dlg-input').focus(), 50);
  }
  $('dlg-ok').onclick = () => {
    const n = parseInt($('dlg-input').value, 10);
    $('dlg').close();
    if (isActive(maxEx) && okInt(n, 1, 1000)) { maxSet[maxEx] = n; save('max'); render(); toast(`Max ${nameOf(maxEx).toLowerCase()} per set: ${n}`); }
  };
  $('dlg-cancel').onclick = () => $('dlg').close();
  $('dlg-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('dlg-ok').click(); });

  // =============================== goal sheet ===============================
  let gEx = null;
  const segVal = id => ($(id).querySelector('[aria-pressed="true"]') || {}).dataset?.v;
  const setSeg = (id, v) => { for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v)); };
  function sheetGoal() {                                   // the goal as entered, starting today
    const n = parseInt($('g-n').value, 10), step = parseInt($('g-step').value, 10), cap = parseInt($('g-cap').value, 10);
    return cleanGoal({ d: dayKey(), n, step: step || 1, every: segVal('g-every'), cap: cap || 0, wait: segVal('g-wait') === '1', per: segVal('g-per') });
  }
  function previewGoal() {
    const g = sheetGoal(), pv = $('g-preview'), every = segVal('g-every'), wk = segVal('g-per') === 'week';
    $('g-n-label').textContent = wk ? "This week's goal" : "Today's goal";
    for (const r of ['g-cap-row', 'g-wait-row', 'g-step-row']) $(r).classList.toggle('off', every === 'never');
    pv.textContent = '';
    if (!g) { pv.textContent = wk ? "Enter this week's goal." : "Enter today's goal."; return; }
    if (g.every === 'never' || (g.cap && g.n >= g.cap)) { pv.append('Stays at ', el('b', null, g.n), wk ? ' every week.' : ' every day.'); return; }
    const today = dayKey(), plain = { ...g, wait: false }, next = boundaries(plain, shiftDay(today, 40))[0];
    const at = days => goalValue(plain, gEx, shiftDay(today, days));
    pv.append('Next: ', el('b', null, goalValue(plain, gEx, next)), ' on ' + pretty(next) + '. In 3 months: ', el('b', null, at(91)), ', in a year: ', el('b', null, at(365)), '.');
    if (g.wait) pv.append(wk ? ' (If you hit every week. Missed weeks pause it.)' : ' (If you hit every day. Misses pause it.)');
  }
  function openGoal(id) {
    gEx = id;
    const g = goals[id], today = goalFor(id);
    $('g-title').textContent = nameOf(id) + (isMin(id) ? ' goal (minutes)' : ' goal');
    $('g-n').value = today || '';
    $('g-step').value = g ? g.step : 1;
    $('g-cap').value = g && g.cap ? g.cap : '';
    setSeg('g-every', g ? g.every : 'never');
    setSeg('g-per', g ? g.per : (isMin(id) ? 'week' : 'day'));
    setSeg('g-wait', g && g.wait ? '1' : '0');
    $('g-clear').disabled = !g;
    previewGoal();
    $('gdlg').showModal();
    if (!today) setTimeout(() => $('g-n').focus(), 50);
  }
  for (const id of ['g-every', 'g-wait', 'g-per']) $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) { setSeg(id, b.dataset.v); previewGoal(); }
  });
  $('gdlg').querySelector('.stepper').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('g-step').value = Math.min(1000, Math.max(1, (parseInt($('g-step').value, 10) || 1) + Number(b.dataset.d)));
    previewGoal();
  });
  for (const id of ['g-n', 'g-step', 'g-cap']) $(id).addEventListener('input', previewGoal);
  $('g-cancel').onclick = () => $('gdlg').close();
  $('g-clear').onclick = () => {
    $('gdlg').close();
    if (isActive(gEx)) { goals[gEx] = null; save('goals'); render(); toast(nameOf(gEx) + ' goal cleared'); }
  };
  $('g-save').onclick = () => {
    const g = sheetGoal();
    if (!g) { $('g-n').focus(); return; }
    $('gdlg').close();
    if (isActive(gEx)) { goals[gEx] = g; save('goals'); render(); toast(`${nameOf(gEx)}: ${amount(gEx, g.n)} a ${g.per} · ${describeGoal(g)}`); }
  };

  // =============================== start-up, offline copy, updates ===============================
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });   // roll over past midnight
  buildCards();
  render();
  checkMilestones(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

  // "Check for update" fetches the latest page and reloads if its version differs from this one
  const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
  $('ver-txt').textContent = 'Version ' + APP_VERSION;
  $('ver-btn').onclick = async () => {
    $('ver-btn').textContent = 'Checking…';
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await reg.update().catch(() => {});
      const html = await fetch('./?v=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject());
      const m = html.match(/name="app-version" content="([^"]+)"/);
      if (m && m[1] !== APP_VERSION) { toast('Updating to ' + m[1] + '…'); setTimeout(() => location.reload(), 600); }
      else toast("You're on the latest version");
    } catch { toast("Couldn't check — no connection?"); }
    $('ver-btn').textContent = 'Check for update';
  };
})();
