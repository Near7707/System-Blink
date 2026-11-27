// System Blink data lives only in extension settings (never in character cards, chat files or chat metadata).
// The floating button's place, size and ring are kept per device (localStorage).

export const MODULE = 'systemBlink';
export const FORMAT = 2;
export const VERSION = '0.6.6';
export const TONES = ['game', 'star', 'threat'];
export const DIFFS = ['off', 'easy', 'normal', 'hard', 'hell'];

const DEFAULTS = Object.freeze({
    format: FORMAT,
    enabled: true,
    lang: 'en',
    langChosen: false,      // false = follow SillyTavern's language
    tone: 'game',           // (old; each chat has its own voice since 0.5)
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
    storyQuest: false,      // 0.6.0: the AI writes a [SYS:QUEST] line in the story when a quest arrives
    goalSuggest: 'manual',  // (before 0.6.2) auto | manual | off — replaced by goalAuto, kept unused
    goalAuto: true,         // 0.6.2: the System sets the main goal by itself (once per chat, after the tutorial)
    autoWake: {},           // 0.6.2: character / group key -> true (new chats wake by themselves) | false (switched off for it)
    specOn: true,           // 2-D: spectators react now and then (small notices)
    specMode: 'light',      // light (ready-made lines, no AI call) | rich (the AI writes the line, one extra call)
    specGift: true,         // spectators sometimes sponsor points (and, very rarely, a skill)
    motion: true,
    logCards: true,
    btnShow: true,
    btnSnap: false,         // (before 0.5.5) stick to the edge — replaced by btnTuck, kept unused
    btnTuck: true,          // 0.5.5: let go against the chat column's side = tuck in as a bookmark tab
    btnOnlyOn: true,        // 0.5.5: show the button only in chats where the System is awake
    btnDim: true,
    toastPos: 'column',     // 0.6.5: small notices — column (top right inside the chat column) | input (above the input box) | screen (top right of the screen)
    questPanel: true,       // 0.6.5: a small panel of the quests in progress, beside the chat (PC) / one line on top (phone)
    guideSeen: false,       // 0.6.5: the "first time here?" settings guide was shown (or this is not a first-time user)
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
    tone: TONES, specMode: ['light', 'rich'], dayBasis: ['story', 'real'], judgeEvery: ['every', 'three', 'manual'],
    visibility: ['me', 'all'], questChance: ['off', 'some', 'more'], lang: ['en', 'ko'],
    suddenFreq: ['off', 'rare', 'normal', 'often'], goalSuggest: ['auto', 'manual', 'off'], toastPos: ['column', 'input', 'screen'],
};

const BACKUP_KEY = 'systemBlink.backup.v1';

/** Older saved data → this format. Format 1 is kept once on this device before it is changed. */
function upgrade(s) {
    const from = Number(s.format) || 1;
    if (from >= FORMAT) return;
    if (from < 2) {
        const hasData = s.chats && typeof s.chats === 'object' && Object.keys(s.chats).length > 0;
        try { if (hasData && !localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify({ systemBlink: 1, at: Date.now(), settings: s })); } catch (e) { console.warn('[System Blink] backup before upgrade', e); }
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
    // 0.5.1: the goal suggestion became auto / manual / off, and the button no longer sticks to the edge by default
    if (s.goalSuggest === true) s.goalSuggest = 'manual';
    if (s.goalSuggest === false) s.goalSuggest = 'off';
    if (!s.v051) { s.btnSnap = false; s.v051 = true; }
    // 0.6.5: people who already use the System (a chat with data) don't get the first-time guide
    if (s.guideSeen === undefined) s.guideSeen = !!(s.chats && typeof s.chats === 'object' && Object.keys(s.chats).length);
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    for (const [k, list] of Object.entries(ONE_OF)) if (!list.includes(s[k])) s[k] = DEFAULTS[k];
    if (![0.5, 1, 2].includes(Number(s.pointRate))) s.pointRate = 1;
    s.pointRate = Number(s.pointRate);
    if (![3, 5, 10].includes(Number(s.suddenRest))) s.suddenRest = 5;
    s.suddenRest = Number(s.suddenRest);
    for (const k of ['chats', 'branchDone', 'autoWake']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    if (typeof s.customShop !== 'string') s.customShop = '';
    if (typeof s.profileId !== 'string') s.profileId = '';
    for (const id of Object.keys(s.chats)) s.chats[id] = fixRoom(s.chats[id]);
    return s;
}

export function newRoom() {
    return {
        on: false,              // the system is switched on in this chat
        lifeMode: true,         // daily-life mode
        difficulty: 'off',      // off | easy | normal | hard | hell (stage 2-B; each chat its own)
        tone: 'game',           // the System's voice in this chat: game | star (sponsors) | threat (2-D)
        name: '',               // '' = the persona's name
        title: '', titles: [],
        world: '',              // world note (used when making quests, items and titles)
        tutorial: { state: 'none', done: [false, false, false, false], rewarded: false },
        day: 1,
        realDate: '',           // last real date seen (real-time day basis)
        lifeBase: { date: '', time: '', weather: '', place: '', plan: '', at: 0 },
        // { id, kind: daily | sudden | hidden | goal, name, reward, day, failed, conds?: [text],
        //   sudden: state offered | accepted | declined, limit, seen: [reply keys judged], fromKey, acceptKey
        //   hidden: why · goal: stage (0-based) · penalty: a chore that lifts a debuff (no reward)
        //   diff: the difficulty it was made under · failedAt / failAt / answeredAt: when it was failed or answered }
        quests: [],
        ledger: [],             // { id, questId, cond (index) | null, pts, key (AI reply) | null, reason, at, undone }
        spend: [],              // { id, what, pts, at }
        bag: [],                // { id, name, desc, rarity, icon, kind, count }
        uses: [],               // { id, name, rarity, icon, desc, at, key (my message) | null }
        notes: [],              // one-time notes for the AI: { id, text, at, deliveredKey }
        lifeLog: [],            // every daily-life change, kept for good: { key, t, life, lifeFrom }
        checks: [],             // { key, t, quests: [{ questId, reason }], life: {}, days, dayReason, nextTime, dismissed }
        shop: { standing: [], dailyDay: 0, daily: [] },
        debuffs: [],            // { id, kind: 'pricey', day (the day it lasts), questId (its penalty quest) | null, at }
        lost: [],               // items taken from the bag as a Hell penalty: { id, name, icon, rarity, at, day }
        goal: null,             // { id, title, total, done: false, skillGiven } — its stages are quests of kind 'goal'
        goalAuto: false,        // 0.6.2: this chat has had its goal (set by the System or by hand): no more goals by itself
        // stage 2-C: { id, name, grade (F…S, SS), type: passive | active, effect, hidden: { effect, key (AI reply that opened it) | null, reason, at } | null,
        //   from: gacha | book | goal | hidden, mode, day, at, uses, fresh (NEW until looked at) }
        skills: [],
        draws: [],              // gacha results, kept for the log: { id, at, kind: skill | item, grade | rarity, name }
        // 2-D: threat voice — warnings come from failed quests (worked out each time); these are what changes the count
        erases: [],             // a warning eraser was used: { id, at }
        bigs: [],               // three warnings set off a big event (the count starts again): { id, at, day }
        cheers: [],             // spectator reactions, kept for the log: { id, at, key, name, text, pts, gift }
        specKey: '',            // the newest reply the spectators already reacted to (one reaction per reply)
        roll: { key: '', sudden: false, hidden: false }, // the dice for the newest reply
        suddenRest: 0,          // replies left before another sudden quest may come
        sinceCheck: 0,          // AI replies since the last check (for "every 3rd")
        lastCheckKey: '',
    };
}

function fixRoom(r) {
    const base = newRoom();
    if (!r || typeof r !== 'object') return base;
    // 0.2.1: daily-life changes get their own log (seeded from the recent checks)
    if (!Array.isArray(r.lifeLog)) {
        r.lifeLog = (Array.isArray(r.checks) ? r.checks : []).filter(c => c && c.life && Object.keys(c.life).length)
            .map(c => ({ key: c.key, t: c.t, life: { ...c.life }, lifeFrom: { ...(c.lifeFrom || {}) } }));
    }
    for (const [k, v] of Object.entries(base)) if (r[k] === undefined || typeof r[k] !== typeof v || Array.isArray(v) !== Array.isArray(r[k])) r[k] = v;
    if (!Array.isArray(r.tutorial.done) || r.tutorial.done.length !== 4) r.tutorial.done = [false, false, false, false];
    if (!r.shop || typeof r.shop !== 'object') r.shop = base.shop;
    for (const k of ['standing', 'daily']) if (!Array.isArray(r.shop[k])) r.shop[k] = [];
    r.day = Math.max(1, Math.round(Number(r.day) || 1));
    if (r.goal !== null && (typeof r.goal !== 'object' || Array.isArray(r.goal))) r.goal = null;
    r.quests = r.quests.filter(q => q && typeof q === 'object');
    for (const q of r.quests) if (!['daily', 'sudden', 'hidden', 'goal', 'penalty'].includes(q.kind)) q.kind = 'daily';
    if (!DIFFS.includes(r.difficulty)) r.difficulty = 'off';
    if (!TONES.includes(r.tone)) r.tone = 'game';
    r.skills = r.skills.filter(x => x && typeof x === 'object' && x.id && x.name);
    // 0.4: gacha tickets kept from before say they open "in stage 2"
    for (const b of r.bag) if (b && b.kind === 'gacha' && /2단계|stage 2/i.test(String(b.desc || ''))) b.desc = /2단계/.test(b.desc) ? '한 번 뽑는다. 스킬이나 물건이 나온다. 엉뚱한 게 자주 나온다.' : 'One draw: a skill or an item. Often something odd.';
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
const isPhoneNow = () => typeof window !== 'undefined' && (Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 600);
const DEV_KEY = 'systemBlink.device';
export function device() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(DEV_KEY) || '{}') || {}; } catch { d = {}; }
    // 0.5.5: until the size is picked by hand, a phone starts small and a PC normal
    if (!d.sizePicked || !['small', 'normal'].includes(d.size)) d.size = isPhoneNow() ? 'small' : 'normal';
    if (!['dotted', 'solid'].includes(d.ring)) d.ring = 'dotted';
    if (!['hex', 'hexb', 'tab', 'badge'].includes(d.shape)) d.shape = 'hexb'; // 0.5.6; 0.5.8 default = the glass hexagon
    if (!d.pos || typeof d.pos !== 'object') d.pos = {};
    return d;
}
export function saveDevice(d) {
    try { localStorage.setItem(DEV_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
