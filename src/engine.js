// Rules. Points are worked out again from the chat every time: a quest cleared by an AI judgment
// counts while that AI reply is still there, so re-rolling or deleting the reply takes it back.
// Purchases, manual clears and the tutorial reward always count.

import { ctx, settings, conf, save, uid, room, currentChatId, ownerKey, DIFFS, TONES, keyTime } from './store.js';
import { t } from './i18n.js';
import { dayCandidates, applyLog } from './cycle.js';
import { standingDefaults, dailyPool, questPool, penaltyPool, parseCustomShop, shuffle, TUTORIAL_REWARD, GRADES, LOW_GRADES, skillPool, gachaOddPool, eraserItem, specLine, specNames } from './data.js';

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

/**
 * 0.6.10: ask the AI for one chat. The request reads the open chat (its story and settings), so when that chat
 * is no longer open nothing is asked: the caller's built-in fallback is used (or it tries again later).
 */
function askFor(chatId, kind, opts) {
    if (!chatId || chatId !== currentChatId()) return Promise.resolve(null);
    return bus.ask(kind, opts);
}

/**
 * 0.6.11: after waiting for the AI, the chat's data only if it is still the very same data the request started
 * with. While waiting, another chat's data may have come to that name (a renamed chat replacing the copy made when
 * it was opened, a backup put in): the answer is then dropped, never added to data it was not asked for.
 */
function sameRoom(chatId, r) {
    const rr = room(chatId);
    return rr && rr === r ? rr : null;
}

// ---------- the room ----------
export function active(r = room()) { return !!(conf().enabled && r?.on); }

/** 0.7.0: genre mode in this chat — the System is the story's core (the AI writes its windows, characters react). */
export const genreOn = (r = room()) => !!(r && active(r) && conf(r).genreMode);

/**
 * 0.7.0: in genre mode a quest the System hands out stays hidden (Quests tab, panel, arrival notice) until the
 * reply that brings it into the story is there. It goes with that reply: a swipe, regenerate or delete of the
 * reply hides it again, and the next reply brings it. A reply that left the line out still counts (it opens).
 */
export function veiled(r, q, view = chatView()) {
    if (!q?.veil || !r || !conf(r).genreMode) return false;
    return !(q.toldKeys || []).some(k => view.index.has(k));
}

export function ownerName(r = room()) {
    if (r?.name) return r.name;
    try { return String(ctx().name1 || 'User'); } catch { return 'User'; }
}

export function rate(reward) { return Math.max(1, Math.round(Number(reward || 0) * conf().pointRate)); }

export function points(r = room(), view = chatView()) {
    if (!r) return 0;
    const byId = new Map(r.quests.map(q => [q.id, q]));
    const doneCache = new Map();
    const isDone = (q) => { if (!doneCache.has(q.id)) doneCache.set(q.id, questState(r, q, view).status === 'done'); return doneCache.get(q.id); };
    const counted = [];
    for (const e of r.ledger) {
        if (e.undone || !alive(e.key, view)) continue;
        // a single condition counts only once the whole quest is done
        if (e.cond != null) { const q = byId.get(e.questId); if (!q || !isDone(q)) continue; }
        counted.push(e);
    }
    const pens = penaltyList(r, view);
    if (!pens.length) {
        const earned = counted.reduce((a, e) => a + (Number(e.pts) || 0), 0);
        const spent = r.spend.reduce((a, x) => a + (Number(x.pts) || 0), 0);
        return Math.max(0, earned - spent);
    }
    // with penalties: in time order, and a penalty never takes the points below 0
    const evs = [];
    for (const e of counted) evs.push({ at: Number(e.at) || 0, v: Number(e.pts) || 0 });
    for (const x of r.spend) evs.push({ at: Number(x.at) || 0, v: -(Number(x.pts) || 0) });
    for (const p of pens) evs.push({ at: Number(p.at) || 0, v: -p.pts, pen: true });
    evs.sort((a, b) => a.at - b.at);
    let bal = 0;
    for (const x of evs) bal += x.pen ? -Math.min(-x.v, Math.max(0, bal)) : x.v;
    return Math.max(0, bal);
}

// ---------- difficulty (2-B) ----------
const MUL = { off: 1, easy: 0.8, normal: 1, hard: 1.5, hell: 2 };
const SUDDEN_LIMITS = { off: 3, easy: 5, normal: 3, hard: 2, hell: 1 };
const PENALIZED = ['normal', 'hard', 'hell'];
export const PRICEY = 1.2;

/** The difficulty that applies now in this chat (none during the tutorial). */
export function diffOf(r = room()) {
    if (!r || r.tutorial?.state === 'active') return 'off';
    return DIFFS.includes(r.difficulty) ? r.difficulty : 'off';
}
export const diffAtLeast = (d, min) => DIFFS.indexOf(d) >= DIFFS.indexOf(min);
const withMul = (base, diff) => Math.max(1, Math.round(base * (MUL[diff] || 1)));
export const suddenLimitFor = (r = room()) => SUDDEN_LIMITS[diffOf(r)] || SUDDEN_LIMIT;

/** What failing (or declining) this quest costs: half its reward, from Normal up. Others: 0.
 *  In the threat voice a failure gives a warning instead (warnFor). */
export function penaltyFor(q) {
    if (!q || !['daily', 'sudden'].includes(q.kind) || !PENALIZED.includes(q.diff) || q.tone === 'threat') return 0;
    return Math.max(1, Math.round(rate(q.reward) / 2));
}

/** Threat voice (2-D): failing this quest gives one warning (from Normal up). */
export function warnFor(q) {
    return q && ['daily', 'sudden'].includes(q.kind) && PENALIZED.includes(q.diff) && q.tone === 'threat' ? 1 : 0;
}

/** When (and how) a daily or sudden quest was failed, or null. */
function failInfo(r, q, view) {
    if (q.kind === 'daily') return q.failed && q.failedAt ? { at: q.failedAt, why: 'daily' } : null;
    if (q.kind !== 'sudden') return null;
    const st = questState(r, q, view).status;
    if (st === 'declined') return { at: q.answeredAt || 0, why: 'declined' };
    if (st === 'failed') return { at: q.failAt || q.answeredAt || 0, why: 'timeout' };
    return null;
}

/** Penalties that count now. Worked out again every time, so a re-roll that revives a sudden quest gives its points back. */
export function penaltyList(r = room(), view = chatView()) {
    const out = [];
    if (!r) return out;
    for (const q of r.quests) {
        const pts = penaltyFor(q);
        if (!pts) continue;
        const f = failInfo(r, q, view);
        if (f) out.push({ q, pts, at: f.at, why: f.why });
    }
    return out;
}

// ---------- voice (2-D) ----------
export const toneOf = (r = room()) => (TONES.includes(r?.tone) ? r.tone : 'game');
export const WARN_MAX = 3;

/**
 * Warnings now (threat voice). Worked out again every time from failed quests, erasers and big events:
 * in time order, an eraser takes one off (never below 0) and a big event starts the count again.
 */
export function warnCount(r = room(), view = chatView()) {
    if (!r) return 0;
    const evs = [];
    for (const q of r.quests) {
        if (!warnFor(q)) continue;
        const f = failInfo(r, q, view);
        if (f) evs.push({ at: Number(f.at) || 0, v: 1 });
    }
    if (!evs.length) return 0;
    for (const e of r.erases || []) evs.push({ at: Number(e.at) || 0, v: -1 });
    for (const b of r.bigs || []) evs.push({ at: Number(b.at) || 0, reset: true });
    evs.sort((a, b) => a.at - b.at || (a.reset ? 1 : 0) - (b.reset ? 1 : 0));
    let n = 0;
    for (const e of evs) n = e.reset ? 0 : Math.max(0, n + e.v);
    return n;
}

/** Three warnings: a big event strikes in the story (the AI hears it once) and the count starts again. Cannot be undone. */
export function checkBig(chatId = currentChatId()) {
    const r = room(chatId);
    if (!active(r) || warnCount(r) < WARN_MAX) return null;
    const now = Date.now();
    const big = { id: uid('b'), at: now, day: r.day, cycle: r.cycle?.n || 1 };
    r.bigs.push(big);
    if (r.bigs.length > 50) r.bigs.splice(0, r.bigs.length - 50);
    const who = ownerName(r);
    r.notes.push({ id: uid('n'), text: `The System's warnings have run out: a dangerous event strikes ${who} in the story now — something sudden and threatening that fits the world and the scene, which ${who} must face. Do not decide ${who}'s actions, and do not kill or permanently harm ${who}.`, at: now, deliveredKey: null });
    if (r.notes.length > 10) r.notes.splice(0, r.notes.length - 10);
    save(); changed();
    if (chatId === currentChatId()) bus.emit('bigEvent', big);
    return big;
}

/** Debuffs in effect now: they last for their day, or until their penalty quest is cleared. */
export function debuffsNow(r = room(), view = chatView()) {
    if (!r) return [];
    return (r.debuffs || []).filter(d => {
        if (d.day !== r.day) return false;
        const q = d.questId && r.quests.find(x => x.id === d.questId);
        return !(q && questState(r, q, view).status === 'done');
    });
}

/** A shop price with debuffs. */
export function priceOf(item, r = room()) {
    const p = Number(item?.price) || 0;
    return debuffsNow(r).some(d => d.kind === 'pricey') ? Math.ceil(p * PRICEY) : p;
}

/** Penalty quests of today. */
export function penaltyQuests(r = room()) { return (r?.quests || []).filter(q => q.kind === 'penalty' && q.day === r.day); }

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
    // 0.7.0: a quest still hidden (genre mode, not in the story yet) cannot be cleared yet
    const out = todays(r).filter(q => questState(r, q, view).status === 'active' && !veiled(r, q, view));
    for (const q of penaltyQuests(r)) if (questState(r, q, view).status === 'active' && !veiled(r, q, view)) out.push(q);
    for (const q of r.quests) if ((q.kind === 'sudden' || q.kind === 'hidden') && questState(r, q, view).status === 'active' && !veiled(r, q, view)) out.push(q);
    const g = goalNow(r, view).current;
    if (g && !veiled(r, g, view)) out.push(g);
    return out;
}

export function clearByHand(questId) {
    const r = room();
    const q = r?.quests.find(x => x.id === questId);
    if (!q || questState(r, q).status !== 'active') return;
    const pts = q.kind === 'penalty' ? 0 : rate(q.reward);
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

/** 0.7.2: give up a hidden quest (no penalty): it ends, and a new hidden quest can be found again. */
export function giveUpHidden(questId) {
    const r = room();
    const q = r?.quests.find(x => x.id === questId);
    if (!q || q.kind !== 'hidden' || questState(r, q).status !== 'active') return;
    q.failed = true; q.givenUp = true; q.failAt = Date.now();
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
    q.answeredAt = Date.now();
    q.seen = [];
    save(); changed();
    return accept ? 0 : penaltyFor(q);
}

/**
 * The dice for the newest reply: may a sudden quest come, may a hidden one be found?
 * Rolled once per reply (a re-rolled reply is a new reply). Nothing during the tutorial.
 */
export function rollFor(r, key) {
    if (!r || !key) return { sudden: false, hidden: false };
    if (r.roll?.key === key) return r.roll;
    const s = conf(r);
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
export function setGoal({ title, total, stage }, chatId = currentChatId(), veil = false) {
    const r = room(chatId);
    if (!r) return null;
    // stages of an old goal stay only if they gave points (so points are not lost)
    r.quests = r.quests.filter(q => q.kind !== 'goal' || r.ledger.some(e => e.questId === q.id && !e.undone));
    r.goal = { id: uid('g'), title: String(title || '').slice(0, 80), total: Math.max(2, Math.min(5, Math.round(Number(total) || 4))), done: false };
    addStage(r, 0, stage, veil);
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
        if (stage.reward) cur.reward = withMul(stageReward(stage.reward, cur.stage), cur.diff || 'off');
    }
    save(); changed();
}

const stageReward = (v, i) => Math.min(300, Math.max(100, Math.round(Number(v) || (100 + i * 50))));

function addStage(r, i, stage, veil = false) {
    const conds = (stage?.conds || []).map(c => String(c || '').trim().slice(0, 80)).filter(Boolean).slice(0, 3);
    const diff = diffOf(r);
    const q = {
        id: uid('q'), kind: 'goal', goalId: r.goal.id, stage: i, name: String(stage?.name || '?').slice(0, 80),
        reward: withMul(stageReward(stage?.reward, i), diff), day: r.day, failed: false, diff,
    };
    if (conds.length > 1) q.conds = conds;
    if (veil) q.veil = true;
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
        if (!r.goal.done) { r.goal.done = true; save(); changed(); bus.emit('goalDone', r.goal); rewardSkill(chatId, 'goal', r.goal); }
        return null;
    }
    if (!g.pending) return null;
    const i = g.list.length;
    let made = null;
    try { made = await askFor(chatId, 'stage', { title: r.goal.title, done: g.list.map(q => q.name), index: i, total: r.goal.total }); } catch (e) { console.warn('[System Blink] stage', e); }
    const rr = sameRoom(chatId, r);
    if (!rr?.goal || !made?.name) { changed(); return null; }
    if (goalNow(rr).list.length !== i) return null;
    const q = addStage(rr, i, made, genreOn(rr));
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
    const out = { cleared: [], failed: [], sudden: null, hidden: null, stages: [], unlocked: [] };
    const r = room(chatId);
    if (!r) return out;
    const view = chatView();
    r.checks = r.checks.filter(c => c.key !== key);
    const prev = lifeNow(r, view, key); // what was known before this reply (its own earlier result left out)
    // 0.7.0: a reply checked again (Continue, [check now]) was asked with its own earlier result as "known before",
    // so "-" (no change) keeps what it found; only a new value replaces it
    // (3rd review: only while it still counts — what I set by hand after it is newer, the same rule as lifeNow)
    const was = (r.lifeLog || []).find(x => x.key === key);
    const had = was && was.t > (r.lifeBase?.at || 0) ? was.life || {} : {};
    const got = { ...had };
    for (const [k, v] of Object.entries(res.life || {})) if (v) got[k] = v;
    const life = {}, lifeFrom = {};
    if (r.lifeMode) for (const [k, v] of Object.entries(got)) if (v && v !== prev[k]) { life[k] = v; lifeFrom[k] = prev[k] || ''; }
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
            entry.pts = q.kind === 'penalty' ? 0 : Math.max(0, rate(q.reward) - others);
            out.cleared.push({ q, pts: entry.pts, reason });
            if (q.kind === 'goal') out.stages.push(q);
        }
    }
    if (Object.keys(life).length) {
        r.lifeLog = r.lifeLog.filter(x => x.key !== key);
        r.lifeLog.push({ key, t: check.t, life: { ...life }, lifeFrom: { ...lifeFrom } });
    } else r.lifeLog = r.lifeLog.filter(x => x.key !== key);
    if (out.cleared.some(c => c.q.kind === 'daily')) tutorialStep(r, 1);
    // accepted sudden quests: this reply used one of their replies
    for (const q of r.quests) {
        if (q.kind !== 'sudden' || q.state !== 'accepted' || key === q.acceptKey) continue;
        if (questState(r, q, view).status !== 'active') continue;
        q.seen = [...(q.seen || []).filter(k => k !== key), key];
        if (questState(r, q, view).status === 'failed') { q.failAt = Date.now(); out.failed.push(q); }
    }
    // something new
    // (one per reply: a reply checked again after Continue does not bring a second one)
    if (res.sudden?.name && r.roll?.key === key && r.roll.sudden && !r.quests.some(q => q.kind === 'sudden' && q.fromKey === key)) {
        const diff = diffOf(r);
        const q = { id: uid('q'), kind: 'sudden', name: String(res.sudden.name).slice(0, 80), reward: withMul(Math.min(100, Math.max(30, Math.round(Number(res.sudden.reward) || 50))), diff), day: r.day, failed: false, state: 'offered', limit: SUDDEN_LIMITS[diff] || SUDDEN_LIMIT, seen: [], fromKey: key, diff, tone: toneOf(r) };
        r.quests.push(q);
        r.suddenRest = conf(r).suddenRest;
        out.sudden = q;
    }
    if (res.hidden?.name && r.roll?.key === key && r.roll.hidden && !r.quests.some(q => q.kind === 'hidden' && q.fromKey === key)) {
        const diff = diffOf(r);
        const q = { id: uid('q'), kind: 'hidden', name: String(res.hidden.name).slice(0, 80), reward: withMul(Math.min(200, Math.max(50, Math.round(Number(res.hidden.reward) || 100))), diff), day: r.day, failed: false, why: String(res.hidden.why || '').slice(0, 120), fromKey: key, diff };
        if (genreOn(r)) q.veil = true;
        r.quests.push(q);
        out.hidden = q;
    }
    // 2-C: a low-grade skill shone in the story: its hidden effect opens (tied to this reply)
    for (const { skillId, reason } of res.skills || []) {
        const sk = r.skills.find(k => k.id === skillId);
        if (!sk?.hidden || hiddenOpen(sk, view)) continue;
        sk.hidden.key = key; sk.hidden.reason = String(reason || '').slice(0, 120); sk.hidden.at = Date.now();
        out.unlocked.push(sk);
    }
    storeDay(r, key, res, view);
    trimQuests(r);
    r.checks.push(check);
    if (r.checks.length > KEEP_CHECKS) r.checks.splice(0, r.checks.length - KEEP_CHECKS);
    r.lastCheckKey = key;
    save();
    return out;
}

/**
 * 0.7.0: Continue makes the same reply longer, and SillyTavern gives it a new send time (1.19.1 saveReply), so its
 * key changes. Everything tied to the reply moves to the new key: the points it gave, the quests it brought in,
 * the notes it carried, the dice rolled for it. Its check is marked to run again: what it adds may clear more
 * (what it cleared already stays; one sudden / hidden quest per reply).
 */
export function rekeyReply(from, to, chatId = currentChatId()) {
    const r = room(chatId);
    if (!r || !from || !to || from === to) return false;
    const sw = (k) => (k === from ? to : k);
    const swAll = (list) => (Array.isArray(list) ? [...new Set(list.map(sw))] : list);
    r.lastCheckKey = sw(r.lastCheckKey);
    r.specKey = sw(r.specKey);
    if (r.roll) r.roll.key = sw(r.roll.key);
    for (const c of r.checks || []) if (c.key === from) { c.key = to; c.again = true; }
    for (const list of [r.ledger, r.lifeLog, r.uses, r.cheers]) for (const x of list || []) if (x) x.key = sw(x.key);
    for (const d of r.dayLog || []) { d.key = sw(d.key); d.prev = sw(d.prev); }
    for (const n of r.notes || []) { n.deliveredKey = sw(n.deliveredKey); n.dk = swAll(n.dk); }
    for (const k of r.skills || []) if (k?.hidden) k.hidden.key = sw(k.hidden.key);
    for (const q of r.quests || []) {
        q.fromKey = sw(q.fromKey); q.acceptKey = sw(q.acceptKey);
        if (q.toldKeys) q.toldKeys = swAll(q.toldKeys);
        if (q.seen) q.seen = swAll(q.seen);
    }
    // 0.8.0: regression — what this reply found (a death, a leaked memory, a record line, a fated event's result)
    const c = r.cycle;
    if (c) {
        for (const list of [c.journal, c.deaths, c.leaks]) for (const x of list || []) if (x) x.key = sw(x.key);
        for (const ev of c.events || []) {
            ev.stateKey = sw(ev.stateKey);
            for (const k of ['dueKeys', 'omenKeys', 'newsKeys']) ev[k] = swAll(ev[k] || []);
            for (const x of ev.results || []) x.key = sw(x.key);
        }
        if (c.hide) {
            if (c.hide.key === from) { c.hide.key = to; const tt = keyTime(to); if (Number.isFinite(tt)) c.hide.t = tt; }
            c.hide.keys = swAll(c.hide.keys || []);
        }
    }
    save(); changed();
    return true;
}

/** Sudden quests whose reply was re-rolled before they were answered go away; old finished ones too. */
function trimQuests(r, view = chatView()) {
    r.quests = r.quests.filter(q => !(q.kind === 'sudden' && q.state === 'offered' && q.fromKey && !view.index.has(q.fromKey)));
    // (failed / declined sudden quests that cost points stay: the points are worked out from them)
    const extra = r.quests.filter(q => ['sudden', 'hidden', 'penalty'].includes(q.kind) && q.day < r.day - 7 && !['active', 'offered'].includes(questState(r, q, view).status) && !penaltyFor(q) && !warnFor(q));
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
export function lifeNow(r = room(), view = chatView(), skipKey = null) {
    const out = { ...(r?.lifeBase || {}) };
    if (!r) return out;
    // 0.6.10: from the daily-life log (kept for good), not the last few checks — a place seen long ago stays
    const list = (r.lifeLog || []).filter(c => c.t > (r.lifeBase.at || 0) && c.key !== skipKey && view.index.has(c.key)).sort((a, b) => a.t - b.t);
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

// ---------- 0.7.1: day changes the story check found, kept until I move on ----------
// (was: only the newest check, which went away after 12 checks or with [Later], and came back after a swipe)
// { key: AI reply, prev: the message before it, days, reason, next, t, done: moved on already, off: "this reply did not change the day" }
const DAY_DONE_KEEP = 30;

/** The place of a reply in the chat: the message before it (a swipe or a regenerate keeps it). */
function prevKey(view, key) {
    const i = view.index.get(key);
    return i > 0 ? view.keys[i - 1] || '' : '';
}

function trimDayLog(r) {
    const done = r.dayLog.filter(d => d.done);
    if (done.length <= DAY_DONE_KEEP) return;
    const cut = new Set(done.slice(0, done.length - DAY_DONE_KEEP));
    r.dayLog = r.dayLog.filter(d => !cut.has(d));
}

function storeDay(r, key, res, view) {
    const days = Math.min(30, Math.max(0, Math.round(Number(res.days) || 0)));
    const was = r.dayLog.find(d => d.key === key);
    if (!days) {
        // checked again and no new day: forget it — unless I already moved on from it (its place is remembered)
        if (was && !was.done) r.dayLog = r.dayLog.filter(d => d !== was);
        return;
    }
    const bits = { days, reason: String(res.dayReason || '').slice(0, 120), next: String(res.nextTime || '').slice(0, 40), t: Date.now() };
    if (was) { Object.assign(was, bits); return; } // (Continue, [Check the story now]: same reply, "moved on" / "not a day" stay)
    const prev = prevKey(view, key);
    // the same place as a reply I already moved on from (a swipe, a regenerate, the reply deleted and written again)
    const done = !!prev && r.dayLog.some(d => d.done && d.prev === prev);
    r.dayLog.push({ key, prev, ...bits, done, off: false });
    trimDayLog(r);
}

/** Day changes not moved on from yet, in chat order (replies that are gone, or marked "not a day", left out). */
export function dayChanges(r = room(), view = chatView()) {
    return (r?.dayLog || []).filter(d => !d.done && !d.off && view.index.has(d.key)).sort((a, b) => view.index.get(a.key) - view.index.get(b.key));
}

/** "A day (or more) seems to have passed" — until I move on (or say it was not one); only with story days. */
export function suggestion(r = room(), view = chatView()) {
    if (!active(r) || conf(r).dayBasis !== 'story') return null;
    const list = dayChanges(r, view);
    if (!list.length) return null;
    const last = list[list.length - 1];
    const life = lifeNow(r, view);
    const days = Math.min(30, list.reduce((a, d) => a + d.days, 0));
    // (a quest still waiting for its scene in genre mode is not named)
    const open = todays(r).filter(q => questState(r, q, view).status === 'active' && !veiled(r, q, view));
    return {
        key: last.key, days, reason: last.reason, fromDay: r.day, toDay: r.day + days, fromTime: life.time, nextTime: last.next, open,
        rows: list.map(d => ({ key: d.key, n: view.index.get(d.key), days: d.days, reason: d.reason })),
    };
}

/** ✕ on one reply: it did not change the day (only that one is left out). */
export function dropDayChange(key) {
    const d = room()?.dayLog.find(x => x.key === key);
    if (d) { d.off = true; save(); changed(); }
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
    const now = Date.now();
    const failed = [];
    for (const q of todays(r)) {
        if (questState(r, q, view).status !== 'active') continue;
        q.failed = true;
        // 0.7.0: a quest the story never brought in (genre mode, still hidden) just ends — no penalty for a quest
        // that could not be seen (no failedAt = no points off, no warning)
        if (veiled(r, q, view)) { q.unseen = true; continue; }
        q.failedAt = now; failed.push(q);
    }
    // a penalty quest not done just ends with its day (no more penalty)
    for (const q of penaltyQuests(r)) if (questState(r, q, view).status === 'active') q.failed = true;
    // penalties of the quests' own difficulty: Normal = points, Hard = + a debuff, Hell = + an item lost
    const pen = failed.map(q => ({ q, pts: penaltyFor(q), warn: warnFor(q) })).filter(x => x.pts || x.warn);
    const worst = failed.reduce((a, q) => (DIFFS.indexOf(q.diff) > DIFFS.indexOf(a) ? q.diff : a), 'off');
    for (const c of r.checks) c.dismissed = true;
    // 0.7.1: every day change so far is moved on from (asked once: a swipe of that reply does not ask again)
    for (const d of r.dayLog) d.done = true;
    trimDayLog(r);
    r.day += days;
    let debuff = null, lost = null;
    if (diffAtLeast(worst, 'hard')) {
        debuff = { id: uid('x'), kind: 'pricey', day: r.day, questId: null, at: now };
        r.debuffs.push(debuff);
        if (r.debuffs.length > 30) r.debuffs.splice(0, r.debuffs.length - 30);
    }
    if (worst === 'hell') lost = loseItem(r);
    const life = lifeNow(r, view);
    r.lifeBase = { ...life, time: nextTime || '', at: now };
    addNote(r, days === 1 ? 'One day has passed in the story. It is now a new day.' : `${days} days have passed in the story.`,
        { kind: 'DAY', text: t('qb_day_line', { n: r.day }) });
    if (lost) addNote(r, `As a penalty, the System took "${lost.name}" from ${ownerName(r)}'s bag. It is gone.`);
    r.shop.daily = []; r.shop.dailyDay = 0;
    // 0.8.0: the day that ended: its record lines (one per reply so far) are put down to a few with the quest request
    const logList = dayCandidates(r, r.day - 1, view);
    save(); changed();
    bus.emit('dayMoved', { days, failed, pen, debuff, lost, chatId });
    if (pen.some(x => x.warn)) checkBig(chatId);
    await newQuests(chatId, { penalty: !!debuff, log: logList.length ? { list: logList, day: r.day - days } : null });
}

/** Hell: one random thing leaves the bag (not a gacha ticket). */
function loseItem(r) {
    const list = r.bag.filter(b => b.count > 0 && b.kind !== 'gacha');
    if (!list.length) return null;
    const rnd = typeof globalThis.__sblinkRandom === 'function' ? globalThis.__sblinkRandom : Math.random;
    const b = list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
    b.count -= 1;
    if (b.count <= 0) r.bag = r.bag.filter(x => x !== b);
    const lost = { id: uid('o'), name: b.name, icon: b.icon, rarity: b.rarity, at: Date.now(), day: r.day };
    r.lost.push(lost);
    if (r.lost.length > 60) r.lost.splice(0, r.lost.length - 60);
    return lost;
}

/** Today's daily quests (2–3). AI first, the built-in list if that fails. */
export async function newQuests(chatId = currentChatId(), { replaceOpen = false, penalty = false, log = null } = {}) {
    const r = room(chatId);
    if (!active(r)) return;
    const view = chatView();
    const keep = replaceOpen ? todays(r).filter(q => questState(r, q, view).status !== 'active') : todays(r);
    if (!replaceOpen && keep.length) return;
    const want = replaceOpen ? Math.max(1, todays(r).length - keep.length) : 3;
    // keep only daily quests of today that stay; other kinds are not touched
    if (replaceOpen) r.quests = r.quests.filter(q => q.kind !== 'daily' || q.day !== r.day || keep.includes(q));
    const diff = diffOf(r);
    const tone = toneOf(r);
    const veil = genreOn(r);
    let made = null;
    try { made = await askFor(chatId, 'quests', { count: want, avoid: keep.map(q => q.name), diff, penalty, tone, log: log?.list.map(j => j.text) || null }); } catch (e) { console.warn('[System Blink] quests', e); }
    const rr = sameRoom(chatId, r);
    if (!rr) return;
    if (log && Array.isArray(made?.log)) applyLog(rr, log.list, made.log, log.day);
    const aiList = Array.isArray(made) ? made : made?.quests;
    let list = Array.isArray(aiList) && aiList.length ? aiList : fallbackQuests(want, keep.map(q => q.name), diff, rr);
    list = list.slice(0, want).map(q => {
        const o = { id: uid('q'), kind: 'daily', name: String(q.name).slice(0, 80), reward: withMul(Math.min(30, Math.max(10, Math.round(Number(q.reward) || 10))), diff), day: rr.day, failed: false, diff, tone };
        if (veil) o.veil = true;
        const conds = cleanConds(q.conds, diff);
        if (conds) o.conds = conds;
        return o;
    });
    rr.quests.push(...list);
    if (penalty) {
        const name = made?.penalty?.name || shuffle(penaltyPool(langOf()))[0].name;
        const pq = { id: uid('q'), kind: 'penalty', name: String(name).slice(0, 80), reward: 0, day: rr.day, failed: false };
        if (veil) pq.veil = true;
        rr.quests.push(pq);
        const d = [...rr.debuffs].reverse().find(x => x.day === rr.day && !x.questId);
        if (d) d.questId = pq.id;
        list.push(pq);
    }
    // keep the list short: drop quests of old days beyond the last few
    const minDay = rr.day - 7;
    // (failed ones that cost points or gave a warning stay: points and warnings are worked out from them)
    rr.quests = rr.quests.filter(q => q.kind !== 'daily' || q.day >= minDay || (q.failed && (penaltyFor(q) || warnFor(q))) || rr.ledger.some(e => e.questId === q.id));
    save(); changed();
    if (list.length && chatId === currentChatId()) bus.emit('questsArrived', list);
}

/** Conditions as the difficulty wants them: Hard 2, Hell 2–3, else none. */
function cleanConds(conds, diff) {
    if (!diffAtLeast(diff, 'hard') || !Array.isArray(conds)) return undefined;
    const list = conds.map(c => String(c || '').trim().slice(0, 80)).filter(Boolean).slice(0, diff === 'hell' ? 3 : 2);
    return list.length > 1 ? list : undefined;
}

/** The built-in list. Hard and Hell join two or three of them into one quest with conditions. */
export function fallbackQuests(n, avoid = [], diff = 'off', r = room()) {
    const s = conf(r);
    const pool = shuffle(questPool(langOf(), s.oddities).filter(q => !avoid.includes(q.name)));
    if (!diffAtLeast(diff, 'hard')) return pool.slice(0, n);
    const out = [];
    let i = 0;
    for (let j = 0; j < n; j++) {
        const k = diff === 'hell' && Math.random() < 0.5 ? 3 : 2;
        const parts = pool.slice(i, i + k);
        i += k;
        if (parts.length < 2) break;
        out.push({ name: parts.map(p => p.name).join(' + '), conds: parts.map(p => p.name), reward: Math.min(30, parts.reduce((a, p) => a + p.reward, 0)) });
    }
    return out;
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
    if (!active(r) || conf(r).dayBasis !== 'real') return;
    const today = realDateNow();
    if (!r.realDate) { r.realDate = today; save(); return; }
    if (r.realDate === today) return;
    r.realDate = today;
    await nextDay(1);
}

// ---------- shop ----------
export function standingItems(r = room()) {
    const s = conf(r);
    const list = [];
    if (s.useDefaults) list.push(...standingDefaults(langOf()));
    list.push(...parseCustomShop(s.customShop));
    list.push(...(r?.shop.standing || []));
    // threat voice: the black market always has a warning eraser
    if (toneOf(r) === 'threat') list.unshift(eraserItem(langOf()));
    return list;
}

export function dailyReady(r = room()) { return !!r && r.shop.dailyDay === r.day && r.shop.daily.length > 0; }

export async function stockDaily(chatId = currentChatId(), force = false) {
    const r = room(chatId);
    if (!active(r) || (!force && dailyReady(r))) return;
    let made = null;
    const book = wantBook();
    const count = 4 + Math.floor(Math.random() * 3) - (book ? 1 : 0);
    try { made = await askFor(chatId, 'shop', { count, kind: 'daily', book }); } catch (e) { console.warn('[System Blink] shop', e); }
    const rr = sameRoom(chatId, r);
    if (!rr) return;
    const aiItems = Array.isArray(made) ? made : made?.items;
    const list = Array.isArray(aiItems) && aiItems.length ? aiItems : fallbackDaily(rr);
    rr.shop.daily = list.slice(0, book ? 5 : 6).map(x => ({ ...cleanItem(x), id: uid('d'), sold: false }));
    // a skill book sits in the daily shop now and then (the AI's, or one from the built-in list)
    if (book) {
        const have = new Set(skillsOf(rr).map(k => k.name));
        const sk = made?.book?.name && !have.has(made.book.name) ? made.book : fallbackSkill(rr);
        rr.shop.daily.push(bookItem(sk, book));
    }
    rr.shop.dailyDay = rr.day;
    save(); changed();
}

/** 0.6.6: a new AI set for the standing shop costs a few points (paid only when it comes). */
export const RESTOCK_COST = 10;

/** Returns true (restocked), 'short' (not enough points, nothing asked) or false (the AI failed: the old set stays). */
export async function restockStanding(chatId = currentChatId()) {
    const r = room(chatId);
    if (!active(r)) return false;
    if (points(r) < RESTOCK_COST) return 'short';
    let made = null;
    try { made = await askFor(chatId, 'shop', { count: 4, kind: 'standing' }); } catch (e) { console.warn('[System Blink] shop', e); }
    const rr = sameRoom(chatId, r);
    if (!rr) return false;
    const list = (Array.isArray(made) ? made : []).slice(0, 6);
    if (!list.length) return false; // keep what is on the shelf
    rr.shop.standing = list.map(x => ({ ...cleanItem(x), id: uid('s') }));
    rr.spend.push({ id: uid('p'), what: '', kind: 'restock', pts: RESTOCK_COST, at: Date.now() });
    save(); changed();
    return true;
}

function fallbackDaily(r = room()) {
    const s = conf(r);
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
    const price = priceOf(item, r);
    if (points(r) < price) return false;
    if (where === 'daily') {
        const d = r.shop.daily.find(x => x.id === item.id);
        if (!d || d.sold) return false;
        d.sold = true;
    }
    r.spend.push({ id: uid('p'), what: item.name, pts: price, at: Date.now() });
    if (item.kind === 'skillbook') {
        // a skill book is learned at once: the skill goes to the Status tab, not the bag
        const sk = addSkill(r, cleanSkill(item.skill, item.grade, 'book'));
        tutorialStep(r, 2);
        save(); changed();
        bus.emit('skillGained', { skill: sk, from: 'book' });
        return true;
    }
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
    // a warning eraser with no warnings would be wasted
    if (b.kind === 'eraser' && warnCount(r) < 1) return { blocked: 'no_warn' };
    b.count -= 1;
    if (b.count <= 0) r.bag = r.bag.filter(x => x !== b);
    const use = { id: uid('u'), name: b.name, desc: b.desc, rarity: b.rarity, icon: b.icon, kind: b.kind, at: Date.now(), key: null };
    r.uses.push(use);
    if (b.kind === 'eraser') r.erases.push({ id: uid('e'), at: use.at });
    // every use is kept; older ones drop their description to stay small
    if (r.uses.length > 40) for (const u of r.uses.slice(0, r.uses.length - 40)) delete u.desc;
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

// ---------- 0.6.0 quest lines in the story ----------
export const STORY_KIND = { daily: 'DAILY', sudden: 'SUDDEN', hidden: 'HIDDEN', goal: 'MAIN', penalty: 'PENALTY' };

/** Quests running now that the story has not shown yet (a re-rolled reply shows them again). */
export function questsToTell(r = room(), view = chatView(), redoKey = null) {
    if (!r || !(conf(r).storyQuest || conf(r).genreMode)) return [];
    const list = [];
    const g = r.goal ? goalNow(r, view) : null;
    if (g?.current) list.push(g.current);
    for (const q of todays(r)) if (q.kind === 'daily' && questState(r, q, view).status === 'active') list.push(q);
    for (const q of r.quests) {
        if (q.kind === 'penalty' && q.day === r.day && questState(r, q, view).status === 'active') list.push(q);
        if ((q.kind === 'sudden' || q.kind === 'hidden') && questState(r, q, view).status === 'active') list.push(q);
    }
    // redoKey: the reply being swiped is replaced, so what it showed is shown again
    // each swipe that showed it is kept, so going back to an older swipe does not show it twice
    // a quest waiting for its scene is told even if marked "old" (0.7.0 first build marked them so when genre mode
    // was switched off and on again — they would have stayed hidden)
    return list.filter(q => (q.told !== 'old' || veiled(r, q, view)) && !(q.toldKeys || []).some(k => k !== redoKey && view.index.has(k)));
}

/**
 * These quest lines went out with this AI reply. Returns the quests this reply brought out of hiding (genre mode).
 * 0.7.0: up to 20 replies kept per quest (was 6: swiping 7 times and going back showed a line twice).
 */
export function markTold(key, ids) {
    const r = room();
    if (!r || !key || !ids?.length) return [];
    const view = chatView();
    const was = new Set(r.quests.filter(q => ids.includes(q.id) && veiled(r, q, view)).map(q => q.id));
    for (const q of r.quests) if (ids.includes(q.id)) q.toldKeys = [...(q.toldKeys || []).filter(k => k !== key), key].slice(-20);
    save();
    return r.quests.filter(q => was.has(q.id) && !veiled(r, q, view));
}

/** Turning the setting on: quests already running are not shown all at once in the next reply. */
export function skipOldTold(chatId = null) {
    // 0.6.8: shared switch → the chats that follow the shared settings; a chat's own switch → that chat
    const all = settings().chats || {};
    const list = chatId ? [all[chatId]] : Object.values(all).filter(r => !r?.own);
    for (const r of list) {
        if (!r?.quests) continue;
        markOld(r);
    }
    save();
}

/**
 * Quests already running are not all put in the next reply. 0.7.0: a quest still waiting for its scene (genre mode,
 * never shown) is not "old" — it has to come in the story, or it would stay hidden for good.
 */
function markOld(r) {
    const genre = !!conf(r).genreMode;
    for (const q of r.quests) if (!q.toldKeys?.length && !(genre && q.veil)) q.told = 'old';
}

/** Notes went out with this AI reply (each reply kept, like the quest lines: a swipe sends them again). */
export function markDelivered(key, sentIds) {
    const r = room();
    if (!r || !key || !sentIds?.length) return;
    for (const n of r.notes) {
        if (!sentIds.includes(n.id)) continue;
        // a note from before 0.7.0 has only deliveredKey: keep that reply too (going back to it must not resend)
        const had = n.dk || (n.deliveredKey ? [n.deliveredKey] : []);
        n.dk = [...had.filter(k => k !== key), key].slice(-20);
        n.deliveredKey = key;
    }
    save();
}

/** A note waits to go out: none of the replies it went with is there (the one being replaced does not count). */
export function noteDue(n, view = chatView(), redoKey = null) {
    const keys = n.dk?.length ? n.dk : n.deliveredKey ? [n.deliveredKey] : [];
    return !keys.some(k => k !== redoKey && view.index.has(k));
}

/**
 * A one-time note for the next story reply. `win` (0.7.0, genre mode): the exact System window line
 * ({ kind: AWAKEN | TUTORIAL | DAY, text }) and the genre wording `gtext` used instead of `text`.
 */
export function addNote(r, text, win = null, gtext = '') {
    const n = { id: uid('n'), text, at: Date.now(), deliveredKey: null };
    if (win) n.line = `[SYS:NOTICE] ${win.kind} · ${String(win.text).replace(/[\r\n]+/g, ' ')}`;
    if (gtext) n.gtext = gtext;
    r.notes.push(n);
    if (r.notes.length > 10) r.notes.splice(0, r.notes.length - 10);
    return n;
}

/**
 * 0.7.0: genre mode as this chat's story lines see it. Switched on: quests already running are not all shown at
 * once. Switched off: for a while the AI is told firmly not to copy the System windows of earlier replies.
 */
export function genreSync(r, view = chatView()) {
    if (!r) return;
    const now = conf(r).genreMode ? 'on' : 'off';
    if (r.genreWas === now) return;
    if (r.genreWas === 'off' && now === 'on') {
        if (!conf(r).storyQuest) markOld(r);
        r.genreOffAt = -1;
    }
    if (r.genreWas === 'on' && now === 'off') r.genreOffAt = view.length;
    r.genreWas = now;
    save();
}
/** Replies since genre mode was switched off are still few: the "no System windows" line is firm. */
export const genreJustOff = (r, view = chatView()) => !!r && !conf(r).genreMode && r.genreOffAt >= 0 && view.length - r.genreOffAt < 12;

// ---------- tutorial ----------
export function tutorialStep(r, n) {
    const t = r?.tutorial;
    if (!t || t.state !== 'active' || t.done[n]) return;
    for (let i = 0; i < n; i++) if (!t.done[i]) return; // in order
    t.done[n] = true;
    // 0.7.2: a later step already done before its turn counts now (e.g. a daily quest cleared before the window
    // was ever opened — the tutorial used to wait for a second clear that never came)
    let i = n + 1;
    while (i < t.done.length && !t.done[i] && stepMet(r, i)) { t.done[i] = true; i += 1; }
    if (t.done.every(Boolean)) finishTutorial(r);
    else { tutorialBoost(r); tutorialNote(r); bus.emit('tutorialStep', n); }
}

/** Has this tutorial step been done already (out of turn)? 1 = a daily quest cleared, 2 = bought something, 3 = used something. */
function stepMet(r, i) {
    const view = chatView();
    if (i === 1) return todays(r).some(q => questState(r, q, view).status === 'done');
    if (i === 2) return r.spend.some(x => x.kind !== 'restock') || (r.skills || []).some(k => k.from === 'book');
    if (i === 3) return r.uses.length > 0 || (r.draws || []).length > 0;
    return false;
}

/**
 * 0.7.2: the "buy something" step with too few points for anything in the standing shop (a first quest of 10P,
 * Easy's ×0.8): the System gives the difference, once per chat.
 */
function tutorialBoost(r) {
    const t = r.tutorial;
    if (t.boosted || t.done.findIndex(x => !x) !== 2) return;
    const prices = standingItems(r).map(x => priceOf(x, r)).filter(n => Number.isFinite(n) && n > 0);
    const need = prices.length ? Math.min(...prices) : 20;
    const have = points(r);
    if (have >= need) return;
    t.boosted = true;
    const pts = need - have;
    r.ledger.push({ id: uid('l'), questId: 'tutorial-boost', cond: null, pts, key: null, reason: '', at: Date.now() });
    bus.emit('tutorialBoost', pts);
}

/** 0.7.0 genre mode: the tutorial's next step comes as a System window in the next reply. */
function tutorialNote(r) {
    if (!genreOn(r) || r.tutorial?.state !== 'active') return;
    const i = r.tutorial.done.findIndex(x => !x);
    if (i < 0) return;
    r.notes = r.notes.filter(n => !n.tut); // only the step now
    const step = t(`tut_${i}`);
    const n = addNote(r, '', { kind: 'TUTORIAL', text: `${i + 1}/4 · ${step}` },
        `The System's tutorial goes on: ${ownerName(r)}'s next step is "${step}". Show the System telling ${ownerName(r)} so.`);
    n.tut = true;
}

/** The tutorial is over (skipped or done): its step windows are not sent any more, not even to a re-rolled reply. */
function dropTutorialNotes(r) {
    if (r?.notes?.some(n => n.tut)) r.notes = r.notes.filter(n => !n.tut);
}

function finishTutorial(r) {
    const t = r.tutorial;
    t.state = 'done';
    dropTutorialNotes(r);
    if (t.rewarded) return;
    t.rewarded = true;
    r.ledger.push({ id: uid('l'), questId: 'tutorial', cond: null, pts: TUTORIAL_REWARD, key: null, reason: '', at: Date.now() });
    const ko = langOf() === 'ko';
    r.bag.push({ id: uid('i'), name: ko ? '뽑기권' : 'Gacha Ticket', desc: ko ? '한 번 뽑는다. 스킬이나 물건이 나온다. 엉뚱한 게 자주 나온다.' : 'One draw: a skill or an item. Often something odd.', rarity: 'rare', icon: 'ticket', kind: 'gacha', count: 1 });
    const title = ko ? '튜토리얼 수료자' : 'Tutorial Graduate';
    if (!r.titles.includes(title)) r.titles.push(title);
    if (!r.title) r.title = title;
    bus.emit('tutorialDone');
    goalSoon();
}

export function skipTutorial() {
    const r = room();
    if (!r) return;
    r.tutorial.state = 'skipped';
    dropTutorialNotes(r);
    save(); changed();
    goalSoon();
}

/**
 * Switch the system on in this chat (first time: the awakening and day 1).
 * `tut` (0.6.4, a new chat that woke by itself, already asked): 'start' | 'skip' — no awakening popup.
 */
export async function switchOn(tut = '') {
    const chatId = currentChatId();
    const r = room(chatId, true);
    if (!r) return;
    const first = r.tutorial.state === 'none' && !r.quests.length;
    r.on = true;
    // 0.6.2: waking a chat once = new chats with this character wake too (unless that was switched off for it)
    const ck = charKey();
    if (ck && settings().autoWake[ck] === undefined) settings().autoWake[ck] = true;
    if (!r.realDate) r.realDate = realDateNow();
    save(); changed();
    if (first) {
        bus.emit('woke', { chatId }); // 0.6.5: the first-time guide comes before anything else
        if (tut) r.tutorial.state = tut === 'start' ? 'active' : 'skipped';
        else if (settings().tutorialAuto) { r.tutorial.state = 'active'; bus.emit('awaken'); }
        else r.tutorial.state = 'skipped';
        awakenNote(r);
        save();
        await newQuests(chatId);
        goalSoon(chatId);
    }
}

/**
 * 0.7.0: the System has just appeared — the next reply shows the moment it is first noticed (in a quiet chat
 * without System windows; in genre mode as the awakening window, with the tutorial's first step).
 */
function awakenNote(r) {
    const who = ownerName(r);
    addNote(r, `The System has just appeared to ${who} for the first time. Show it reaching ${who} — by name, never "someone" — with a short first sign (a sound, words at the edge of ${who}'s sight). Keep it short: it is only the first glimpse. ${who}'s own reaction follows your usual rules for ${who} (if you do not write ${who}'s actions, leave it to ${who}).`,
        { kind: 'AWAKEN', text: t('pop_awaken').replace(/^\[|\]$/g, '') },
        `The System has just awakened for ${who}: this is the first time ${who} sees it. Make it a real moment in the story.`);
    tutorialNote(r);
}

export function switchOff() {
    const r = room();
    if (!r) return;
    r.on = false;
    save(); changed();
}

// ---------- 0.6.2: the main goal comes by itself, and new chats wake by themselves ----------
let givingGoal = '';
const goalFailed = new Set(); // chats where making the goal failed (this session): no more tries until [Try again]
export const isGivingGoal = (chatId = currentChatId()) => !!chatId && givingGoal === chatId;
export const goalGiveFailed = (chatId = currentChatId()) => goalFailed.has(chatId);
/** The goal is locked while the tutorial runs (only when there is no goal yet). */
export const goalLocked = (r = room()) => !r?.goal && r?.tutorial?.state === 'active';

function goalWanted(r, force) {
    if (!active(r) || r.goal || r.tutorial?.state === 'active' || r.tutorial?.state === 'none') return false;
    if (force) return true;
    return !!conf(r).goalAuto && !r.goalAuto;
}

function goalSoon(chatId = currentChatId()) { setTimeout(() => { giveGoal(chatId).catch(e => console.warn('[System Blink] goal', e)); }, 0); }

/** The System sets the main goal by itself: once per chat (when there is none), after the tutorial or when the chat is entered. */
export async function giveGoal(chatId = currentChatId(), force = false) {
    const r = room(chatId);
    if (!r) return null;
    if (r.goal && !r.goalAuto) { r.goalAuto = true; save(); }
    if (givingGoal || (!force && goalFailed.has(chatId)) || !goalWanted(r, force)) return null;
    if (chatId !== currentChatId()) return null; // the AI reads the open chat
    givingGoal = chatId; goalFailed.delete(chatId); changed();
    let made = null;
    try { made = await askFor(chatId, 'goal', {}); } catch (e) { console.warn('[System Blink] goal', e); }
    givingGoal = '';
    const rr = sameRoom(chatId, r);
    if (!rr || rr.goal || !active(rr) || currentChatId() !== chatId) { changed(); return null; }
    if (!made?.title || !made?.stage?.name) {
        goalFailed.add(chatId); changed();
        bus.emit('goalFailed');
        return null;
    }
    const total = [3, 4, 5].includes(Math.round(made.total)) ? Math.round(made.total) : 4;
    const g = setGoal({ title: made.title, total, stage: made.stage }, chatId, genreOn(rr));
    rr.goalAuto = true; save(); changed();
    bus.emit('goalGiven', { goal: g, stage: goalNow(rr).current });
    return g;
}

/** Who this chat is with: a character (by its card file) or a group. */
export function charKey() { return ownerKey(); }

/**
 * A brand-new chat (nothing saved for it, at most the greeting) with a character whose chats were woken before:
 * may it wake? (0.6.4: only asks — nothing is made and no AI is called until the answer.) Old chats are left alone.
 */
export function wantsWake() {
    const s = conf();
    const chatId = currentChatId();
    if (!s.enabled || !chatId || s.chats[chatId]) return false;
    const ck = charKey();
    if (!ck || s.autoWake[ck] !== true) return false;
    let n = 0;
    try { n = (ctx().chat || []).filter(m => m && !m.is_system).length; } catch { return false; }
    return n <= 1;
}

/** "Don't wake this chat": it stays asleep and is not asked again (the wand can still wake it). */
export function declineWake(chatId = currentChatId()) {
    const r = room(chatId, true);
    if (!r) return;
    r.on = false;
    save(); changed();
}

// ---------- skills (stage 2-C) ----------
// Skills have nothing to do with difficulty. A grade is rolled here, never by the AI;
// the AI only writes the name and effect for the grade it is given.
const rnd = () => (typeof globalThis.__sblinkRandom === 'function' ? globalThis.__sblinkRandom() : Math.random());

const ODDS = {
    gacha: { F: 28, E: 24, D: 18, C: 13, B: 8, A: 5, S: 3.5, SS: 0.5 },
    book: { F: 22, E: 24, D: 20, C: 15, B: 11, A: 6, S: 2 },
    goal: { C: 35, B: 30, A: 22, S: 11, SS: 2 },
    hidden: { F: 20, E: 20, D: 25, C: 20, B: 10, A: 5 },
    spectator: { F: 35, E: 30, D: 22, C: 13 },
};
export const GACHA_SKILL_SHARE = 0.4;      // a draw is a skill 40% of the time, an item otherwise
const ITEM_ODDS = { common: 45, rare: 35, epic: 16, legendary: 4 };
const HIDDEN_QUEST_SKILL = 0.3;            // clearing a hidden quest gives a skill now and then
const BOOK_ODDS = 0.5;                     // about every other daily shop has a skill book

function pick(table, r = rnd()) {
    const list = Object.entries(table);
    const all = list.reduce((a, [, w]) => a + w, 0);
    let x = r * all;
    for (const [k, w] of list) { if ((x -= w) < 0) return k; }
    return list[list.length - 1][0];
}
export const rollGrade = (from = 'gacha') => pick(ODDS[from] || ODDS.gacha);

/** Skill grade → the shop's rarity band (for a skill book's colour and price). */
export const gradeRarity = (g) => ({ F: 'common', E: 'common', D: 'rare', C: 'rare', B: 'epic', A: 'epic', S: 'legendary', SS: 'legendary' })[g] || 'common';
const BOOK_PRICE = { F: 40, E: 70, D: 110, C: 170, B: 320, A: 450, S: 900, SS: 1500 };

/** A skill as stored, from whatever the AI (or the built-in list) gave. */
export function cleanSkill(x, grade, from) {
    const g = GRADES.includes(grade) ? grade : 'F';
    const hidden = LOW_GRADES.includes(g) && String(x?.hidden || '').trim() ? { effect: String(x.hidden).trim().slice(0, 160), key: null, reason: '', at: 0 } : null;
    return {
        id: uid('k'), name: String(x?.name || '?').replace(/^[[「]|[\]」]$/g, '').trim().slice(0, 40) || '?', grade: g,
        type: x?.type === 'active' ? 'active' : 'passive', effect: String(x?.effect || '').trim().slice(0, 160),
        hidden, from: from || 'gacha', mode: 'life', day: 0, at: 0, uses: 0, fresh: true,
    };
}

export function skillsOf(r = room()) { return r?.skills || []; }

/** A hidden effect counts as open while the AI reply that opened it is still there. */
export const hiddenOpen = (sk, view = chatView()) => !!(sk?.hidden?.key && view.index.has(sk.hidden.key));

/** Low-grade skills with a hidden effect still shut: the story check looks for them (oldest first, at most 3). */
export function lockedSkills(r = room(), view = chatView()) {
    return skillsOf(r).filter(k => k.hidden && !hiddenOpen(k, view)).slice(0, 3);
}

function fallbackSkill(r) {
    const have = new Set(skillsOf(r).map(k => k.name));
    const pool = skillPool(langOf(), conf(r).oddities);
    return shuffle(pool).find(x => !have.has(x.name)) || pool[0];
}

/** Make one skill of `grade` (AI, the built-in list if that fails) and add it. */
async function makeSkill(chatId, grade, from) {
    const r = room(chatId);
    if (!r) return null;
    let made = null;
    try { made = await askFor(chatId, 'skill', { grade, from, avoid: skillsOf(r).map(k => k.name) }); } catch (e) { console.warn('[System Blink] skill', e); }
    const rr = sameRoom(chatId, r);
    if (!rr) return null;
    const sk = cleanSkill(made?.name ? made : fallbackSkill(rr), grade, from);
    return addSkill(rr, sk);
}

function addSkill(r, sk) {
    sk.day = r.day; sk.at = Date.now();
    // the same name again: a second copy is told apart, never merged (its grade may differ)
    if (r.skills.some(k => k.name === sk.name)) sk.name = `${sk.name} II`.slice(0, 40);
    r.skills.push(sk);
    save();
    return sk;
}

/** The skill was looked at: no more NEW. */
export function seeSkill(id) {
    const sk = skillsOf().find(k => k.id === id);
    if (sk?.fresh) { sk.fresh = false; save(); }
}

let drawing = false;
export const isDrawing = () => drawing;

/** Open a gacha ticket: a skill (40%) or an item. The ticket is used up first; a failed AI answer falls back to the built-in lists. */
export async function openGacha(bagId) {
    const chatId = currentChatId();
    const r = room(chatId);
    const b = r?.bag.find(x => x.id === bagId && x.kind === 'gacha');
    if (drawing || !active(r) || !b || b.count < 1) return null;
    drawing = true;
    try {
        b.count -= 1;
        if (b.count <= 0) r.bag = r.bag.filter(x => x !== b);
        tutorialStep(r, 3);
        save(); changed();
        let out;
        if (rnd() < GACHA_SKILL_SHARE) {
            const sk = await makeSkill(chatId, rollGrade('gacha'), 'gacha');
            out = sk && { kind: 'skill', skill: sk };
        } else {
            const rarity = pick(ITEM_ODDS);
            let made = null;
            try { made = await askFor(chatId, 'drawItem', { rarity }); } catch (e) { console.warn('[System Blink] draw', e); }
            const rr = sameRoom(chatId, r);
            if (!rr) return null;
            const base = made?.name ? made : fallbackDrawItem(rarity);
            const it = { ...cleanItem({ ...base, rarity }), odd: true };
            const same = rr.bag.find(x => x.name === it.name && x.kind === 'item' && x.rarity === it.rarity);
            if (same) same.count += 1;
            else rr.bag.push({ id: uid('i'), name: it.name, desc: it.desc, rarity: it.rarity, icon: it.icon, kind: 'item', count: 1 });
            out = { kind: 'item', item: it };
        }
        const rr = sameRoom(chatId, r);
        if (out && rr) {
            rr.draws.push({ id: uid('w'), at: Date.now(), kind: out.kind, grade: out.skill?.grade || out.item?.rarity, name: out.skill?.name || out.item?.name });
            if (rr.draws.length > 100) rr.draws.splice(0, rr.draws.length - 100);
        }
        save(); changed();
        return out;
    } finally { drawing = false; }
}

function fallbackDrawItem(rarity) {
    const lang = langOf();
    const pool = [...gachaOddPool(lang), ...dailyPool(lang)];
    const same = pool.filter(x => x.rarity === rarity);
    return shuffle(same.length ? same : pool)[0];
}

/** Use an active skill: no limit, no cooldown. The AI hears about it with my next message (and its re-rolls). */
export function useSkill(id) {
    const r = room();
    const sk = skillsOf(r).find(k => k.id === id);
    if (!active(r) || !sk || sk.type !== 'active') return null;
    sk.uses = (Number(sk.uses) || 0) + 1;
    sk.fresh = false;
    const use = { id: uid('u'), kind: 'skill', skillId: sk.id, name: sk.name, grade: sk.grade, desc: sk.effect, icon: 'star', at: Date.now(), key: null };
    r.uses.push(use);
    if (r.uses.length > 40) for (const u of r.uses.slice(0, r.uses.length - 40)) delete u.desc;
    save(); changed();
    return use;
}

/** A skill as a quest reward (main goal reached / sometimes a hidden quest). Given once per goal or quest. */
export async function rewardSkill(chatId, from, owner) {
    const r = room(chatId);
    if (!active(r) || !owner || owner.skillGiven) return null;
    owner.skillGiven = true;
    if (from === 'hidden' && rnd() >= HIDDEN_QUEST_SKILL) { save(); return null; }
    save();
    const sk = await makeSkill(chatId, rollGrade(from), from);
    changed();
    if (sk && chatId === currentChatId()) bus.emit('skillGained', { skill: sk, from });
    return sk;
}

/** A daily shop's skill book (about every other day): the grade is rolled here. */
export function wantBook() { return rnd() < BOOK_ODDS ? rollGrade('book') : null; }

export function bookItem(skill, grade) {
    const ko = langOf() === 'ko';
    const sk = cleanSkill(skill, grade, 'book');
    return {
        id: uid('d'), name: `${ko ? '스킬북' : 'Skill Book'}: ${sk.name}`.slice(0, 60), desc: sk.effect, rarity: gradeRarity(grade), price: BOOK_PRICE[grade] || 100,
        icon: 'book', kind: 'skillbook', limited: false, odd: false, sold: false, skill: { name: sk.name, type: sk.type, effect: sk.effect, hidden: sk.hidden?.effect || '' }, grade,
    };
}

// ---------- spectators (2-D) ----------
// Unseen watchers react now and then with a small notice. At most one reaction per AI reply.
// A sponsorship is tied to that reply (a re-roll takes it back), like a quest clear.
const SPEC_ODDS = { reply: 1 / 6, clear: 1 / 2, fail: 1 / 2 };
const SPEC_TIP = { game: 1 / 5, star: 1 / 3, threat: 1 / 5 };   // the sponsor voice is sponsored more often
const SPEC_GIFT = 1 / 40;                                       // a skill as a gift: very rare (F–C)
const specRnd = () => (typeof globalThis.__sblinkSpecRandom === 'function' ? globalThis.__sblinkSpecRandom() : Math.random());

let reacting = false;

/** Maybe a spectator reacts. `ev` = reply | clear | fail. Returns the reaction (to show) or null. */
export async function spectate(chatId, key, ev = 'reply') {
    const s = conf(chatId);
    const r = room(chatId);
    if (!s.specOn || !active(r) || r.tutorial?.state === 'active' || reacting) return null;
    if (key) {
        if (r.specKey === key) return null;
        r.specKey = key;
        save();
    }
    if (specRnd() >= (SPEC_ODDS[ev] || 0)) return null;
    const tone = toneOf(r);
    const tip = !!(s.specGift && key && ev !== 'fail' && specRnd() < (SPEC_TIP[tone] || 0.2));
    const gift = !!(s.specGift && ev !== 'fail' && specRnd() < SPEC_GIFT);
    reacting = true;
    try {
        let made = null;
        // a sponsorship has its own fixed line: no AI call for it
        if (s.specMode === 'rich' && !tip) { try { made = await askFor(chatId, 'spectator', { ev, tone, tip }); } catch (e) { console.warn('[System Blink] spectator', e); } }
        const rr = sameRoom(chatId, r);
        if (!active(rr)) return null;
        const lang = langOf();
        const name = String(made?.name || shuffle(specNames(lang, tone), specRnd)[0]).replace(/^['"‘’「」]+|['"‘’「」]+$/g, '').slice(0, 30);
        const pts = tip ? rate(5 * (1 + Math.floor(specRnd() * 6))) : 0;
        const text = tip ? specLine('tip', tone, lang, name) : String(made?.line || specLine(ev, tone, lang, name)).slice(0, 120);
        const cheer = { id: uid('c'), at: Date.now(), key: key || null, name, text, pts, ev, gift: '', tone };
        if (pts) rr.ledger.push({ id: uid('l'), questId: 'spectator', cond: null, pts, key, reason: name, at: cheer.at });
        rr.cheers.push(cheer);
        if (rr.cheers.length > 200) rr.cheers.splice(0, rr.cheers.length - 200);
        save(); changed();
        let skill = null;
        if (gift) {
            skill = await makeSkill(chatId, rollGrade('spectator'), 'spectator');
            if (skill) { if (tone === 'star') skill.star = true; cheer.gift = skill.name; save(); changed(); if (chatId === currentChatId()) bus.emit('skillGained', { skill, from: 'spectator' }); }
        }
        return { ...cheer, skill };
    } finally { reacting = false; }
}

/** Points a spectator gave with this reply (for the log card). */
export function cheersFor(r, key) { return (r?.cheers || []).filter(c => c.key === key); }
