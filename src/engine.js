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
    for (const e of r.ledger) if (!e.undone && alive(e.key, view)) earned += Number(e.pts) || 0;
    const spent = r.spend.reduce((a, x) => a + (Number(x.pts) || 0), 0);
    return Math.max(0, earned - spent);
}

// ---------- quests ----------
export function todays(r = room()) { return (r?.quests || []).filter(q => q.day === r.day); }

/** { status: 'done' | 'active' | 'failed', entry, rerolled } */
export function questState(r, q, view = chatView()) {
    const entries = r.ledger.filter(e => e.questId === q.id && !e.undone);
    const entry = entries.find(e => alive(e.key, view));
    if (entry) return { status: 'done', entry };
    const rerolled = entries.some(e => e.key != null && !view.index.has(e.key));
    return { status: q.failed ? 'failed' : 'active', entry: null, rerolled };
}

export function openQuests(r = room(), view = chatView()) {
    return todays(r).filter(q => questState(r, q, view).status === 'active');
}

export function clearByHand(questId) {
    const r = room();
    const q = r?.quests.find(x => x.id === questId);
    if (!q || questState(r, q).status !== 'active') return;
    r.ledger.push({ id: uid('l'), questId, pts: rate(q.reward), key: null, reason: '', at: Date.now(), byHand: true });
    tutorialStep(r, 1);
    save(); changed();
    bus.emit('cleared', [{ q, pts: rate(q.reward) }]);
}

export function undoClear(questId) {
    const r = room();
    const view = chatView();
    for (const e of r?.ledger || []) if (e.questId === questId && !e.undone && alive(e.key, view)) e.undone = true;
    save(); changed();
}

// ---------- AI checks (stored per AI reply) ----------
const KEEP_CHECKS = 12;

/** Store one check result for an AI reply and apply its quest clears. Returns the cleared quests. */
export function storeCheck(chatId, key, res) {
    const r = room(chatId);
    if (!r) return [];
    const view = chatView();
    r.checks = r.checks.filter(c => c.key !== key);
    const prev = lifeNow(r, view);
    const life = {}, lifeFrom = {};
    if (r.lifeMode) for (const [k, v] of Object.entries(res.life || {})) if (v && v !== prev[k]) { life[k] = v; lifeFrom[k] = prev[k] || ''; }
    const check = { key, t: Date.now(), quests: [], life, lifeFrom, days: res.days || 0, dayReason: res.dayReason || '', nextTime: res.nextTime || '', dismissed: false };
    const cleared = [];
    for (const { questId, reason } of res.quests || []) {
        const q = r.quests.find(x => x.id === questId);
        if (!q || questState(r, q, view).status !== 'active') continue;
        check.quests.push({ questId, reason });
        const pts = rate(q.reward);
        r.ledger.push({ id: uid('l'), questId, pts, key, reason, at: Date.now() });
        cleared.push({ q, pts, reason });
    }
    if (cleared.length) tutorialStep(r, 1);
    r.checks.push(check);
    if (r.checks.length > KEEP_CHECKS) r.checks.splice(0, r.checks.length - KEEP_CHECKS);
    r.lastCheckKey = key;
    save();
    return cleared;
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
    return { key: c.key, days, reason: c.dayReason, fromDay: r.day, toDay: r.day + days, fromTime: life.time, nextTime: c.nextTime, open: openQuests(r, view) };
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
    list = list.slice(0, want).map(q => ({ id: uid('q'), name: String(q.name).slice(0, 80), reward: Math.min(30, Math.max(10, Math.round(Number(q.reward) || 10))), day: rr.day, failed: false }));
    rr.quests.push(...list);
    // keep the list short: drop quests of old days beyond the last few
    const minDay = rr.day - 7;
    rr.quests = rr.quests.filter(q => q.day >= minDay || rr.ledger.some(e => e.questId === q.id));
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
    r.ledger.push({ id: uid('l'), questId: 'tutorial', pts: TUTORIAL_REWARD, key: null, reason: '', at: Date.now() });
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
