// System Blink data lives only in extension settings (never in character cards, chat files or chat metadata).
// The floating button's place, size and ring are kept per device (localStorage).

export const MODULE = 'systemBlink';
export const FORMAT = 2;
export const VERSION = '0.2.0';

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
    suddenFreq: 'rare',     // off | rare (1/20) | normal (1/10) | often (1/5) — rolled after each reply
    suddenRest: 5,          // replies to rest after a sudden quest: 3 | 5 | 10
    hiddenOn: true,         // hidden quests can be found
    goalSuggest: true,      // the AI suggests a main goal from the character card
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
    suddenFreq: ['off', 'rare', 'normal', 'often'],
};

const BACKUP_KEY = 'systemBlink.backup.v1';

/** Older saved data → this format. Format 1 is kept once on this device before it is changed. */
function upgrade(s) {
    const from = Number(s.format) || 1;
    if (from >= FORMAT) return;
    if (from < 2) {
        try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify({ systemBlink: 1, at: Date.now(), settings: s })); } catch (e) { console.warn('[System Blink] backup before upgrade', e); }
        for (const r of Object.values(s.chats || {})) {
            if (!r || typeof r !== 'object' || !Array.isArray(r.quests)) continue;
            for (const q of r.quests) if (q && !q.kind) q.kind = 'daily';
        }
    }
    s.format = FORMAT;
}

/** The format-1 copy kept before the upgrade (this device only), or null. */
export function oldBackup() {
    try { const v = localStorage.getItem(BACKUP_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

export function migrate(s) {
    if (s.format !== FORMAT) upgrade(s);
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    for (const [k, list] of Object.entries(ONE_OF)) if (!list.includes(s[k])) s[k] = DEFAULTS[k];
    if (![0.5, 1, 2].includes(Number(s.pointRate))) s.pointRate = 1;
    s.pointRate = Number(s.pointRate);
    if (![3, 5, 10].includes(Number(s.suddenRest))) s.suddenRest = 5;
    s.suddenRest = Number(s.suddenRest);
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
        // { id, kind: daily | sudden | hidden | goal, name, reward, day, failed, conds?: [text],
        //   sudden: state offered | accepted | declined, limit, seen: [reply keys judged], fromKey, acceptKey
        //   hidden: why · goal: stage (0-based) }
        quests: [],
        ledger: [],             // { id, questId, cond (index) | null, pts, key (AI reply) | null, reason, at, undone }
        spend: [],              // { id, what, pts, at }
        bag: [],                // { id, name, desc, rarity, icon, kind, count }
        uses: [],               // { id, name, rarity, icon, desc, at, key (my message) | null }
        notes: [],              // one-time notes for the AI: { id, text, at, deliveredKey }
        checks: [],             // { key, t, quests: [{ questId, reason }], life: {}, days, dayReason, nextTime, dismissed }
        shop: { standing: [], dailyDay: 0, daily: [] },
        goal: null,             // { id, title, total, done: false } — its stages are quests of kind 'goal'
        roll: { key: '', sudden: false, hidden: false }, // the dice for the newest reply
        suddenRest: 0,          // replies left before another sudden quest may come
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
    if (r.goal !== null && (typeof r.goal !== 'object' || Array.isArray(r.goal))) r.goal = null;
    r.quests = r.quests.filter(q => q && typeof q === 'object');
    for (const q of r.quests) if (!['daily', 'sudden', 'hidden', 'goal'].includes(q.kind)) q.kind = 'daily';
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
