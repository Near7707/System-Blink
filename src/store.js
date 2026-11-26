// System Blink data lives only in extension settings (never in character cards, chat files or chat metadata).
// The floating button's place, size and ring are kept per device (localStorage).

export const MODULE = 'systemBlink';
export const FORMAT = 1;
export const VERSION = '0.1.1';

const DEFAULTS = Object.freeze({
    format: FORMAT,
    enabled: true,
    lang: 'en',
    langChosen: false,      // false = follow SillyTavern's language
    tone: 'game',
    pointRate: 1,           // 0.5 | 1 | 2
    dayBasis: 'story',      // story | real
    judgeEvery: 'every',    // every | three | manual
    tutorialAuto: true,
    visibility: 'me',       // me | all
    lifeToAI: true,
    questChance: 'some',    // off | some | more
    motion: true,
    logCards: true,
    btnShow: true,
    btnSnap: true,
    btnDim: true,
    useDefaults: true,
    oddities: true,
    customShop: '',         // one item per line: name | price | rarity | description
    profileId: '',          // connection profile for checks and making things ('' = current API)
    chats: {},              // chatId -> room state
    branchDone: {},         // branch chatId -> parent chatId
});

let ctxGetter = () => globalThis.SillyTavern?.getContext?.();
export function ctx() { return ctxGetter(); }

export function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = structuredClone(DEFAULTS);
    return migrate(all[MODULE]);
}

const ONE_OF = {
    tone: ['game'], dayBasis: ['story', 'real'], judgeEvery: ['every', 'three', 'manual'],
    visibility: ['me', 'all'], questChance: ['off', 'some', 'more'], lang: ['en', 'ko'],
};

export function migrate(s) {
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    if (typeof s.format !== 'number') s.format = FORMAT;
    for (const [k, list] of Object.entries(ONE_OF)) if (!list.includes(s[k])) s[k] = DEFAULTS[k];
    if (![0.5, 1, 2].includes(Number(s.pointRate))) s.pointRate = 1;
    s.pointRate = Number(s.pointRate);
    for (const k of ['chats', 'branchDone']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    if (typeof s.customShop !== 'string') s.customShop = '';
    if (typeof s.profileId !== 'string') s.profileId = '';
    for (const id of Object.keys(s.chats)) s.chats[id] = fixRoom(s.chats[id]);
    return s;
}

export function newRoom() {
    return {
        on: false,              // the system is switched on in this chat
        lifeMode: true,         // daily-life mode
        name: '',               // '' = the persona's name
        title: '', titles: [],
        world: '',              // world note (used when making quests, items and titles)
        tutorial: { state: 'none', done: [false, false, false, false], rewarded: false },
        day: 1,
        realDate: '',           // last real date seen (real-time day basis)
        lifeBase: { date: '', time: '', weather: '', place: '', plan: '', at: 0 },
        quests: [],             // { id, name, reward, day, failed }
        ledger: [],             // { id, questId, pts, key (AI reply) | null, reason, at, undone }
        spend: [],              // { id, what, pts, at }
        bag: [],                // { id, name, desc, rarity, icon, kind, count }
        uses: [],               // { id, name, rarity, icon, desc, at, key (my message) | null }
        notes: [],              // one-time notes for the AI: { id, text, at, deliveredKey }
        checks: [],             // { key, t, quests: [{ questId, reason }], life: {}, days, dayReason, nextTime, dismissed }
        shop: { standing: [], dailyDay: 0, daily: [] },
        sinceCheck: 0,          // AI replies since the last check (for "every 3rd")
        lastCheckKey: '',
    };
}

function fixRoom(r) {
    const base = newRoom();
    if (!r || typeof r !== 'object') return base;
    for (const [k, v] of Object.entries(base)) if (r[k] === undefined || typeof r[k] !== typeof v || Array.isArray(v) !== Array.isArray(r[k])) r[k] = v;
    if (!Array.isArray(r.tutorial.done) || r.tutorial.done.length !== 4) r.tutorial.done = [false, false, false, false];
    if (!r.shop || typeof r.shop !== 'object') r.shop = base.shop;
    for (const k of ['standing', 'daily']) if (!Array.isArray(r.shop[k])) r.shop[k] = [];
    r.day = Math.max(1, Math.round(Number(r.day) || 1));
    return r;
}

let saveFailedOnce = false;
export function save() {
    try { ctx().saveSettingsDebounced(); } catch (e) {
        console.error('[System Blink] save', e);
        if (!saveFailedOnce) { saveFailedOnce = true; globalThis.toastr?.error?.(String(e?.message || e), 'System Blink'); }
    }
}

export function uiLang() {
    const s = settings();
    if (s.langChosen && s.lang) return s.lang;
    let loc = '';
    try { loc = String(ctx().getCurrentLocale?.() || ''); } catch { /* ignore */ }
    return /^ko/i.test(loc) ? 'ko' : 'en';
}

export function uid(prefix = 'b') {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function currentChatId() {
    try {
        const c = ctx();
        if (c.characterId === undefined && !c.groupId) return null;
        const id = c.getCurrentChatId?.();
        return id ? String(id) : null;
    } catch { return null; }
}

/** State for a chat. With `create` false, returns null when the chat has nothing yet. */
export function room(chatId = currentChatId(), create = false) {
    if (!chatId) return null;
    const s = settings();
    if (!s.chats[chatId]) {
        if (!create) return null;
        s.chats[chatId] = newRoom();
    }
    return s.chats[chatId];
}

const stripExt = (n) => String(n || '').replace(/\.jsonl$/i, '');

export function onChatRenamed(oldName, newName) {
    const s = settings();
    const from = stripExt(oldName), to = stripExt(newName);
    if (!from || !to || from === to || !s.chats[from]) return;
    s.chats[to] = s.chats[from];
    delete s.chats[from];
    for (const [k, v] of Object.entries(s.branchDone)) if (v === from) s.branchDone[k] = to;
    if (s.branchDone[from]) { s.branchDone[to] = s.branchDone[from]; delete s.branchDone[from]; }
    save();
}

export function onChatDeleted(name) {
    const s = settings();
    const id = stripExt(name);
    let changed = false;
    if (s.chats[id]) { delete s.chats[id]; changed = true; }
    if (s.branchDone[id]) { delete s.branchDone[id]; changed = true; }
    if (changed) save();
}

/** A new branch chat starts with a copy of its parent's system (points, bag, quests, tutorial). */
export function copyFromParent() {
    const s = settings();
    const id = currentChatId();
    if (!id || s.chats[id] || s.branchDone[id]) return false;
    let parent = '';
    try { parent = stripExt(ctx().chatMetadata?.main_chat || ''); } catch { /* ignore */ }
    if (!parent || parent === id || !s.chats[parent]) return false;
    s.chats[id] = fixRoom(structuredClone(s.chats[parent]));
    s.branchDone[id] = parent;
    save();
    return true;
}

export function exportData() {
    return { systemBlink: FORMAT, version: VERSION, settings: structuredClone(settings()) };
}

export function importData(obj) {
    if (!obj || typeof obj !== 'object' || !obj.settings || typeof obj.settings !== 'object') throw new Error('bad file');
    ctx().extensionSettings[MODULE] = migrate(structuredClone(obj.settings));
    save();
}

// ---------- per device ----------
const DEV_KEY = 'systemBlink.device';
export function device() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(DEV_KEY) || '{}') || {}; } catch { d = {}; }
    if (!['small', 'normal'].includes(d.size)) d.size = 'normal';
    if (!['dotted', 'solid'].includes(d.ring)) d.ring = 'dotted';
    if (!d.pos || typeof d.pos !== 'object') d.pos = {};
    return d;
}
export function saveDevice(d) {
    try { localStorage.setItem(DEV_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
