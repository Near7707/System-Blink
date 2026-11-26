// Side requests to the AI (never the main reply): the check after each reply, and making
// quests and shop items. A connection profile can be picked; otherwise the current API is used.

import { ctx, settings, room, currentChatId } from './store.js';
import { bus, chatView, lastReply, todays, questState, lifeNow, ownerName, langOf } from './engine.js';
import { questPool, standingDefaults, dailyPool } from './data.js';
import { ITEM_ICONS } from './icons.js';

export function getProfiles() {
    try { return (ctx().extensionSettings?.connectionManager?.profiles || []).filter(p => p && p.id); } catch { return []; }
}

// "What was sent": the last request of each kind, for the settings screen.
export const sentLog = { check: null, quests: null, shop: null };

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

async function makeQuests({ count = 3, avoid = [] }, signal) {
    const s = settings();
    const lang = langOf();
    const system = 'You write daily quests for a game-like "System" in a roleplay, in the style of Korean system novels. '
        + 'Each quest is a small action the user\'s character can do in the story today, fitting their current situation. '
        + 'Match the MOOD of the world and the recent story: bleak, hopeless or grim stories get grim, tense quests/items; light everyday comedy gets light, funny ones; romance gets warm ones. ' 
        + 'Write each quest as ONE short sentence that is easy to check from the story text (an action that either happened or not), '
        + 'like "Buy someone a drink" — never vague ones like "Be kind". Follow the WORLD NOTE if there is one. '
        + 'Reply with JSON only: {"quests":[{"name":"...","reward":10}]}. reward is 10, 15, 20, 25 or 30 (harder = more).';
    const parts = [background()];
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
    return list;
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

bus.ask = async (kind, opts) => {
    if (kind === 'quests') return makeQuests(opts);
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
    if (!force) {
        if (tried.has(tag) || r.checks.some(c => c.key === last.key)) return null;
        if (s.judgeEvery === 'manual') return null;
        if (s.judgeEvery === 'three') {
            if (!counted.has(tag)) { counted.add(tag); r.sinceCheck = (r.sinceCheck || 0) + 1; }
            if (r.sinceCheck < 3) return null;
        }
    }
    const open = todays(r).filter(q => questState(r, q, view).status === 'active');
    if (!open.length && !r.lifeMode) return null;
    tried.add(tag);
    r.sinceCheck = 0;
    busy = { chatId, key: last.key, ctl: new AbortController() };
    bus.emit('change');
    let result = null;
    try {
        result = await askCheck(open, r, view, last, busy.ctl.signal);
    } catch (e) {
        if (e?.name !== 'AbortError') { console.warn('[System Blink] check', e); bus.emit('checkFailed', e); }
    } finally { busy = null; }
    // the chat changed or the reply was re-rolled while waiting: drop it
    if (!result || currentChatId() !== chatId || lastReply()?.key !== last.key) { bus.emit('change'); return null; }
    return result;
}

async function askCheck(open, r, view, last, signal) {
    const lang = langOf();
    const count = settings().judgeEvery === 'three' ? 6 : 3;
    const recent = view.list.slice(0, last.i + 1).filter(m => m && !m.is_system).slice(-count - 1);
    let from = recent.length - 1;
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].is_user) { from = i; break; }
    if (settings().judgeEvery === 'three') from = Math.max(0, recent.length - count);
    const life = lifeNow(r, view);
    const system = 'You are a careful referee for a game-like System in a roleplay. '
        + 'Use ONLY the story text. Ignore status blocks, info boxes, trackers and notes written by tools. '
        + 'Judge the NEW part; earlier lines are context. Say YES only when the NEW part clearly shows it happened, not when it is planned, hinted or imagined. '
        + 'Reply in exactly this line format and nothing else:\n'
        + 'Q1: YES - "<short quote from the story>"  or  Q1: NO   (one line per quest)\n'
        + 'TIME: <time of day now, 1-2 words, or ->\nWEATHER: <1-3 words, or ->\nPLACE: <1-4 words, or ->\nDATE: <story date if stated, or ->\n'
        + 'DAYS: <how many days passed from the start to the end of the NEW part: 0, 1, 2...> - "<short quote>"\nNEXT: <time of day at the end, or ->';
    const parts = [];
    if (from > 0) parts.push(`Earlier (context):\n${recent.slice(0, from).map(line).join('\n')}`);
    parts.push(`NEW:\n${recent.slice(from).map(line).join('\n')}`);
    parts.push(`Known before: time ${life.time || '?'}, weather ${life.weather || '?'}, place ${life.place || '?'}, date ${life.date || '?'}.`);
    if (open.length) parts.push(`Quests of ${ownerName(r)} — did ${ownerName(r)} do this in the NEW part?\n${open.map((q, n) => `Q${n + 1}: ${q.name}`).join('\n')}`);
    else parts.push('There are no quests to check. Still answer TIME, WEATHER, PLACE, DATE, DAYS, NEXT.');
    parts.push(`Write TIME/WEATHER/PLACE/NEXT in ${LANG_NAME[lang]}. Quotes stay in the story's own language, at most 15 words. Use "-" when it did not change or is unknown.`);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
    sentLog.check = { at: Date.now(), messages, answer: '' };
    const raw = await requestLLM(messages, { maxTokens: 400, signal });
    sentLog.check.answer = raw;
    const text = cleanAnswer(raw);
    const parsed = parseCheck(text);
    if (!parsed.any) throw new Error('BAD_ANSWER');
    return {
        key: last.key,
        quests: open.map((q, n) => ({ q, a: parsed.q[n + 1] })).filter(x => x.a?.yes).map(x => ({ questId: x.q.id, reason: x.a.reason })),
        life: parsed.life, days: parsed.days, dayReason: parsed.dayReason, nextTime: parsed.next,
    };
}

const unq = (s) => String(s || '').trim().replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim();
const field = (v) => { const x = unq(v); return !x || x === '-' || x === '?' || /^(none|unknown|n\/a|same)$/i.test(x) ? '' : x.slice(0, 40); };

export function parseCheck(text) {
    const out = { q: {}, life: {}, days: 0, dayReason: '', next: '', any: false };
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
        m = /^DAYS\s*[:：]\s*(\d+)\s*[-–—:,.]?\s*(.*)$/i.exec(ln);
        if (m) { out.any = true; out.days = Math.min(30, Number(m[1]) || 0); out.dayReason = unq(m[2]).slice(0, 120); }
    }
    for (const k of Object.keys(out.life)) if (!out.life[k]) delete out.life[k];
    return out;
}
