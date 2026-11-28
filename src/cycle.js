// 0.8.0 regression (Next Cycle): the world goes back, the user's character keeps the memory.
// Everything here lives in the chat's own `cycle` (store.js newCycle). Nothing in the chat file changes:
// older cycles stay in the chat, they are only left out of what the AI is sent (the generate interceptor).

import { settings, save, uid, room, currentChatId, hideIndexIn, keyTime } from './store.js';
import { t } from './i18n.js';
import {
    bus, chatView, active, ownerName, lastMine, msgKey, dayChanges, points, questState, goalStages, genreOn, addNote, newQuests, toneOf,
} from './engine.js';

const changed = () => bus.emit('change');
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const KEEP_KEYS = 20;

export const cycleOf = (r = room()) => r?.cycle || null;
/** Regression is switched on in this chat (and the System is awake). */
export const cycleOn = (r = room()) => !!(active(r) && r?.cycle?.on);

// ---------- the earlier cycles, out of the AI's sight ----------
export function hideThrough(r = room(), view = chatView()) { return hideIndexIn(r?.cycle?.hide, view.keys); }
/** Where this cycle's story starts in the chat (the greeting before it still counts). */
export const cycleStart = (r = room(), view = chatView()) => hideThrough(r, view) + 1;
export const isHidden = (r, view, i) => { const h = hideThrough(r, view); return h >= 0 && i <= h && i > 0; };

/**
 * SillyTavern's generate interceptor (manifest `generate_interceptor`). `chat` is SillyTavern's own copy of the
 * chat list for this request (1.19.1: coreChat = chat.filter(...)); the messages in it are not changed, only taken
 * out of this list. The greeting stays (the story starts from it again).
 */
export function interceptor(chat) {
    try {
        if (!settings().enabled || !Array.isArray(chat)) return;
        const r = room();
        const h = r?.cycle?.hide;
        if (!h) return;
        const cut = hideIndexIn(h, chat.map(msgKey));
        if (cut < 1) return;
        const keepFirst = chat[0] && !chat[0].is_user;
        chat.splice(keepFirst ? 1 : 0, keepFirst ? cut : cut + 1);
    } catch (e) { console.warn('[System Blink] cycle interceptor', e); }
}

/** "Show the earlier cycles to the AI again". */
export function unhide(chatId = currentChatId()) {
    const r = room(chatId);
    if (!r?.cycle?.hide) return;
    r.cycle.hide = null;
    save(); changed();
}

// ---------- days and the flow of events ----------
/** The story day now in this cycle: the day, plus days the story check found that were not moved on yet. */
export function cycleDay(r = room(), view = chatView()) {
    return (r?.day || 1) + dayChanges(r, view).reduce((a, d) => a + d.days, 0);
}

/** An event's result counts while the reply that showed it is there (or it was set by hand). */
export function evState(r, ev, view = chatView(), skip = null) {
    if (ev.byHand) return ev.state || 'ahead';
    // one result per reply (swipes of the same message each keep theirs); the newest one still there counts
    const list = resultsOf(ev);
    for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if (x.key && x.key !== skip && x.state && x.state !== 'ahead' && view.index.has(x.key)) return x.state;
    }
    return 'ahead';
}
const resultsOf = (ev) => ev.results || (ev.stateKey && ev.state ? [{ key: ev.stateKey, state: ev.state }] : []);
function putResult(ev, key, state, quote = '') {
    const list = resultsOf(ev).filter(x => x.key !== key);
    list.push({ key, state, quote: String(quote || '').slice(0, 120) });
    ev.results = list.slice(-KEEP_KEYS);
    ev.state = ''; ev.stateKey = null;
}
const aliveIn = (list, view, redo) => (list || []).some(k => k !== redo && view.index.has(k));

/** "3 | something", "Day 3 · something", "3일째 · 무슨 일" → { day, when, what }. */
export function parseEventLine(line) {
    const s = oneLine(line);
    if (!s) return null;
    const m = /^(.{1,24}?)\s*[|·•:]\s*(.+)$/.exec(s);
    const when = m ? m[1].trim() : '';
    const what = (m ? m[2] : s).trim().slice(0, 160);
    const n = /(\d{1,3})/.exec(when);
    return what ? { day: n ? Math.max(1, Number(n[1])) : null, when: when.slice(0, 24), what } : null;
}
export const eventLine = (ev) => `${ev.day ? ev.day : ev.when || '?'} | ${ev.what}`;
const newEvent = (x, src = 'hand') => ({ id: uid('v'), day: x.day ?? null, when: x.when || '', what: x.what, state: 'ahead', stateKey: null, results: [], byHand: false, src, dueKeys: [], omenKeys: [], newsKeys: [] });

/** Events in day order (no day last). */
export const eventsOf = (r = room()) => [...(r?.cycle?.events || [])].sort((a, b) => (a.day ?? 999) - (b.day ?? 999));

/** Events whose sign shows today (the day before they come). */
export function omens(r = room(), view = chatView(), redo = null) {
    const c = r?.cycle;
    if (!c?.on || !c.omen || c.flow === 'loose') return [];
    const d = cycleDay(r, view);
    return eventsOf(r).filter(ev => ev.day && ev.day === d + 1 && evState(r, ev, view, redo) === 'ahead');
}

/**
 * What the story reply hears about regression. `rules` stays the same within a cycle (near the top);
 * `lines` and `wins` are for this reply. `sent` = what went out (marked on the reply when it comes).
 */
export function cyclePrompt(r, view, redo, genre) {
    const out = { rules: '', lines: [], wins: [], sent: [] };
    const c = r?.cycle;
    if (!c?.on) return out;
    const who = ownerName(r);
    const rules = ['[System Blink — regression]'];
    if (c.n > 1) {
        rules.push(`- ${who} has regressed: the world went back in time, and this is ${who}'s cycle ${c.n}. What happened in earlier cycles has not happened in this one.`);
        const knowers = c.knowers.filter(Boolean);
        if (c.scope === 'faint') rules.push(`- Only ${who} remembers the earlier cycles. Others live this time for the first time, though now and then one may feel a faint déjà vu with no content.`);
        else rules.push(`- Only ${who}${knowers.length ? ` and ${knowers.join(', ')} (each only their own memories)` : ''} remember${knowers.length ? '' : 's'} the earlier cycles. Everyone else lives this time for the first time and cannot know what ${who} knows unless ${who} tells them in words.`);
        rules.push(`- ${who}'s thoughts and the narration are not heard by other characters.`);
    } else rules.push(`- This world can go back in time (regression); for ${who} this is the first life so far.`);
    if (c.truth) rules.push(`- How this world really is (the characters do not know this unless they find it out): ${oneLine(c.truth).slice(0, 800)}`);
    if (c.flow === 'fixed') rules.push('- Some events in this world are fated. When the notes say one is due, it happens — unless what was done earlier in the story changed it.');
    if (c.flow === 'strong') rules.push('- Some events in this world are fated, and the world pushes toward them: even when one is prevented, something like it tends to happen another way.');
    out.rules = rules.join('\n');
    if (c.flow === 'loose') return out;
    const d = cycleDay(r, view);
    // (the reply being replaced does not count: what it showed is shown again)
    const ahead = eventsOf(r).filter(ev => evState(r, ev, view, redo) === 'ahead');
    // one event per reply: one that is due now, else one the story skipped past (news)
    const due = ahead.find(ev => ev.day === d && !aliveIn(ev.dueKeys, view, redo));
    const late = !due && ahead.find(ev => ev.day && ev.day < d && !aliveIn(ev.newsKeys, view, redo) && !aliveIn(ev.dueKeys, view, redo));
    if (due) {
        out.lines.push(`- It is now time for this fated event: "${oneLine(due.what)}". If ${who} did something earlier in the story that would prevent or change it, show the result of that; otherwise let it happen. Make it come naturally, without cutting the scene off. If ${who} is not there, it happens elsewhere and the news reaches ${who}.`);
        out.sent.push({ id: due.id, kind: 'due' });
    } else if (late) {
        out.lines.push(`- While time passed, this fated event happened without ${who} there: "${oneLine(late.what)}". Let the news of it reach ${who} now, naturally.`);
        out.sent.push({ id: late.id, kind: 'news' });
    }
    for (const ev of omens(r, view, redo)) {
        if (aliveIn(ev.omenKeys, view, redo)) continue;
        out.lines.push(`- A small sign may show now (do not state it outright): something hinting that this may happen soon — "${oneLine(ev.what)}".`);
        out.sent.push({ id: ev.id, kind: 'omen' });
        break;
    }
    if (genre && due && c.n > 1) out.wins.push(`[SYS:NOTICE] CYCLE · ${oneLine(t('qb_cycle_due'))}`);
    return out;
}

/** The reply came: what went out with it is tied to it (a swipe sends it again). */
export function markCycleSent(key, sent, chatId = currentChatId()) {
    const r = room(chatId);
    if (!r?.cycle || !key || !sent?.length) return;
    for (const { id, kind } of sent) {
        const ev = r.cycle.events.find(x => x.id === id);
        if (!ev) continue;
        const k = `${kind}Keys`;
        ev[k] = [...(ev[k] || []).filter(x => x !== key), key].slice(-KEEP_KEYS);
        // news of a skipped event: it happened (with this reply — a swipe takes it back)
        if (kind === 'news' && !ev.byHand) putResult(ev, key, 'happened');
    }
    save();
}

/** Set an event's result by hand (or `null` to let the story decide again); "now" sends it as due in the next reply. */
export function setEvent(id, state) {
    const r = room();
    const ev = r?.cycle?.events.find(x => x.id === id);
    if (!ev) return;
    if (state === 'now') { ev.day = cycleDay(r); ev.byHand = false; ev.state = 'ahead'; ev.stateKey = null; ev.results = []; ev.dueKeys = []; }
    else if (!state) { ev.byHand = false; ev.state = 'ahead'; ev.stateKey = null; ev.results = []; }
    else { ev.byHand = true; ev.state = state; ev.stateKey = null; }
    save(); changed();
}

// ---------- what the story check asks ----------
/** What to ask about this reply: death, the events sent with it, a leaked memory, a line for the record. */
export function cycleAsk(r, view, key) {
    const c = r?.cycle;
    if (!c || !active(r)) return null;
    const s = settings();
    const ask = { death: '', events: [], leak: false, log: false };
    const tut = r.tutorial?.state === 'active';
    if (c.on && c.death) ask.death = tut ? '' : 'on';
    else if (!c.on && s.cycleAskOff && !c.noAsk && !tut) ask.death = 'off';
    if (c.on) {
        ask.events = eventsOf(r).filter(ev => (ev.dueKeys || []).includes(key) && evState(r, ev, view) === 'ahead');
        ask.leak = c.n > 1 && c.leak;
        ask.log = true;
    }
    return ask.death || ask.events.length || ask.leak || ask.log ? ask : null;
}

/**
 * Store what the check found (tied to the reply). Returns { death, leak } to show: a death the chat should be asked
 * about (once per reply), a leaked memory (once per reply and name).
 */
export function storeCycleCheck(chatId, key, res) {
    const out = { death: null, leak: null };
    const r = room(chatId);
    const c = r?.cycle;
    const got = res?.cycle;
    if (!c || !key || !got) return out;
    const view = chatView();
    const d = cycleDay(r, view);
    for (const e of got.events || []) {
        const ev = c.events.find(x => x.id === e.id);
        if (!ev || ev.byHand || !['happened', 'blocked', 'changed'].includes(e.state)) continue;
        putResult(ev, key, e.state, e.quote);
    }
    // a line for this life's record (checked again after Continue: the newer line replaces it)
    c.journal = c.journal.filter(j => !(j.cand && j.key === key));
    if (got.log && c.on) c.journal.push({ id: uid('j'), cycle: c.n, day: d, text: String(got.log).slice(0, 160), key, star: false, src: 'ai', cand: true, t: Date.now() });
    if (got.death && !c.deaths.some(x => x.key === key)) {
        const dd = { id: uid('x'), key, why: String(got.death).slice(0, 120), at: Date.now(), day: d, n: c.n, ans: '' };
        c.deaths.push(dd);
        if (c.deaths.length > 30) c.deaths.splice(0, c.deaths.length - 30);
        out.death = dd;
    }
    if (got.leak?.who && !c.knowers.includes(got.leak.who) && !c.leaks.some(x => x.key === key && x.who === got.leak.who)) {
        const lk = { id: uid('x'), key, who: String(got.leak.who).slice(0, 30), quote: String(got.leak.quote || '').slice(0, 120), at: Date.now() };
        c.leaks.push(lk);
        if (c.leaks.length > 30) c.leaks.splice(0, c.leaks.length - 30);
        out.leak = lk;
    }
    save();
    return out;
}

/** A death found in a reply that is still there and not gone back from: its card line, the way back. */
export const deathsOf = (r = room(), view = chatView()) => (r?.cycle?.deaths || []).filter(d => view.index.has(d.key));
export function answerDeath(id, ans, chatId = currentChatId()) {
    const d = room(chatId)?.cycle?.deaths.find(x => x.id === id);
    if (d && d.ans !== 'go') { d.ans = ans; save(); changed(); }
}
export function noAskHere(chatId = currentChatId()) {
    const c = room(chatId)?.cycle;
    if (c) { c.noAsk = true; save(); changed(); }
}
/** "[They know] (don't tell me again)": the name joins those who remember. */
export function knowsNow(name, chatId = currentChatId()) {
    const c = room(chatId)?.cycle;
    if (!c || !name || c.knowers.includes(name)) return;
    c.knowers.push(String(name).slice(0, 30));
    if (c.scope === 'me') c.scope = 'some';
    save(); changed();
}

// ---------- this life's record ----------
/** This cycle's lines (a candidate counts while its reply is there). */
export function journalNow(r = room(), view = chatView()) {
    const c = r?.cycle;
    if (!c) return [];
    return c.journal.filter(j => j.cycle === c.n && (!j.key || !j.cand || view.index.has(j.key))).sort((a, b) => (a.day || 0) - (b.day || 0) || (a.t || 0) - (b.t || 0));
}

/** Lines the extension knows by itself (quests, big events, fated events) — not stored, worked out now. */
export function knownLines(r = room(), view = chatView()) {
    const out = [];
    if (!r) return out;
    const add = (id, day, text, src) => out.push({ id, day, text, src, known: true });
    for (const q of r.quests || []) {
        const st = questState(r, q, view).status;
        if (q.kind === 'hidden' && q.fromKey) add(`k${q.id}`, q.day, t('log_k_hidden', { name: q.name }), 'quest');
        if (q.kind === 'sudden' && (st === 'done' || st === 'failed')) add(`k${q.id}`, q.day, t(st === 'done' ? 'log_k_sudden_done' : 'log_k_sudden_fail', { name: q.name }), 'quest');
    }
    for (const q of goalStages(r)) if (questState(r, q, view).status === 'done') add(`k${q.id}`, q.day, t('log_k_stage', { name: q.name }), 'quest');
    for (const b of r.bigs || []) if (b.cycle === r.cycle?.n || b.cycle === undefined) add(`k${b.id}`, b.day, t('log_k_big'), 'quest');
    for (const ev of r.cycle?.events || []) {
        const st = evState(r, ev, view);
        if (st !== 'ahead') add(`k${ev.id}`, ev.day, `${ev.what} (${t(`ev_${st}`)})`, 'flow');
    }
    return out;
}

export function addLine(text, day = null, chatId = currentChatId()) {
    const r = room(chatId);
    const c = r?.cycle;
    if (!c || !String(text || '').trim()) return null;
    const j = { id: uid('j'), cycle: c.n, day: day ?? cycleDay(r), text: oneLine(text).slice(0, 160), key: null, star: false, src: 'hand', cand: false, t: Date.now() };
    c.journal.push(j);
    save(); changed();
    return j;
}
export function editLine(id, text) {
    const j = room()?.cycle?.journal.find(x => x.id === id);
    if (!j) return;
    if (!String(text || '').trim()) return dropLine(id);
    j.text = oneLine(text).slice(0, 160); j.cand = false; if (j.src === 'ai') j.src = 'hand';
    save(); changed();
}
export function dropLine(id) {
    const c = room()?.cycle;
    if (!c) return;
    c.journal = c.journal.filter(x => x.id !== id);
    save(); changed();
}
/** ★ on a reply's card: that scene goes into the record for sure (kept even if the reply is swiped). */
export function toggleStar(key, text = '') {
    const r = room();
    const c = r?.cycle;
    if (!c?.on || !key) return;
    const had = c.journal.find(j => j.src === 'star' && j.key === key && j.cycle === c.n);
    if (had) c.journal = c.journal.filter(j => j !== had);
    else {
        const cand = c.journal.find(j => j.cand && j.key === key);
        c.journal.push({ id: uid('j'), cycle: c.n, day: cand?.day ?? cycleDay(r), text: oneLine(cand?.text || text).slice(0, 160) || '…', key, star: true, src: 'star', cand: false, t: Date.now() });
    }
    save(); changed();
}
export const starred = (r, key) => !!r?.cycle?.journal.some(j => j.src === 'star' && j.key === key && j.cycle === r.cycle.n);

/** The day's candidate lines, to be put down to a few (sent along with the next day's quest request). */
export function dayCandidates(r, day, view = chatView()) {
    const c = r?.cycle;
    if (!c?.on) return [];
    return c.journal.filter(j => j.cand && j.cycle === c.n && j.day <= day && view.index.has(j.key));
}
/** Candidates put down to a few lines (they are kept for good; the candidates go). */
export function applyLog(r, list, lines, day) {
    const c = r?.cycle;
    if (!c || !Array.isArray(lines) || !lines.length) return;
    const ids = new Set(list.map(j => j.id));
    c.journal = c.journal.filter(j => !ids.has(j.id));
    for (const text of lines.slice(0, 3)) if (String(text || '').trim()) c.journal.push({ id: uid('j'), cycle: c.n, day, text: oneLine(text).slice(0, 160), key: null, star: false, src: 'ai', cand: false, t: Date.now() });
}
/** The whole cycle's record, made again by the AI (confirm page). Lines starred or written by hand stay. */
export function replaceLog(chatId, lines) {
    const r = room(chatId);
    const c = r?.cycle;
    if (!c || !Array.isArray(lines)) return false;
    c.journal = c.journal.filter(j => !(j.cycle === c.n && j.src === 'ai'));
    for (const x of lines.slice(0, 12)) {
        const p = typeof x === 'string' ? parseEventLine(x) : { day: Number(x?.day) || null, what: String(x?.what || x?.text || '') };
        if (!p?.what) continue;
        c.journal.push({ id: uid('j'), cycle: c.n, day: p.day, text: p.what.slice(0, 160), key: null, star: false, src: 'ai', cand: false, t: Date.now() });
    }
    save(); changed();
    return true;
}

// ---------- switching on, "where do we start?" ----------
/** From the settings: on (first time: "where do we start?" is asked by the screen) / off (the data stays). */
export function setCycleOn(on, chatId = currentChatId()) {
    const r = room(chatId);
    if (!r?.cycle) return;
    r.cycle.on = !!on;
    r.cycle.temp = false;
    save(); changed();
}

/** ⑦ answered. `again`: the story starts with someone who has already gone back. */
export function setupCycle(chatId, { again = false, n = 2, truth = '', memo = '', events = '', back = '' } = {}) {
    const r = room(chatId);
    const c = r?.cycle;
    if (!c) return;
    c.set = true; c.on = true; c.temp = false;
    if (again) {
        c.n = Math.max(2, Math.min(999, Math.round(Number(n) || 2)));
        c.truth = String(truth || '').slice(0, 2000);
        c.memo = String(memo || '').slice(0, 2000);
        c.back = String(back || '').slice(0, 120);
        setEventsText(r, events);
    }
    save(); changed();
}

/** The events as text lines ("day | what"); results already known are kept for events that stay. */
export function setEventsText(r, text) {
    const c = r?.cycle;
    if (!c) return;
    const old = new Map(c.events.map(ev => [ev.what, ev]));
    c.events = String(text || '').split('\n').map(parseEventLine).filter(Boolean).slice(0, 30).map(p => {
        const ev = old.get(p.what);
        return ev ? Object.assign(ev, { day: p.day, when: p.when }) : newEvent(p);
    });
}

// ---------- going back ----------
const ROOM_RESET = ['quests', 'checks', 'dayLog', 'debuffs', 'lost', 'erases', 'bigs', 'cheers', 'uses', 'notes'];

/**
 * Go back. `d` (the confirm page): { mode, keepItem (bag id), keepSkills, lines: [texts → events of the next life],
 * back: '' (the first scene) | text }. The room before it is kept until my next message ("undo").
 */
export async function regress(chatId, d = {}) {
    const r = room(chatId);
    const c = r?.cycle;
    if (!c || !active(r) || chatId !== currentChatId()) return null;
    const view = chatView();
    const snap = structuredClone(r);
    snap.cycle.undo = null;
    const pts = points(r, view);
    const mode = ['memory', 'one', 'all'].includes(d.mode) ? d.mode : c.mode;
    const lines = (d.lines || []).map(oneLine).filter(Boolean);
    c.past.push({
        n: c.n, at: Date.now(), days: r.day, pts, goal: r.goal?.title || '',
        bag: r.bag.filter(b => b.count > 0).map(b => b.name).slice(0, 20), skills: r.skills.map(k => k.name).slice(0, 20),
        journal: journalNow(r, view).map(j => `${j.day || '?'} · ${j.text}`).slice(0, 40),
        events: c.events.map(ev => ({ day: ev.day, what: ev.what, state: evState(r, ev, view) })),
    });
    if (c.past.length > 30) c.past.splice(0, c.past.length - 30);
    // the world goes back: fated events wait again; what this life recorded will happen again
    for (const ev of c.events) Object.assign(ev, { state: 'ahead', stateKey: null, results: [], byHand: false, dueKeys: [], omenKeys: [], newsKeys: [] });
    const have = new Set(c.events.map(ev => ev.what));
    for (const ln of lines) {
        const p = parseEventLine(ln);
        if (p && !have.has(p.what)) { c.events.push(newEvent(p, 'log')); have.add(p.what); }
    }
    // what stays
    const keepItem = mode === 'one' ? r.bag.find(b => b.id === d.keepItem && b.count > 0) : null;
    const keepSkills = mode === 'all' || (mode === 'one' && !!d.keepSkills);
    if (mode !== 'all') {
        r.bag = keepItem ? [{ ...keepItem, count: 1 }] : [];
        r.ledger = []; r.spend = [];
    } else {
        // everything kept: the points as one line (their quests are gone)
        r.ledger = pts ? [{ id: uid('l'), questId: 'cycle-carry', cond: null, pts, key: null, reason: '', at: Date.now() }] : [];
        r.spend = [];
    }
    if (!keepSkills) r.skills = [];
    // the main goal stays, its stages start over
    const first = r.goal ? goalStages(r).find(q => q.stage === 0) : null;
    for (const k of ROOM_RESET) r[k] = [];
    if (r.goal && first) {
        r.goal.done = false;
        const q = { id: uid('q'), kind: 'goal', goalId: r.goal.id, stage: 0, name: first.name, reward: first.reward, day: 1, failed: false, diff: first.diff };
        if (first.conds) q.conds = [...first.conds];
        if (genreOn(r)) q.veil = true;
        r.quests.push(q);
    }
    r.day = 1;
    r.lifeBase = { date: '', time: '', weather: '', place: '', plan: '', at: Date.now() };
    r.shop.daily = []; r.shop.dailyDay = 0;
    r.roll = { key: '', sudden: false, hidden: false };
    r.suddenRest = 0; r.sinceCheck = 0; r.lastCheckKey = ''; r.specKey = '';
    for (const x of c.deaths) if (view.index.has(x.key)) x.ans = 'go';
    c.n += 1; c.dayStart = 1; c.on = true; c.temp = false; c.set = true; c.mode = mode;
    c.back = String(d.back || '').slice(0, 120);
    // the story so far stays in the chat; the AI no longer sees it
    if (view.length) {
        const key = view.keys[view.length - 1];
        c.hide = { key, keys: view.keys.slice(Math.max(0, view.length - 21), view.length - 1), idx: view.length - 1, n: c.n, t: keyTime(key) };
    }
    c.undo = { snap, mine: lastMine(view)?.key || null, at: Date.now() };
    const who = ownerName(r);
    const where = c.back ? `at this point: ${oneLine(c.back)}` : 'back at the story\'s first scene';
    addNote(r, `${who} has just gone back in time (cycle ${c.n} begins). ${who} wakes ${where}, with every memory of the earlier life. To everyone else nothing has happened yet. Show ${who} coming to, briefly.`,
        { kind: 'CYCLE', text: t('qb_cycle_line', { n: c.n }) },
        `The System has sent ${who} back in time: cycle ${c.n} begins. ${who} wakes ${where}, remembering the earlier life. Make it a real moment in the story.`);
    // a new object for the room: an answer still on its way for the life before (a story check, quests, the record)
    // is for data that is no longer there and is dropped (engine sameRoom)
    const fresh = swapRoom(chatId, r);
    save(); changed();
    // the new life's first daily quests come right after (their popup after the "life N has begun" one)
    setTimeout(() => { if (room(chatId) === fresh && currentChatId() === chatId) newQuests(chatId).catch(e => console.warn('[System Blink] quests', e)); }, 0);
    return { n: c.n };
}

/** "Undo (back to cycle N)": only until my next message. */
export function undoRegress(chatId = currentChatId()) {
    const r = room(chatId);
    const u = r?.cycle?.undo;
    if (!u?.snap) return false;
    // (a new object, as in regress: what was on its way for the new life is dropped)
    const back = structuredClone(u.snap);
    back.cycle.undo = null;
    settings().chats[chatId] = back;
    // regression had been switched on only for this (from a chat where it was off): off again, its record lines too
    if (back.cycle.temp) offTemp(back.cycle);
    save(); changed();
    return true;
}
export const canUndo = (r = room()) => !!r?.cycle?.undo;
/** My next message: the new cycle is under way, no more undo. */
export function dropUndo(chatId = currentChatId()) {
    const c = room(chatId)?.cycle;
    if (c?.undo) { c.undo = null; save(); }
}

/** "Stop" on the confirm page of a chat where regression was switched on just for this: off again, as if never on. */
export function stopTemp(chatId = currentChatId()) {
    const c = room(chatId)?.cycle;
    if (!c?.temp) return;
    offTemp(c);
    if (sorting === chatId) { sorting = ''; sortGen++; } // the record being put down: dropped when it comes
    save(); changed();
}
function offTemp(c) {
    c.on = false; c.temp = false;
    c.journal = c.journal.filter(j => j.cycle !== c.n || j.src === 'star' || j.src === 'hand');
}
/** Switched on just for a confirm page that is not open any more (another chat now, a reload): off again. */
export function clearTemps(keep = '') {
    const s = settings();
    let any = false;
    for (const [id, r] of Object.entries(s.chats || {})) {
        if (id === keep || !r?.cycle?.temp) continue;
        offTemp(r.cycle); any = true;
        if (sorting === id) { sorting = ''; sortGen++; }
    }
    if (any) { save(); changed(); }
}
/** The room's data as a new object (same content). */
function swapRoom(chatId, r) {
    const fresh = structuredClone(r);
    settings().chats[chatId] = fresh;
    return fresh;
}
/** Begin the regression from a chat where it is off (② [Continue]): on, for now. */
export function startTemp(chatId = currentChatId()) {
    const c = room(chatId)?.cycle;
    if (!c || c.on) return;
    c.on = true; c.temp = true;
    save(); changed();
}

export const cycleToneClass = (r = room()) => `sblink-tn-${active(r) ? toneOf(r) : 'game'}`;

// ---------- asking the AI (the open chat only; the answer is dropped if the chat's data changed meanwhile) ----------
let sorting = '';
let sortGen = 0;
export const isSorting = (chatId = currentChatId()) => !!chatId && sorting === chatId;
/** Put this life's record down from the story (confirm page). Returns true / false (failed) / null (not asked). */
export async function sortLog(chatId = currentChatId()) {
    const r = room(chatId);
    if (!r?.cycle || sorting || chatId !== currentChatId()) return null;
    sorting = chatId; changed();
    const gen = ++sortGen;
    let made = null;
    try { made = await bus.ask('cycleLog', { cands: journalNow(r).filter(j => j.cand).map(j => j.text) }); } catch (e) { console.warn('[System Blink] cycle log', e); }
    if (gen !== sortGen) return null; // stopped meanwhile
    sorting = '';
    if (room(chatId) !== r || currentChatId() !== chatId || !r.cycle.on) { changed(); return null; }
    if (!Array.isArray(made)) { changed(); return false; }
    return replaceLog(chatId, made);
}
/** "AI fills it in" for "I have already gone back" (⑦). Returns the filled values, or null. */
export async function fillCycle(chatId = currentChatId(), random = false) {
    const r = room(chatId);
    if (!r || chatId !== currentChatId()) return null;
    let got = null;
    try { got = await bus.ask('cycleFill', { random }); } catch (e) { console.warn('[System Blink] cycle fill', e); return null; }
    return room(chatId) === r && currentChatId() === chatId ? got : null;
}
