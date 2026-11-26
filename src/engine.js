// Rules. Points are worked out again from the chat every time: a quest cleared by an AI judgment
// counts while that AI reply is still there, so re-rolling or deleting the reply takes it back.
// Purchases, manual clears and the tutorial reward always count.

import { ctx, settings, save, uid, room, currentChatId } from './store.js';
import { standingDefaults, dailyPool, questPool, parseCustomShop, shuffle, TUTORIAL_REWARD } from './data.js';

// ---------- a tiny event bus (engine → screens) ----------
const subs = {};
export const bus = {
    on(n, f) { (subs[n] ||= []).push(f); },
    emit(n, ...a) { for (const f of subs[n] || []) { try { f(...a); } catch (e) { console.error('[System Blink]', e); } } },
    ask: async () => null, // set by ai.js: (kind, opts) → made things or null
};
const changed = () => bus.emit('change');

// ---------- messages ----------
function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

/** A message's identity: its send time (each swipe has its own), or a hash of its text. */
export function msgKey(m) {
    if (!m) return null;
    if (m.send_date) return `d:${m.send_date}`;
    return `h:${hash(String(m.mes || ''))}`;
}

export function chatView() {
    let list = [];
    try { list = Array.isArray(ctx().chat) ? ctx().chat : []; } catch { list = []; }
    const keys = list.map(msgKey);
    const index = new Map();
    keys.forEach((k, i) => { if (k && !index.has(k)) index.set(k, i); });
    return { list, keys, index, length: list.length };
}

export const isAI = (m) => m && !m.is_user && !m.is_system;

export function lastReply(view = chatView()) {
    for (let i = view.length - 1; i >= 0; i--) if (isAI(view.list[i])) return { i, key: view.keys[i] };
    return null;
}
export function lastMine(view = chatView()) {
    for (let i = view.length - 1; i >= 0; i--) if (view.list[i]?.is_user) return { i, key: view.keys[i] };
    return null;
}

const alive = (key, view) => key == null || view.index.has(key);

// ---------- the room ----------
export function active(r = room()) { return !!(settings().enabled && r?.on); }

export function ownerName(r = room()) {
    if (r?.name) return r.name;
    try { return String(ctx().name1 || 'User'); } catch { return 'User'; }
}

export function rate(reward) { return Math.max(1, Math.round(Number(reward || 0) * settings().pointRate)); }

export function points(r = room(), view = chatView()) {
    if (!r) return 0;
    let earned = 0;
    const byId = new Map(r.quests.map(q => [q.id, q]));
    const doneCache = new Map();
    const isDone = (q) => { if (!doneCache.has(q.id)) doneCache.set(q.id, questState(r, q, view).status === 'done'); return doneCache.get(q.id); };
    for (const e of r.ledger) {
        if (e.undone || !alive(e.key, view)) continue;
        // a single condition counts only once the whole quest is done
        if (e.cond != null) { const q = byId.get(e.questId); if (!q || !isDone(q)) continue; }
        earned += Number(e.pts) || 0;
    }
    const spent = r.spend.reduce((a, x) => a + (Number(x.pts) || 0), 0);
    return Math.max(0, earned - spent);
}

// ---------- quests ----------
export const SUDDEN_LIMIT = 3;
const SUDDEN_ODDS = { off: 0, rare: 1 / 20, normal: 1 / 10, often: 1 / 5 };
const HIDDEN_ODDS = 1 / 8;

/** Today's daily quests. */
export function todays(r = room()) { return (r?.quests || []).filter(q => q.kind === 'daily' && q.day === r.day); }

export const condsOf = (q) => (Array.isArray(q?.conds) && q.conds.length > 1 ? q.conds : null);

/** Replies left for an accepted sudden quest (re-rolled replies give their reply back). */
export function suddenLeft(q, view = chatView()) {
    const used = (q.seen || []).filter(k => view.index.has(k)).length;
    return Math.max(0, (q.limit || SUDDEN_LIMIT) - used);
}

/**
 * { status: 'done' | 'active' | 'failed' | 'offered' | 'declined', entry, rerolled, condDone: [bool] | null }
 */
export function questState(r, q, view = chatView()) {
    const entries = r.ledger.filter(e => e.questId === q.id && !e.undone);
    const live = entries.filter(e => alive(e.key, view));
    const conds = condsOf(q);
    const whole = live.find(e => e.cond == null);
    const condDone = conds ? conds.map((_, i) => !!whole || live.some(e => e.cond === i)) : null;
    if (whole || (condDone && condDone.every(Boolean))) {
        const entry = whole || [...live].sort((a, b) => (b.pts || 0) - (a.pts || 0))[0];
        return { status: 'done', entry, condDone };
    }
    const rerolled = entries.some(e => e.key != null && !view.index.has(e.key));
    let status = q.failed ? 'failed' : 'active';
    if (q.kind === 'sudden') {
        if (q.state === 'offered') status = 'offered';
        else if (q.state === 'declined') status = 'declined';
        else if (suddenLeft(q, view) <= 0) status = 'failed';
    }
    return { status, entry: null, rerolled, condDone };
}

/** The main goal's stages (in order) and the one being worked on now. */
export function goalStages(r = room()) {
    if (!r?.goal) return [];
    return r.quests.filter(q => q.kind === 'goal' && q.goalId === r.goal.id).sort((a, b) => a.stage - b.stage);
}

export function goalNow(r = room(), view = chatView()) {
    const list = goalStages(r);
    const done = list.filter(q => questState(r, q, view).status === 'done').length;
    let idx = list.findIndex(q => questState(r, q, view).status !== 'done');
    const current = idx >= 0 ? list[idx] : null;
    const complete = !!r?.goal && done >= r.goal.total;
    return { list, current, done, total: r?.goal?.total || 0, complete, pending: !!r?.goal && !current && !complete };
}

/** Every quest that can still be cleared now (what the story check asks about). */
export function openQuests(r = room(), view = chatView()) {
    if (!r) return [];
    const out = todays(r).filter(q => questState(r, q, view).status === 'active');
    for (const q of r.quests) if ((q.kind === 'sudden' || q.kind === 'hidden') && questState(r, q, view).status === 'active') out.push(q);
    const g = goalNow(r, view).current;
    if (g) out.push(g);
    return out;
}

export function clearByHand(questId) {
    const r = room();
    const q = r?.quests.find(x => x.id === questId);
    if (!q || questState(r, q).status !== 'active') return;
    const pts = rate(q.reward);
    r.ledger.push({ id: uid('l'), questId, cond: null, pts, key: null, reason: '', at: Date.now(), byHand: true });
    if (q.kind === 'daily') tutorialStep(r, 1);
    save(); changed();
    bus.emit('cleared', [{ q, pts }]);
    if (q.kind === 'goal') bus.emit('stageCleared', q);
}

export function undoClear(questId) {
    const r = room();
    const view = chatView();
    for (const e of r?.ledger || []) if (e.questId === questId && !e.undone && alive(e.key, view)) e.undone = true;
    save(); changed();
}

// ----- sudden quests -----
/** Answer a sudden quest's popup (or its buttons in the Quests tab). */
export function answerSudden(questId, accept) {
    const r = room();
    const q = r?.quests.find(x => x.id === questId && x.kind === 'sudden');
    if (!q || q.state !== 'offered') return;
    q.state = accept ? 'accepted' : 'declined';
    q.acceptKey = lastReply()?.key || '';
    q.seen = [];
    save(); changed();
}

/**
 * The dice for the newest reply: may a sudden quest come, may a hidden one be found?
 * Rolled once per reply (a re-rolled reply is a new reply). Nothing during the tutorial.
 */
export function rollFor(r, key) {
    if (!r || !key) return { sudden: false, hidden: false };
    if (r.roll?.key === key) return r.roll;
    const s = settings();
    const rnd = typeof globalThis.__sblinkRandom === 'function' ? globalThis.__sblinkRandom : Math.random;
    const view = chatView();
    const busy = r.quests.some(q => q.kind === 'sudden' && ['offered', 'active'].includes(questState(r, q, view).status));
    const tut = r.tutorial?.state === 'active';
    let sudden = false;
    if (!tut && !busy) {
        if (r.suddenRest > 0) r.suddenRest -= 1;
        else sudden = rnd() < (SUDDEN_ODDS[s.suddenFreq] || 0);
    }
    const hiddenOpen = r.quests.some(q => q.kind === 'hidden' && questState(r, q, view).status === 'active');
    const hidden = !tut && s.hiddenOn && !hiddenOpen && rnd() < HIDDEN_ODDS;
    r.roll = { key, sudden, hidden };
    save();
    return r.roll;
}

/** An accepted sudden quest is waiting: every reply must be checked so its time runs. */
export function needsEveryCheck(r = room(), view = chatView()) {
    return !!r?.quests.some(q => q.kind === 'sudden' && questState(r, q, view).status === 'active');
}

// ----- main goal -----
/** Set (or replace) the main goal with its first stage. */
export function setGoal({ title, total, stage }) {
    const r = room();
    if (!r) return null;
    // stages of an old goal stay only if they gave points (so points are not lost)
    r.quests = r.quests.filter(q => q.kind !== 'goal' || r.ledger.some(e => e.questId === q.id && !e.undone));
    r.goal = { id: uid('g'), title: String(title || '').slice(0, 80), total: Math.max(2, Math.min(5, Math.round(Number(total) || 4))), done: false };
    addStage(r, 0, stage);
    save(); changed();
    return r.goal;
}

/** Change the goal's title and the current stage's text (by hand). */
export function editGoal({ title, total, stage }) {
    const r = room();
    if (!r?.goal) return;
    r.goal.title = String(title || r.goal.title).slice(0, 80);
    const st = goalStages(r);
    const nowDone = st.filter(q => questState(r, q).status === 'done').length;
    r.goal.total = Math.max(nowDone + 1, Math.min(5, Math.round(Number(total) || r.goal.total)));
    const cur = goalNow(r).current;
    if (cur && stage) {
        cur.name = String(stage.name || cur.name).slice(0, 80);
        const conds = (stage.conds || []).map(c => String(c || '').trim().slice(0, 80)).filter(Boolean);
        cur.conds = conds.length > 1 ? conds : undefined;
        if (stage.reward) cur.reward = stageReward(stage.reward, cur.stage);
    }
    save(); changed();
}

const stageReward = (v, i) => Math.min(300, Math.max(100, Math.round(Number(v) || (100 + i * 50))));

function addStage(r, i, stage) {
    const conds = (stage?.conds || []).map(c => String(c || '').trim().slice(0, 80)).filter(Boolean).slice(0, 3);
    const q = {
        id: uid('q'), kind: 'goal', goalId: r.goal.id, stage: i, name: String(stage?.name || '?').slice(0, 80),
        reward: stageReward(stage?.reward, i), day: r.day, failed: false,
    };
    if (conds.length > 1) q.conds = conds;
    r.quests = r.quests.filter(x => !(x.kind === 'goal' && x.goalId === r.goal.id && x.stage === i));
    r.quests.push(q);
    return q;
}

let makingStage = false;
export const isMakingStage = () => makingStage;

/** After a stage is cleared: the AI makes the next one from the story now (or the goal is complete). */
export async function nextStage(chatId = currentChatId()) {
    if (makingStage) return null;
    makingStage = true;
    try { return await makeNextStage(chatId); } finally { makingStage = false; changed(); }
}

async function makeNextStage(chatId) {
    const r = room(chatId);
    if (!active(r) || !r.goal) return null;
    const g = goalNow(r);
    if (g.complete) {
        if (!r.goal.done) { r.goal.done = true; save(); changed(); bus.emit('goalDone', r.goal); }
        return null;
    }
    if (!g.pending) return null;
    const i = g.list.length;
    let made = null;
    try { made = await bus.ask('stage', { title: r.goal.title, done: g.list.map(q => q.name), index: i, total: r.goal.total }); } catch (e) { console.warn('[System Blink] stage', e); }
    const rr = room(chatId);
    if (!rr?.goal || !made?.name) { changed(); return null; }
    if (goalNow(rr).list.length !== i) return null;
    const q = addStage(rr, i, made);
    save(); changed();
    if (chatId === currentChatId()) bus.emit('stageArrived', q);
    return q;
}

// ---------- AI checks (stored per AI reply) ----------
const KEEP_CHECKS = 12;

/**
 * Store one check result for an AI reply and apply what it found: quest (and condition) clears,
 * sudden quests' time, a new sudden or hidden quest. Returns { cleared, failed, sudden, hidden, stages }.
 */
export function storeCheck(chatId, key, res) {
    const out = { cleared: [], failed: [], sudden: null, hidden: null, stages: [] };
    const r = room(chatId);
    if (!r) return out;
    const view = chatView();
    r.checks = r.checks.filter(c => c.key !== key);
    const prev = lifeNow(r, view);
    const life = {}, lifeFrom = {};
    if (r.lifeMode) for (const [k, v] of Object.entries(res.life || {})) if (v && v !== prev[k]) { life[k] = v; lifeFrom[k] = prev[k] || ''; }
    const check = { key, t: Date.now(), quests: [], life, lifeFrom, days: res.days || 0, dayReason: res.dayReason || '', nextTime: res.nextTime || '', dismissed: false };
    for (const { questId, cond = null, reason } of res.quests || []) {
        const q = r.quests.find(x => x.id === questId);
        if (!q || questState(r, q, view).status !== 'active') continue;
        const conds = condsOf(q);
        const c = conds && cond != null && cond >= 0 && cond < conds.length ? cond : null;
        if (conds && c == null) continue;
        if (c != null && questState(r, q, view).condDone?.[c]) continue;
        check.quests.push({ questId, cond: c, reason });
        const entry = { id: uid('l'), questId, cond: c, pts: 0, key, reason, at: Date.now() };
        r.ledger.push(entry);
        if (questState(r, q, view).status === 'done') {
            // the last condition (or the only one) carries the reward
            const others = r.ledger.filter(e => e !== entry && e.questId === q.id && !e.undone && alive(e.key, view)).reduce((a, e) => a + (Number(e.pts) || 0), 0);
            entry.pts = Math.max(0, rate(q.reward) - others);
            out.cleared.push({ q, pts: entry.pts, reason });
            if (q.kind === 'goal') out.stages.push(q);
        }
    }
    if (out.cleared.some(c => c.q.kind === 'daily')) tutorialStep(r, 1);
    // accepted sudden quests: this reply used one of their replies
    for (const q of r.quests) {
        if (q.kind !== 'sudden' || q.state !== 'accepted' || key === q.acceptKey) continue;
        if (questState(r, q, view).status !== 'active') continue;
        q.seen = [...(q.seen || []).filter(k => k !== key), key];
        if (questState(r, q, view).status === 'failed') out.failed.push(q);
    }
    // something new
    if (res.sudden?.name && r.roll?.key === key && r.roll.sudden) {
        const q = { id: uid('q'), kind: 'sudden', name: String(res.sudden.name).slice(0, 80), reward: Math.min(100, Math.max(30, Math.round(Number(res.sudden.reward) || 50))), day: r.day, failed: false, state: 'offered', limit: SUDDEN_LIMIT, seen: [], fromKey: key };
        r.quests.push(q);
        r.suddenRest = settings().suddenRest;
        out.sudden = q;
    }
    if (res.hidden?.name && r.roll?.key === key && r.roll.hidden) {
        const q = { id: uid('q'), kind: 'hidden', name: String(res.hidden.name).slice(0, 80), reward: Math.min(200, Math.max(50, Math.round(Number(res.hidden.reward) || 100))), day: r.day, failed: false, why: String(res.hidden.why || '').slice(0, 120), fromKey: key };
        r.quests.push(q);
        out.hidden = q;
    }
    trimQuests(r);
    r.checks.push(check);
    if (r.checks.length > KEEP_CHECKS) r.checks.splice(0, r.checks.length - KEEP_CHECKS);
    r.lastCheckKey = key;
    save();
    return out;
}

/** Sudden quests whose reply was re-rolled before they were answered go away; old finished ones too. */
function trimQuests(r, view = chatView()) {
    r.quests = r.quests.filter(q => !(q.kind === 'sudden' && q.state === 'offered' && q.fromKey && !view.index.has(q.fromKey)));
    const extra = r.quests.filter(q => (q.kind === 'sudden' || q.kind === 'hidden') && q.day < r.day - 7 && !['active', 'offered'].includes(questState(r, q, view).status));
    if (extra.length) r.quests = r.quests.filter(q => !extra.includes(q) || r.ledger.some(e => e.questId === q.id && !e.undone));
}

/** Run on redraws: drops a sudden offer whose reply is gone. */
export function tidy() {
    const r = room();
    if (!r) return;
    const n = r.quests.length;
    trimQuests(r);
    if (r.quests.length !== n) save();
}

export function checkFor(r, key) { return r?.checks.find(c => c.key === key) || null; }

/** Daily-life fields now: what I set by hand, then what valid AI checks noticed after that. */
export function lifeNow(r = room(), view = chatView()) {
    const out = { ...(r?.lifeBase || {}) };
    if (!r) return out;
    const list = r.checks.filter(c => c.t > (r.lifeBase.at || 0) && view.index.has(c.key)).sort((a, b) => a.t - b.t);
    for (const c of list) for (const k of ['date', 'time', 'weather', 'place']) if (c.life?.[k]) out[k] = c.life[k];
    return out;
}

export function setLife(fields) {
    const r = room();
    if (!r) return;
    const now = lifeNow(r);
    r.lifeBase = { ...now, ...fields, at: Date.now() };
    save(); changed();
}

/** "A day (or more) seems to have passed" — only for the newest AI reply, only with story days. */
export function suggestion(r = room(), view = chatView()) {
    if (!active(r) || settings().dayBasis !== 'story') return null;
    const c = [...r.checks].reverse().find(x => x.days > 0 && !x.dismissed && view.index.has(x.key));
    if (!c) return null;
    const life = lifeNow(r, view);
    const days = Math.min(30, c.days);
    return { key: c.key, days, reason: c.dayReason, fromDay: r.day, toDay: r.day + days, fromTime: life.time, nextTime: c.nextTime, open: todays(r).filter(q => questState(r, q, view).status === 'active') };
}

export function dismissSuggestion(key) {
    const c = checkFor(room(), key);
    if (c) { c.dismissed = true; save(); changed(); }
}

// ---------- days ----------
/**
 * Move to the next day (or `days` days on). Settles once, however many days: unfinished quests
 * are marked failed, new daily quests come, the daily shop is restocked, the AI is told.
 */
export async function nextDay(days = 1, nextTime = '') {
    const chatId = currentChatId();
    const r = room(chatId);
    if (!active(r)) return;
    days = Math.max(1, Math.min(30, Math.round(days) || 1));
    const view = chatView();
    const failed = [];
    for (const q of todays(r)) if (questState(r, q, view).status === 'active') { q.failed = true; failed.push(q); }
    for (const c of r.checks) c.dismissed = true;
    r.day += days;
    const life = lifeNow(r, view);
    r.lifeBase = { ...life, time: nextTime || '', at: Date.now() };
    r.notes.push({ id: uid('n'), text: days === 1 ? 'One day has passed in the story. It is now a new day.' : `${days} days have passed in the story.`, at: Date.now(), deliveredKey: null });
    if (r.notes.length > 10) r.notes.splice(0, r.notes.length - 10);
    r.shop.daily = []; r.shop.dailyDay = 0;
    save(); changed();
    bus.emit('dayMoved', { days, failed });
    await newQuests(chatId);
}

/** Today's daily quests (2–3). AI first, the built-in list if that fails. */
export async function newQuests(chatId = currentChatId(), { replaceOpen = false } = {}) {
    const r = room(chatId);
    if (!active(r)) return;
    const view = chatView();
    const keep = replaceOpen ? todays(r).filter(q => questState(r, q, view).status !== 'active') : todays(r);
    if (!replaceOpen && keep.length) return;
    const want = replaceOpen ? Math.max(1, todays(r).length - keep.length) : 3;
    if (replaceOpen) r.quests = r.quests.filter(q => q.day !== r.day || keep.includes(q));
    let made = null;
    try { made = await bus.ask('quests', { count: want, avoid: keep.map(q => q.name) }); } catch (e) { console.warn('[System Blink] quests', e); }
    const rr = room(chatId);
    if (!rr) return;
    let list = Array.isArray(made) && made.length ? made : fallbackQuests(want, keep.map(q => q.name));
    list = list.slice(0, want).map(q => ({ id: uid('q'), kind: 'daily', name: String(q.name).slice(0, 80), reward: Math.min(30, Math.max(10, Math.round(Number(q.reward) || 10))), day: rr.day, failed: false }));
    rr.quests.push(...list);
    // keep the list short: drop quests of old days beyond the last few
    const minDay = rr.day - 7;
    rr.quests = rr.quests.filter(q => q.kind !== 'daily' || q.day >= minDay || rr.ledger.some(e => e.questId === q.id));
    save(); changed();
    if (list.length && chatId === currentChatId()) bus.emit('questsArrived', list);
}

export function fallbackQuests(n, avoid = []) {
    const s = settings();
    const pool = questPool(langOf(), s.oddities).filter(q => !avoid.includes(q.name));
    return shuffle(pool).slice(0, n);
}

let langGetter = () => 'en';
export function setLangGetter(f) { langGetter = f; }
export const langOf = () => langGetter();

// ---------- real-time day basis ----------
export function realDateNow() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** With real time as the day basis, a new real date moves one day on (settles once). */
export async function checkRealDay() {
    const r = room();
    if (!active(r) || settings().dayBasis !== 'real') return;
    const today = realDateNow();
    if (!r.realDate) { r.realDate = today; save(); return; }
    if (r.realDate === today) return;
    r.realDate = today;
    await nextDay(1);
}

// ---------- shop ----------
export function standingItems(r = room()) {
    const s = settings();
    const list = [];
    if (s.useDefaults) list.push(...standingDefaults(langOf()));
    list.push(...parseCustomShop(s.customShop));
    list.push(...(r?.shop.standing || []));
    return list;
}

export function dailyReady(r = room()) { return !!r && r.shop.dailyDay === r.day && r.shop.daily.length > 0; }

export async function stockDaily(chatId = currentChatId(), force = false) {
    const r = room(chatId);
    if (!active(r) || (!force && dailyReady(r))) return;
    let made = null;
    try { made = await bus.ask('shop', { count: 4 + Math.floor(Math.random() * 3), kind: 'daily' }); } catch (e) { console.warn('[System Blink] shop', e); }
    const rr = room(chatId);
    if (!rr) return;
    const list = Array.isArray(made) && made.length ? made : fallbackDaily();
    rr.shop.daily = list.slice(0, 6).map(x => ({ ...cleanItem(x), id: uid('d'), sold: false }));
    rr.shop.dailyDay = rr.day;
    save(); changed();
}

export async function restockStanding(chatId = currentChatId()) {
    const r = room(chatId);
    if (!active(r)) return;
    let made = null;
    try { made = await bus.ask('shop', { count: 4, kind: 'standing' }); } catch (e) { console.warn('[System Blink] shop', e); }
    const rr = room(chatId);
    if (!rr) return;
    rr.shop.standing = (Array.isArray(made) ? made : []).slice(0, 6).map(x => ({ ...cleanItem(x), id: uid('s') }));
    save(); changed();
    return Array.isArray(made) && made.length > 0;
}

function fallbackDaily() {
    const s = settings();
    const pool = dailyPool(langOf()).filter(x => s.oddities || !x.odd);
    // the legendary one shows up only now and then
    const picked = shuffle(pool).filter(x => x.rarity !== 'legendary' || Math.random() < 0.25);
    return picked.slice(0, 4 + Math.floor(Math.random() * 3));
}

export function cleanItem(x) {
    const rarity = ['common', 'rare', 'epic', 'legendary'].includes(x?.rarity) ? x.rarity : 'common';
    const band = { common: [20, 80], rare: [100, 200], epic: [300, 500], legendary: [800, 1500] }[rarity];
    const price = Math.min(band[1], Math.max(band[0], Math.round(Number(x?.price) || band[0])));
    return { name: String(x?.name || '?').slice(0, 60), desc: String(x?.desc || '').slice(0, 200), rarity, price, icon: String(x?.icon || 'box'), kind: x?.kind === 'reroll' ? 'reroll' : 'item', limited: !!x?.limited, odd: !!x?.odd };
}

/** Buy one thing. Returns false when points are short. */
export function buy(item, where) {
    const r = room();
    if (!active(r) || !item) return false;
    if (points(r) < item.price) return false;
    if (where === 'daily') {
        const d = r.shop.daily.find(x => x.id === item.id);
        if (!d || d.sold) return false;
        d.sold = true;
    }
    r.spend.push({ id: uid('p'), what: item.name, pts: item.price, at: Date.now() });
    const same = r.bag.find(b => b.name === item.name && b.kind === (item.kind || 'item') && b.rarity === item.rarity);
    if (same) same.count += 1;
    else r.bag.push({ id: uid('i'), name: item.name, desc: item.desc, rarity: item.rarity, icon: item.icon, kind: item.kind || 'item', count: 1 });
    tutorialStep(r, 2);
    save(); changed();
    return true;
}

/** Use one from the bag. The AI hears about it with my next message (and its re-rolls). */
export async function useItem(bagId) {
    const r = room();
    const b = r?.bag.find(x => x.id === bagId);
    if (!active(r) || !b || b.count < 1 || b.kind === 'gacha') return null;
    b.count -= 1;
    if (b.count <= 0) r.bag = r.bag.filter(x => x !== b);
    const use = { id: uid('u'), name: b.name, desc: b.desc, rarity: b.rarity, icon: b.icon, kind: b.kind, at: Date.now(), key: null };
    r.uses.push(use);
    if (r.uses.length > 40) r.uses.splice(0, r.uses.length - 40);
    tutorialStep(r, 3);
    save(); changed();
    if (b.kind === 'reroll') await newQuests(currentChatId(), { replaceOpen: true });
    return use;
}

/** My message was sent: uses not yet tied to a message belong to it now. */
export function bindUses(view = chatView()) {
    const r = room();
    const mine = lastMine(view);
    if (!r || !mine) return;
    let any = false;
    for (const u of r.uses) if (u.key == null) { u.key = mine.key; any = true; }
    if (any) save();
}

/** Notes went out with this AI reply. */
export function markDelivered(key, sentIds) {
    const r = room();
    if (!r || !key || !sentIds?.length) return;
    for (const n of r.notes) if (sentIds.includes(n.id)) n.deliveredKey = key;
    save();
}

// ---------- tutorial ----------
export function tutorialStep(r, n) {
    const t = r?.tutorial;
    if (!t || t.state !== 'active' || t.done[n]) return;
    for (let i = 0; i < n; i++) if (!t.done[i]) return; // in order
    t.done[n] = true;
    if (t.done.every(Boolean)) finishTutorial(r);
    else bus.emit('tutorialStep', n);
}

function finishTutorial(r) {
    const t = r.tutorial;
    t.state = 'done';
    if (t.rewarded) return;
    t.rewarded = true;
    r.ledger.push({ id: uid('l'), questId: 'tutorial', cond: null, pts: TUTORIAL_REWARD, key: null, reason: '', at: Date.now() });
    const ko = langOf() === 'ko';
    r.bag.push({ id: uid('i'), name: ko ? '뽑기권' : 'Gacha Ticket', desc: ko ? '한 번 뽑을 수 있다. (2단계에서 열림)' : 'One draw. (Opens in stage 2.)', rarity: 'rare', icon: 'ticket', kind: 'gacha', count: 1 });
    const title = ko ? '튜토리얼 수료자' : 'Tutorial Graduate';
    if (!r.titles.includes(title)) r.titles.push(title);
    if (!r.title) r.title = title;
    bus.emit('tutorialDone');
}

export function skipTutorial() {
    const r = room();
    if (!r) return;
    r.tutorial.state = 'skipped';
    save(); changed();
}

/** Switch the system on in this chat (first time: the awakening and day 1). */
export async function switchOn() {
    const chatId = currentChatId();
    const r = room(chatId, true);
    if (!r) return;
    const first = r.tutorial.state === 'none' && !r.quests.length;
    r.on = true;
    if (!r.realDate) r.realDate = realDateNow();
    save(); changed();
    if (first) {
        if (settings().tutorialAuto) { r.tutorial.state = 'active'; bus.emit('awaken'); }
        else r.tutorial.state = 'skipped';
        save();
        await newQuests(chatId);
    }
}

export function switchOff() {
    const r = room();
    if (!r) return;
    r.on = false;
    save(); changed();
}
