// System Blink data lives only in extension settings (never in character cards, chat files or chat metadata).
// The floating button's place, size and ring are kept per device (localStorage).

export const MODULE = 'systemBlink';
export const FORMAT = 2;
export const VERSION = '0.6.11';
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
    claimed: {},            // 0.6.11: a chat name from before 0.6.11 -> the chat (owner/name) that took its data
});

let ctxGetter = () => globalThis.SillyTavern?.getContext?.();
export function ctx() { return ctxGetter(); }

// 0.6.10: the saved settings are checked and fixed once (when first read, or when a new object is put in their
// place, e.g. by importing a backup) — not on every read, which went through every chat each time.
const checked = new WeakSet();
export function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = structuredClone(DEFAULTS);
    const s = all[MODULE];
    if (!checked.has(s)) { migrate(s); checked.add(s); }
    return s;
}

const ONE_OF = {
    tone: TONES, specMode: ['light', 'rich'], dayBasis: ['story', 'real'], judgeEvery: ['every', 'three', 'manual'],
    visibility: ['me', 'all'], questChance: ['off', 'some', 'more'], lang: ['en', 'ko'],
    suddenFreq: ['off', 'rare', 'normal', 'often'], goalSuggest: ['auto', 'manual', 'off'], toastPos: ['column', 'input', 'screen'],
};

/**
 * 0.6.8: settings a chat can keep for itself ("this chat only" switch). Kept in the chat's `own`
 * (null = follows the shared settings), so branching, backups and deleting a chat take it along.
 */
export const ROOM_KEYS = Object.freeze(['pointRate', 'dayBasis', 'judgeEvery', 'visibility', 'questChance',
    'suddenFreq', 'suddenRest', 'hiddenOn', 'storyQuest', 'goalAuto', 'specOn', 'specMode', 'specGift',
    'useDefaults', 'oddities', 'profileId']);

/**
 * The settings in force for a chat (a chat id or a chat's state; default the open chat): the chat's own
 * values over the shared ones. Writes go to the shared settings, as before — change a chat's own values
 * with setRoomSetting.
 */
export function conf(which = currentChatId()) {
    const s = settings();
    const r = which && typeof which === 'object' ? which : (which ? s.chats[which] : null);
    const own = r?.own;
    if (!own || typeof own !== 'object') return s;
    return new Proxy(s, { get: (t, k) => (typeof k === 'string' && ROOM_KEYS.includes(k) && own[k] !== undefined ? own[k] : t[k]) });
}

/** Switch "this chat only" on (copies the shared values now in force) or off (drops this chat's values). */
export function setRoomOwn(chatId, on) {
    const s = settings();
    const r = s.chats[chatId];
    if (!r) return;
    if (on) { if (!r.own) r.own = Object.fromEntries(ROOM_KEYS.map(k => [k, structuredClone(s[k])])); }
    else r.own = null;
    save();
}

export function setRoomSetting(chatId, k, v) {
    const r = settings().chats[chatId];
    if (!r?.own || !ROOM_KEYS.includes(k)) return false;
    r.own[k] = v;
    save();
    return true;
}

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
    for (const k of ['chats', 'branchDone', 'autoWake', 'claimed']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    if (typeof s.customShop !== 'string') s.customShop = '';
    if (typeof s.profileId !== 'string') s.profileId = '';
    // 0.6.9: "tell the AI the daily-life fields" became each chat's own: chats keep the shared value they had
    const toAI = s.lifeToAI !== false;
    for (const r of Object.values(s.chats)) if (r && typeof r === 'object' && typeof r.lifeToAI !== 'boolean') r.lifeToAI = r.own && typeof r.own.lifeToAI === 'boolean' ? r.own.lifeToAI : toAI;
    for (const id of Object.keys(s.chats)) s.chats[id] = fixRoom(s.chats[id]);
    return s;
}

export function newRoom() {
    return {
        on: false,              // the system is switched on in this chat
        own: null,              // 0.6.8: this chat's own settings ("this chat only"), null = follows the shared ones
        lifeMode: true,         // daily-life mode (always on since 0.6.9)
        lifeToAI: true,         // 0.6.9: tell the story AI the daily-life fields (each chat its own; off where an info block does it)
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
    r.lifeMode = true;   // 0.6.9: always on
    if (r.own !== null && (typeof r.own !== 'object' || Array.isArray(r.own))) r.own = null;
    if (r.own) fixOwn(r.own);
    r.skills = r.skills.filter(x => x && typeof x === 'object' && x.id && x.name);
    // 0.4: gacha tickets kept from before say they open "in stage 2"
    for (const b of r.bag) if (b && b.kind === 'gacha' && /2단계|stage 2/i.test(String(b.desc || ''))) b.desc = /2단계/.test(b.desc) ? '한 번 뽑는다. 스킬이나 물건이 나온다. 엉뚱한 게 자주 나온다.' : 'One draw: a skill or an item. Often something odd.';
    return r;
}

/** A chat's own settings: odd values dropped (the shared value is used for them). */
function fixOwn(o) {
    for (const k of Object.keys(o)) if (!ROOM_KEYS.includes(k)) delete o[k];
    for (const [k, list] of Object.entries(ONE_OF)) if (k in o && !list.includes(o[k])) delete o[k];
    if ('pointRate' in o && ![0.5, 1, 2].includes(Number(o.pointRate))) delete o.pointRate;
    if ('suddenRest' in o && ![3, 5, 10].includes(Number(o.suddenRest))) delete o.suddenRest;
    for (const k of ['pointRate', 'suddenRest']) if (k in o) o[k] = Number(o[k]);
    if ('profileId' in o && typeof o.profileId !== 'string') delete o.profileId;
    for (const k of ['hiddenOn', 'storyQuest', 'goalAuto', 'specOn', 'specGift', 'useDefaults', 'oddities']) if (k in o && typeof o[k] !== 'boolean') delete o[k];
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

// ---------- which chat (0.6.11) ----------
// A character chat's id is its file name, and two characters can have chats with the same name. So a chat's
// data is kept under "owner/name": owner = c:<character card file> or g:<group id>. Data saved before 0.6.11
// is under the bare name (no "/"): it is given to the chat it belongs to when that chat is opened (settleRoom).

/** c:<card file> for a character, g:<group id> for a group, or null. */
export function ownerKey() {
    try {
        const c = ctx();
        if (c.groupId) return `g:${c.groupId}`;
        const ch = c.characters?.[c.characterId];
        return ch?.avatar ? `c:${ch.avatar}` : null;
    } catch { return null; }
}

/** The open chat's own name (SillyTavern's id), for showing; null outside a chat. */
export function chatName() {
    try {
        const c = ctx();
        if (c.characterId === undefined && !c.groupId) return null;
        const id = c.getCurrentChatId?.();
        return id ? String(id) : null;
    } catch { return null; }
}

export const roomKey = (owner, name) => `${owner}/${name}`;
// 0.6.11: a copy made by itself just now, on opening a chat (a branch's parent, a shared chat). When SillyTavern renames
// a chat it opens it under the new name first (copying may happen there), then says it was renamed — the renamed
// chat's own data may then go there in place of that copy.
let madeNow = '';
// like SillyTavern's server, which drops these from a new chat name (sanitize-filename)
const cleanName = (n) => String(n).replace(/[\/?<>\\:*|"]/g, '').replace(/[\x00-\x1f\x80-\x9f]/g, '');
const nameOf = (key) => String(key).slice(String(key).indexOf('/') + 1);

/** The open chat's key (owner/name), or null. */
export function currentChatId() {
    const name = chatName();
    const owner = name && ownerKey();
    return owner ? roomKey(owner, name) : null;
}

/** Every message key a chat's data points at (its replies, my messages). */
function keysOf(r) {
    const out = [r.lastCheckKey, r.specKey, r.roll?.key];
    for (const c of r.checks || []) out.push(c?.key);
    for (const l of r.ledger || []) out.push(l?.key);
    for (const l of r.lifeLog || []) out.push(l?.key);
    for (const u of r.uses || []) out.push(u?.key);
    for (const n of r.notes || []) out.push(n?.deliveredKey);
    for (const c of r.cheers || []) out.push(c?.key);
    for (const k of r.skills || []) out.push(k?.hidden?.key);
    for (const q of r.quests || []) out.push(q?.fromKey, q?.acceptKey, ...(q?.toldKeys || []), ...(q?.seen || []));
    return out.filter(k => typeof k === 'string' && k);
}

/** Does this data belong to the open chat? (Some of its message keys are in it.) */
function partOfOpenChat(r, msgKeyOf) {
    const keys = keysOf(r);
    if (!keys.length) return null; // nothing to tell by
    const mine = new Set((ctx().chat || []).map(msgKeyOf));
    return keys.some(k => mine.has(k));
}

/**
 * 0.6.11: the open chat (once loaded) takes its data saved before 0.6.11 under its bare name:
 * - that data, if its messages are in this chat (or it has none to tell by): moved over;
 * - data another character's chat of the same name already took, if its messages are in this chat too
 *   (the two chats shared it): this chat gets its own copy.
 * Anything else stays where it is. Run when a chat is opened (after it is loaded). Returns true if it changed.
 */
export function settleRoom(msgKeyOf) {
    madeNow = '';
    const s = settings();
    const key = currentChatId();
    if (!key || s.chats[key]) return false;
    const name = nameOf(key);
    const c = ctx();
    if (!Array.isArray(c.chat) || !c.chat.length) return false;
    const old = s.chats[name];
    if (old && typeof old === 'object') {
        if (partOfOpenChat(old, msgKeyOf) === false) return false;
        s.chats[key] = old;
        delete s.chats[name];
        s.claimed[name] = key;
        for (const [k, v] of Object.entries(s.branchDone)) if (v === name) s.branchDone[k] = key;
        if (s.branchDone[name]) { s.branchDone[key] = s.branchDone[name]; delete s.branchDone[name]; }
        save();
        return true;
    }
    const took = s.claimed[name];
    const other = took && took !== key ? s.chats[took] : null;
    if (other && partOfOpenChat(other, msgKeyOf) === true) {
        s.chats[key] = fixRoom(structuredClone(other));
        madeNow = key;
        save();
        return true;
    }
    return false;
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

/**
 * A chat was renamed. Its data follows it — never over data already under the new name (both are kept), except a
 * copy made by itself a moment ago when SillyTavern opened the renamed chat (see `madeNow`).
 * `owner` from the event (the character card / group). `openName`: the renamed chat's real new name when it is the
 * open chat (SillyTavern's server may have cleaned up the name asked for); otherwise cleaned up here the same way.
 * Data from before 0.6.11 (bare name) of a chat not opened since follows by name.
 * Returns 'moved', 'blocked' (something already there; nothing changed) or ''.
 */
export function onChatRenamed(oldName, newName, owner = ownerKey(), openName = null) {
    const s = settings();
    const a = stripExt(oldName), b = openName || cleanName(stripExt(newName).trim());
    if (!a || !b || a === b) return '';
    let from = owner ? roomKey(owner, a) : '', to = owner ? roomKey(owner, b) : '';
    if (!from || !s.chats[from]) {
        // the open chat had no data of its own: the bare name's data is someone else's
        if (openName || !s.chats[a]) return '';
        from = a; to = b; // not opened since 0.6.11: stays under the bare name
    }
    if (s.chats[to]) {
        if (madeNow !== to) return 'blocked';
        delete s.chats[to]; // only the copy made on opening it under the new name
        delete s.branchDone[to];
    }
    madeNow = '';
    s.chats[to] = s.chats[from];
    delete s.chats[from];
    for (const [k, v] of Object.entries(s.branchDone)) if (v === from) s.branchDone[k] = to;
    if (s.branchDone[from]) { s.branchDone[to] = s.branchDone[from]; delete s.branchDone[from]; }
    for (const [k, v] of Object.entries(s.claimed)) if (v === from) s.claimed[k] = to;
    save();
    return 'moved';
}

/**
 * 0.6.11: a character was renamed — SillyTavern gives it a new card file, so its chats' data moves to the new
 * owner. Never over data already there (that one is kept where it is). Returns how many chats moved.
 */
export function onCharRenamed(oldAvatar, newAvatar) {
    const s = settings();
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return 0;
    const from = `c:${oldAvatar}/`, to = `c:${newAvatar}/`;
    const moved = {}; // old key -> new key, only for chats really moved
    for (const key of Object.keys(s.chats)) {
        if (!key.startsWith(from)) continue;
        const nk = to + key.slice(from.length);
        if (s.chats[nk]) continue;
        s.chats[nk] = s.chats[key];
        delete s.chats[key];
        moved[key] = nk;
    }
    const n = Object.keys(moved).length;
    const swap = (k) => moved[k] || k;
    if (n) {
        const bd = {};
        for (const [k, v] of Object.entries(s.branchDone)) bd[swap(k)] = swap(v);
        s.branchDone = bd;
        for (const k of Object.keys(s.claimed)) s.claimed[k] = swap(s.claimed[k]);
    }
    // "wake new chats" belongs to the character, whether or not any chat moved
    const ok = `c:${oldAvatar}`, nk = `c:${newAvatar}`;
    let woke = false;
    if (s.autoWake[ok] !== undefined) { if (s.autoWake[nk] === undefined) s.autoWake[nk] = s.autoWake[ok]; delete s.autoWake[ok]; woke = true; }
    if (n || woke) save();
    return n;
}

/**
 * A chat was deleted. SillyTavern only says its name (not whose), so each chat of that name is dropped only
 * when its owner is known to have no chat of that name any more. When unsure, the data is kept.
 * `stillThere(owner, name)` → true / false / null (could not tell).
 */
export async function onChatDeleted(name, stillThere) {
    const s = settings();
    const id = stripExt(name);
    if (!id) return 0;
    let n = 0;
    for (const key of Object.keys(s.chats)) {
        if (!key.includes('/') || nameOf(key) !== id) continue;
        const owner = key.slice(0, key.indexOf('/'));
        let there = null;
        try { there = await stillThere(owner, id); } catch { there = null; }
        if (there !== false || !s.chats[key]) continue;
        delete s.chats[key];
        delete s.branchDone[key];
        for (const [k, v] of Object.entries(s.claimed)) if (v === key) delete s.claimed[k];
        n++;
    }
    if (n) save();
    return n;
}

/** A new branch chat starts with a copy of its parent's system (points, bag, quests, tutorial). */
export function copyFromParent(msgKeyOf) {
    const s = settings();
    const id = currentChatId();
    if (!id || s.chats[id] || s.branchDone[id] || s.branchDone[nameOf(id)]) return false;
    let parent = '';
    try { parent = stripExt(ctx().chatMetadata?.main_chat || ''); } catch { /* ignore */ }
    if (!parent || parent === nameOf(id)) return false;
    // the parent is the same character's chat; data from before 0.6.11 under its bare name counts if its messages are here
    let from = roomKey(id.slice(0, id.indexOf('/')), parent);
    if (!s.chats[from]) {
        if (s.chats[parent] && msgKeyOf && partOfOpenChat(s.chats[parent], msgKeyOf) === true) from = parent;
        else return false;
    }
    s.chats[id] = fixRoom(structuredClone(s.chats[from]));
    s.branchDone[id] = from;
    madeNow = id;
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
