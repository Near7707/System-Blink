// Side requests to the AI (never the main reply): the check after each reply, and making
// quests and shop items. A connection profile can be picked; otherwise the current API is used.

import { ctx, settings, room, currentChatId } from './store.js';
import { bus, chatView, lastReply, openQuests, condsOf, lifeNow, ownerName, langOf, rollFor, needsEveryCheck, diffOf, suddenLimitFor } from './engine.js';
import { questPool, standingDefaults, dailyPool } from './data.js';
import { ITEM_ICONS } from './icons.js';

export function getProfiles() {
    try { return (ctx().extensionSettings?.connectionManager?.profiles || []).filter(p => p && p.id); } catch { return []; }
}

// "What was sent": the last request of each kind, for the settings screen.
export const sentLog = { check: null, quests: null, shop: null, goal: null };

async function requestLLM(messages, { maxTokens = 500, signal } = {}) {
    const c = ctx();
    const st = settings();
    signal?.throwIfAborted();
    const content = (res) => (typeof res === 'string' ? res : String(res?.content ?? ''));
    const profile = st.profileId && getProfiles().some(p => p.id === st.profileId) ? st.profileId : '';
    if (profile) {
        const svc = c.ConnectionManagerRequestService;
        if (!svc) throw new Error('NO_PROFILE_API');
        return content(await svc.sendRequest(profile, messages, maxTokens, { stream: false, signal, extractData: true, includePreset: false, includeInstruct: true }));
    }
    const cc = c.ChatCompletionService;
    if (c.mainApi === 'openai' && cc?.presetToGeneratePayload && cc?.sendRequest) {
        const payload = await cc.presetToGeneratePayload({}, {}, {
            stream: false, messages, max_tokens: maxTokens,
            model: c.getChatCompletionModel?.(), chat_completion_source: c.chatCompletionSettings?.chat_completion_source,
        });
        signal?.throwIfAborted();
        return content(await cc.sendRequest(payload, true, signal));
    }
    const tc = c.TextCompletionService;
    if (c.mainApi === 'textgenerationwebui' && tc?.presetToGeneratePayload && tc?.sendRequest && tc?.constructPrompt) {
        const instruct = c.powerUserSettings?.instruct;
        const prompt = instruct?.enabled ? tc.constructPrompt(messages, instruct) : messages.map(m => m.content).join('\n\n');
        const payload = await tc.presetToGeneratePayload({}, {}, { stream: false, prompt, max_tokens: maxTokens, max_new_tokens: maxTokens });
        signal?.throwIfAborted();
        return content(await tc.sendRequest(payload, true, signal));
    }
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    const prompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
    const result = await c.generateRaw({ systemPrompt, prompt, responseLength: maxTokens });
    signal?.throwIfAborted();
    return content(result);
}

/** Remove thinking parts. */
export function cleanAnswer(raw) {
    let s = String(raw || '');
    s = s.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/^[\s\S]*<\/(think|thinking|reasoning)>/i, '');
    s = s.replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '');
    return s.trim();
}

/** The story text only: other extensions' info blocks / trackers / code blocks are left out. */
export function storyOnly(text) {
    let s = String(text || '');
    s = s.replace(/```[\s\S]*?```/g, ' ');
    s = s.replace(/<details[\s\S]*?<\/details>/gi, ' ');
    s = s.replace(/<(div|table|section|aside|style|script)\b[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<[^>]+>/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

const LANG_NAME = { en: 'English', ko: 'Korean' };

function line(m) {
    return `${m.name || (m.is_user ? 'User' : 'Character')}: ${storyOnly(m.mes).slice(0, 1500)}`;
}

function background() {
    const c = ctx();
    const r = room();
    const parts = [];
    try {
        const ch = c.characters?.[c.characterId];
        const desc = String(ch?.description || '').replace(/\s+/g, ' ').slice(0, 700);
        if (ch?.name) parts.push(`Character: ${ch.name}${desc ? ` — ${desc}` : ''}`);
    } catch { /* ignore */ }
    parts.push(`The System's user: ${ownerName(r)}`);
    if (r?.world) parts.push(`WORLD NOTE (must follow): ${r.world.slice(0, 800)}`);
    const recent = (chatView().list || []).filter(m => m && !m.is_system).slice(-6).map(line);
    if (recent.length) parts.push(`Recent story:\n${recent.join('\n')}`);
    return parts.join('\n\n');
}

function looseJson(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// ---------- making quests and shop items ----------

// How hard quests are (2-B). The mood still comes from the story; this is only how much it asks.
export const DIFF_HINT = {
    easy: 'DIFFICULTY Easy: something that can be done right away, in the current scene, with almost no effort.',
    normal: 'DIFFICULTY Normal: it takes a little moving or effort.',
    hard: 'DIFFICULTY Hard: the character has to set up a situation first to do it.',
    hell: 'DIFFICULTY Hell: it takes risk or courage.',
};

async function makeQuests({ count = 3, avoid = [], diff = 'off', penalty = false }, signal) {
    const s = settings();
    const lang = langOf();
    const many = diff === 'hard' ? 'Each quest has exactly 2 conditions in "conds": two short actions, each easy to check on its own; "name" is a short title for both. '
        : diff === 'hell' ? 'Each quest has 2 or 3 conditions in "conds": short actions, each easy to check on its own; "name" is a short title for them. '
        : 'No conditions: "conds" is []. ';
    const system = 'You write daily quests for a game-like "System" in a roleplay, in the style of Korean system novels. '
        + 'Each quest is a small action the user\'s character can do in the story today, fitting their current situation. '
        + 'Match the MOOD of the world and the recent story: bleak, hopeless or grim stories get grim, tense quests/items; light everyday comedy gets light, funny ones; romance gets warm ones. ' 
        + 'Write each quest as ONE short sentence that is easy to check from the story text (an action that either happened or not), '
        + 'like "Buy someone a drink" — never vague ones like "Be kind". Follow the WORLD NOTE if there is one. '
        + many
        + (penalty ? 'Also write ONE penalty quest in "penalty": a small, unpleasant but harmless chore or duty that fits the story, easy to check from the story text. ' : '')
        + `Reply with JSON only: {"quests":[{"name":"...","conds":[],"reward":10}]${penalty ? ',"penalty":{"name":"..."}' : ''}}. reward is 10, 15, 20, 25 or 30 (harder = more).`;
    const parts = [background()];
    if (DIFF_HINT[diff]) parts.push(DIFF_HINT[diff]);
    if (s.useDefaults) parts.push(`You may pick from or adapt these (only ones that fit the world):\n${questPool(lang, s.oddities).map(q => `- ${q.name} (${q.reward})`).join('\n')}`);
    if (s.oddities) parts.push('One of them may be a little odd or funny, if it fits.');
    if (avoid.length) parts.push(`Do not repeat: ${avoid.join('; ')}`);
    parts.push(`Make exactly ${count}. Write the names in ${LANG_NAME[lang]}.`);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
    sentLog.quests = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 500, signal });
    sentLog.quests.answer = raw;
    const j = looseJson(cleanAnswer(raw));
    const list = Array.isArray(j?.quests) ? j.quests.filter(q => q && typeof q.name === 'string' && q.name.trim()) : [];
    if (!list.length) throw new Error('BAD_ANSWER');
    const pen = typeof j?.penalty?.name === 'string' && j.penalty.name.trim() ? { name: j.penalty.name.trim() } : null;
    return { quests: list.map(q => ({ ...q, conds: Array.isArray(q.conds) ? q.conds.map(String) : [] })), penalty: pen };
}

async function makeShop({ count = 4, kind = 'daily' }, signal) {
    const s = settings();
    const lang = langOf();
    const system = 'You stock a personal shop for a game-like "System" in a roleplay, in the style of Korean system novels. '
        + 'Items are small magical or everyday things the user can buy with points and use in the story. '
        + 'No stat boosts, no numbers in effects. Follow the WORLD NOTE if there is one. '
        + 'Match the MOOD of the world and the recent story: bleak, hopeless or grim stories get grim, tense quests/items; light everyday comedy gets light, funny ones; romance gets warm ones. ' 
        + 'Rarity and price: common 20-80, rare 100-200, epic 300-500, legendary 800-1500 (legendary only rarely, at most one). '
        + `icon is one of: ${ITEM_ICONS.join(', ')}. `
        + 'Reply with JSON only: {"items":[{"name":"...","desc":"one short sentence","rarity":"common|rare|epic|legendary","price":50,"icon":"box","limited":false}]}.';
    const parts = [background()];
    if (s.useDefaults) {
        const pool = kind === 'daily' ? dailyPool(lang) : standingDefaults(lang).filter(x => x.kind === 'item');
        parts.push(`Examples you may pick from or adapt (only ones that fit the world):\n${pool.filter(x => s.oddities || !x.odd).map(x => `- ${x.name}: ${x.desc} (${x.rarity})`).join('\n')}`);
    }
    parts.push(kind === 'daily'
        ? 'This is the DAILY shop: unusual and special things, mostly rare or better.'
        : 'This is the STANDING shop: useful everyday things, mostly common, a few rare.');
    if (s.oddities) parts.push('One item may be strange or funny (and marked "limited": true).');
    parts.push(`Make exactly ${count}. Write name and desc in ${LANG_NAME[lang]}.`);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
    sentLog.shop = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 900, signal });
    sentLog.shop.answer = raw;
    const j = looseJson(cleanAnswer(raw));
    const list = Array.isArray(j?.items) ? j.items.filter(x => x && typeof x.name === 'string' && x.name.trim()) : [];
    if (!list.length) throw new Error('BAD_ANSWER');
    return list.map(x => ({ ...x, icon: ITEM_ICONS.includes(x.icon) ? x.icon : 'box' }));
}

// ---------- the main goal ----------
const MOOD = 'Match the MOOD of the world and the recent story: bleak, hopeless or grim stories get grim, tense goals; light everyday comedy gets light, funny ones; romance gets warm ones. ';
const STEP_RULE = 'Each stage is ONE short sentence that is easy to check from the story text. A stage may have 2 conditions (each one short checkable sentence) when it needs two clear actions; otherwise none. ';

async function makeGoal(_opts, signal) {
    const lang = langOf();
    const system = 'You set ONE main goal for a game-like "System" in a roleplay, in the style of Korean system novels. '
        + 'The goal is a big aim for the user\'s character that fits the character card, the world and the story so far, reached in 3 or 4 stages. '
        + MOOD + 'Follow the WORLD NOTE if there is one. ' + STEP_RULE
        + 'Only write the FIRST stage now; later stages are made when the story gets there. '
        + 'Reply with JSON only: {"title":"...","total":4,"stage":{"name":"...","conds":["...","..."],"reward":100}}. conds may be []. reward 100-300.';
    const messages = [{ role: 'system', content: system }, { role: 'user', content: `${background()}\n\nWrite title and stage in ${LANG_NAME[lang]}.` }];
    sentLog.goal = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 400, signal });
    sentLog.goal.answer = raw;
    const j = looseJson(cleanAnswer(raw));
    if (!j?.title || !j?.stage?.name) throw new Error('BAD_ANSWER');
    return { title: String(j.title), total: Number(j.total) || 4, stage: { name: String(j.stage.name), conds: Array.isArray(j.stage.conds) ? j.stage.conds.map(String) : [], reward: Number(j.stage.reward) || 100 } };
}

async function makeStage({ title, done = [], index = 1, total = 4 }, signal) {
    const lang = langOf();
    const last = index + 1 >= total;
    const system = 'You write the NEXT stage of the main goal of a game-like "System" in a roleplay, in the style of Korean system novels. '
        + 'It must follow from where the story is NOW and lead toward the goal. ' + MOOD + 'Follow the WORLD NOTE if there is one. ' + STEP_RULE
        + 'Reply with JSON only: {"name":"...","conds":[],"reward":150}. reward 100-300 (later stages more).';
    const parts = [background(), `MAIN GOAL: ${title}`, `Stages cleared: ${done.map((d, i) => `${i + 1}. ${d}`).join(' / ') || '-'}`,
        `Write stage ${index + 1} of ${total}${last ? ' (the LAST one: reaching it completes the goal)' : ''}. Write it in ${LANG_NAME[lang]}.`];
    const messages = [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
    sentLog.goal = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 300, signal });
    sentLog.goal.answer = raw;
    const j = looseJson(cleanAnswer(raw));
    if (!j?.name) throw new Error('BAD_ANSWER');
    return { name: String(j.name), conds: Array.isArray(j.conds) ? j.conds.map(String) : [], reward: Number(j.reward) || 150 };
}

bus.ask = async (kind, opts) => {
    if (kind === 'quests') return makeQuests(opts);
    if (kind === 'goal') return makeGoal(opts);
    if (kind === 'stage') return makeStage(opts);
    if (kind === 'shop') return makeShop(opts);
    return null;
};

// ---------- the check after a reply ----------

let busy = null; // { chatId, key, ctl }
const tried = new Set();
const counted = new Set();
export function isChecking() { return !!busy && busy.chatId === currentChatId(); }
export function cancelCheck() { busy?.ctl.abort(); }

/**
 * One request after a finished AI reply. Asks together: which open quests were cleared,
 * did the daily-life fields change, did the story move to another day.
 * `force` = the "Check now" button (ignores how often).
 */
export async function runCheck({ force = false } = {}) {
    const s = settings();
    const chatId = currentChatId();
    const r = room(chatId);
    if (!s.enabled || !r?.on || busy) return null;
    const view = chatView();
    const last = lastReply(view);
    if (!last?.key) return null;
    const tag = `${chatId}|${last.key}`;
    const roll = rollFor(r, last.key);
    // a sudden quest that may come, or one whose time is running, needs this reply checked
    const must = roll.sudden || roll.hidden || needsEveryCheck(r, view);
    if (!force) {
        if (tried.has(tag) || r.checks.some(c => c.key === last.key)) return null;
        if (!must) {
            if (s.judgeEvery === 'manual') return null;
            if (s.judgeEvery === 'three') {
                if (!counted.has(tag)) { counted.add(tag); r.sinceCheck = (r.sinceCheck || 0) + 1; }
                if (r.sinceCheck < 3) return null;
            }
        }
    }
    const open = openQuests(r, view);
    if (!open.length && !r.lifeMode && !roll.sudden && !roll.hidden) return null;
    tried.add(tag);
    r.sinceCheck = 0;
    busy = { chatId, key: last.key, ctl: new AbortController() };
    bus.emit('change');
    let result = null;
    try {
        result = await askCheck(open, r, view, last, roll, busy.ctl.signal);
    } catch (e) {
        if (e?.name !== 'AbortError') { console.warn('[System Blink] check', e); bus.emit('checkFailed', e); }
    } finally { busy = null; }
    // the chat changed or the reply was re-rolled while waiting: drop it
    if (!result || currentChatId() !== chatId || lastReply()?.key !== last.key) { bus.emit('change'); return null; }
    return result;
}

const KIND_WORD = { daily: 'daily quest', sudden: 'sudden quest', hidden: 'hidden quest', goal: 'main goal stage', penalty: 'penalty quest' };

/** One line per quest — or one line per condition of a quest with several. */
export function checkLines(open) {
    const lines = [];
    for (const q of open) {
        const conds = condsOf(q);
        if (conds) conds.forEach((c, i) => lines.push({ q, cond: i, text: `${c} (condition ${i + 1} of ${KIND_WORD[q.kind] || 'quest'} "${q.name}")` }));
        else lines.push({ q, cond: null, text: q.kind === 'daily' ? q.name : `${q.name} (${KIND_WORD[q.kind]})` });
    }
    return lines;
}

async function askCheck(open, r, view, last, roll, signal) {
    const lang = langOf();
    const count = settings().judgeEvery === 'three' ? 6 : 3;
    const recent = view.list.slice(0, last.i + 1).filter(m => m && !m.is_system).slice(-count - 1);
    let from = recent.length - 1;
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].is_user) { from = i; break; }
    if (settings().judgeEvery === 'three') from = Math.max(0, recent.length - count);
    const life = lifeNow(r, view);
    const who = ownerName(r);
    const system = 'You are a careful referee for a game-like System in a roleplay. '
        + 'Use ONLY the story text. Ignore status blocks, info boxes, trackers and notes written by tools. '
        + 'Judge the NEW part; earlier lines are context. Say YES only when the NEW part clearly shows it happened, not when it is planned, hinted or imagined. '
        + 'Reply in exactly this line format and nothing else:\n'
        + 'Q1: YES - "<short quote from the story>"  or  Q1: NO   (one line per quest)\n'
        + 'TIME: <time of day now, 1-2 words, or ->\nWEATHER: <1-3 words, or ->\nPLACE: <1-4 words, or ->\nDATE: <story date if stated, or ->\n'
        + 'DAYS: <how many days passed from the start to the end of the NEW part: 0, 1, 2...> - "<short quote>"\nNEXT: <time of day at the end, or ->\n'
        + 'Only when asked, also:\nSUDDEN: <quest> | <reward>\nHIDDEN: <quest> | <reward> | <why it was found>   or   HIDDEN: -';
    const parts = [];
    if (from > 0) parts.push(`Earlier (context):\n${recent.slice(0, from).map(line).join('\n')}`);
    parts.push(`NEW:\n${recent.slice(from).map(line).join('\n')}`);
    parts.push(`Known before: time ${life.time || '?'}, weather ${life.weather || '?'}, place ${life.place || '?'}, date ${life.date || '?'}.`);
    const lines = checkLines(open);
    if (lines.length) parts.push(`Quests of ${who} — did ${who} do this in the NEW part?\n${lines.map((x, n) => `Q${n + 1}: ${x.text}`).join('\n')}`);
    else parts.push('There are no quests to check. Still answer TIME, WEATHER, PLACE, DATE, DAYS, NEXT.');
    if (roll.sudden || roll.hidden) {
        if (r.world) parts.push(`WORLD NOTE (must follow): ${r.world.slice(0, 600)}`);
        parts.push('For new quests: match the MOOD of the world and the story (grim stories get tense ones, comedy gets funny ones, romance warm ones). '
            + `Write each as ONE short sentence that is easy to check from the story text. ${who} must be able to do it. Write it in ${LANG_NAME[lang]}.`);
    }
    if (roll.sudden) {
        const limit = suddenLimitFor(r);
        const hint = DIFF_HINT[diffOf(r)];
        parts.push(`Also write SUDDEN: one sudden quest that fits exactly what is happening at the end of the NEW part, which ${who} could do within the next ${limit} ${limit === 1 ? 'reply' : 'replies'}. reward 30-100.${hint ? ` ${hint}` : ''}`);
    }
    if (roll.hidden) parts.push(`Also write HIDDEN: only if in the NEW part ${who} did something unusual, kind or curious by chance that could open a hidden quest (a bigger next step of that same thing). reward 50-200. "why" = what ${who} did, at most 12 words. If nothing fits, write HIDDEN: -`);
    parts.push(`Write TIME/WEATHER/PLACE/NEXT in ${LANG_NAME[lang]}. Quotes stay in the story's own language, at most 15 words. Use "-" when it did not change or is unknown.`);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
    sentLog.check = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 500, signal });
    sentLog.check.answer = raw;
    const text = cleanAnswer(raw);
    const parsed = parseCheck(text);
    if (!parsed.any) throw new Error('BAD_ANSWER');
    return {
        key: last.key,
        quests: lines.map((x, n) => ({ x, a: parsed.q[n + 1] })).filter(o => o.a?.yes).map(o => ({ questId: o.x.q.id, cond: o.x.cond, reason: o.a.reason })),
        life: parsed.life, days: parsed.days, dayReason: parsed.dayReason, nextTime: parsed.next,
        sudden: roll.sudden ? parsed.sudden : null, hidden: roll.hidden ? parsed.hidden : null,
    };
}

const unq = (s) => String(s || '').trim().replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim();
const field = (v) => { const x = unq(v); return !x || x === '-' || x === '?' || /^(none|unknown|n\/a|same)$/i.test(x) ? '' : x.slice(0, 40); };

export function parseCheck(text) {
    const out = { q: {}, life: {}, days: 0, dayReason: '', next: '', any: false, sudden: null, hidden: null };
    for (const raw of String(text || '').split('\n')) {
        const ln = raw.replace(/^[\s*\-#>]+/, '').replace(/\*\*/g, '');
        let m = /^Q(\d+)\s*[:：.)]\s*(YES|NO)\b\s*[-–—:,.]?\s*(.*)$/i.exec(ln);
        if (m) { out.any = true; out.q[Number(m[1])] = { yes: m[2].toUpperCase() === 'YES', reason: unq(m[3]).slice(0, 120) }; continue; }
        m = /^(TIME|WEATHER|PLACE|DATE|NEXT)\s*[:：]\s*(.*)$/i.exec(ln);
        if (m) {
            out.any = true;
            const k = m[1].toUpperCase();
            if (k === 'NEXT') out.next = field(m[2]);
            else out.life[k.toLowerCase()] = field(m[2]);
            continue;
        }
        m = /^(SUDDEN|HIDDEN)\s*[:：]\s*(.*)$/i.exec(ln);
        if (m) {
            const bits = m[2].split('|').map(unq);
            const name = bits[0] && bits[0] !== '-' && !/^(none|n\/a)$/i.test(bits[0]) ? bits[0].slice(0, 80) : '';
            if (name) out[m[1].toLowerCase()] = { name, reward: Number(String(bits[1] || '').replace(/[^\d]/g, '')) || 0, why: (bits[2] || '').slice(0, 120) };
            continue;
        }
        m = /^DAYS\s*[:：]\s*(\d+)\s*[-–—:,.]?\s*(.*)$/i.exec(ln);
        if (m) { out.any = true; out.days = Math.min(30, Number(m[1]) || 0); out.dayReason = unq(m[2]).slice(0, 120); }
    }
    for (const k of Object.keys(out.life)) if (!out.life[k]) delete out.life[k];
    return out;
}
