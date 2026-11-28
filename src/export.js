// "Chat with the System log": the chat's messages in order, each followed by what the System did there
// (quest clears with their evidence, daily-life changes, sudden / hidden quests, item uses).
// Only makes a new file to download — the chat file itself is never touched.

import { t } from './i18n.js';
import { room, chatName, VERSION } from './store.js';
import { chatView, condsOf, rate, ownerName, questState, penaltyFor, warnFor } from './engine.js';

const time = (ms) => { try { return new Date(ms).toLocaleString(); } catch { return String(ms); } };

/** Everything the System did, grouped by message key, plus what belongs to no message. */
export function systemEvents(r = room(), view = chatView()) {
    const byKey = new Map();
    const loose = [];
    const add = (key, ev) => {
        if (key == null) { loose.push(ev); return; }
        if (!view.index.has(key)) return; // a re-rolled or deleted reply: not in this chat any more
        const a = byKey.get(key); if (a) a.push(ev); else byKey.set(key, [ev]);
    };
    if (!r) return { byKey, loose };
    const quests = new Map(r.quests.map(q => [q.id, q]));
    for (const e of r.ledger) {
        if (e.undone) continue;
        if (e.questId === 'tutorial') { loose.push({ type: 'tutorial', pts: e.pts, at: e.at }); continue; }
        if (e.questId === 'tutorial-boost') { loose.push({ type: 'boost', pts: e.pts, at: e.at }); continue; }
        if (e.questId === 'spectator') continue; // with the spectator reactions below
        const q = quests.get(e.questId);
        const conds = condsOf(q);
        add(e.key, {
            type: 'clear', kind: q?.kind || 'daily', quest: q?.name || '?', condition: conds && e.cond != null ? conds[e.cond] : null,
            pts: e.pts || 0, evidence: e.reason || '', byHand: !!e.byHand || e.key == null, at: e.at,
        });
    }
    for (const l of r.lifeLog || []) add(l.key, { type: 'life', life: { ...l.life }, from: { ...(l.lifeFrom || {}) }, at: l.t });
    for (const q of r.quests) {
        if (q.kind === 'sudden' && q.fromKey) add(q.fromKey, { type: 'sudden', quest: q.name, pts: rate(q.reward), answer: q.state || '', at: 0 });
        if (q.kind === 'hidden' && q.fromKey) add(q.fromKey, { type: 'hidden', quest: q.name, pts: rate(q.reward), why: q.why || '', at: 0 });
    }
    // 2-B: failures, debuffs, lost items
    for (const q of r.quests) {
        const pts = penaltyFor(q);
        const warn = warnFor(q);
        if (q.kind === 'sudden' && q.state === 'accepted' && questState(r, q, view).status === 'failed') {
            const k = [...(q.seen || [])].reverse().find(x => view.index.has(x));
            if (k) add(k, { type: 'fail', kind: 'sudden', quest: q.name, pts, warn, at: q.failAt || 0 });
        } else if (q.kind === 'sudden' && q.state === 'declined' && (pts || warn)) loose.push({ type: 'fail', kind: 'sudden', quest: q.name, pts, warn, declined: true, at: q.answeredAt || 0 });
        else if ((q.kind === 'daily' || q.kind === 'penalty') && q.failed && (q.failedAt || q.kind === 'penalty')) loose.push({ type: 'fail', kind: q.kind, quest: q.name, pts, warn, at: q.failedAt || 0 });
    }
    for (const d of r.debuffs || []) {
        const pq = d.questId && r.quests.find(x => x.id === d.questId);
        loose.push({ type: 'debuff', debuff: d.kind, day: d.day, lifted: !!(pq && questState(r, pq, view).status === 'done'), at: d.at });
    }
    for (const o of r.lost || []) loose.push({ type: 'lost', item: o.name, rarity: o.rarity, at: o.at });
    for (const n of r.notes) if (n.deliveredKey) add(n.deliveredKey, { type: 'note', text: n.text, at: n.at });
    for (const u of r.uses) add(u.key, u.kind === 'skill' ? { type: 'skillUse', skill: u.name, grade: u.grade, at: u.at } : { type: 'use', item: u.name, rarity: u.rarity, at: u.at });
    // 2-C: skills gained, gacha draws, hidden effects opened
    for (const k of r.skills || []) {
        loose.push({ type: 'skill', skill: k.name, grade: k.grade, skillType: k.type, from: k.star ? 'star' : k.from, at: k.at || 0 });
        if (k.hidden?.key) add(k.hidden.key, { type: 'unlock', skill: k.name, effect: k.hidden.effect, evidence: k.hidden.reason || '', at: k.hidden.at || 0 });
    }
    for (const d of r.draws || []) if (d.kind === 'item') loose.push({ type: 'draw', item: d.name, rarity: d.grade, at: d.at });
    for (const p of r.spend) loose.push(p.kind === 'restock' ? { type: 'restock', pts: p.pts, at: p.at } : { type: 'buy', item: p.what, pts: p.pts, at: p.at });
    // 2-D: spectators, warnings
    for (const c of r.cheers || []) add(c.key, { type: 'cheer', name: c.name, text: c.text, pts: c.pts || 0, gift: c.gift || '', star: c.tone === 'star', at: c.at });
    for (const b of r.bigs || []) loose.push({ type: 'big', day: b.day, at: b.at });
    for (const e of r.erases || []) loose.push({ type: 'erase', at: e.at });
    // 0.8.0 regression: a lost life under its reply; the end of each earlier life under its last message
    const c = r.cycle;
    if (c) {
        for (const d of c.deaths || []) add(d.key, { type: 'death', why: d.why, at: d.at });
        if (c.hide?.key) add(c.hide.key, { type: 'cycle', n: c.hide.n || c.n, at: 0 });
    }
    loose.sort((a, b) => (a.at || 0) - (b.at || 0));
    return { byKey, loose };
}

function line(ev) {
    switch (ev.type) {
        case 'clear': {
            const what = ev.condition ? `${ev.quest} · ${ev.condition}` : ev.quest;
            const head = ev.condition && !ev.pts ? t('log_cond') : 'CLEAR';
            return `${head} [${t(`log_kind_${ev.kind}`)}] ${what}${ev.pts ? ` +${ev.pts}P` : ''}${ev.byHand ? ` · ${t('by_hand')}` : ''}${ev.evidence ? ` · ${t('evidence')} "${ev.evidence}"` : ''}`;
        }
        case 'life': return `${t('life')}: ${Object.keys(ev.life).map(k => `${t(`life_${k}`)} ${ev.from[k] ? `${ev.from[k]} → ` : ''}${ev.life[k]}`).join(', ')}`;
        case 'sudden': return `${t('log_sudden')}: ${ev.quest} +${ev.pts}P${ev.answer ? ` (${t(`log_answer_${ev.answer}`)})` : ''}`;
        case 'hidden': return `${t('log_hidden')}: ${ev.quest} +${ev.pts}P${ev.why ? ` · ${ev.why}` : ''}`;
        case 'fail': return `FAILED [${t(`log_kind_${ev.kind}`)}] ${ev.quest}${ev.declined ? ` (${t('log_answer_declined')})` : ''}${ev.pts ? ` −${ev.pts}P` : ''}${ev.warn ? ` · ${t('log_warn')}` : ''}`;
        case 'cheer': return `${t(ev.star ? 'log_cheer_star' : 'log_cheer')}: ${ev.text}${ev.pts ? ` +${ev.pts}P` : ''}${ev.gift ? ` · ${t(ev.star ? 'skill_from_star' : 'skill_from_spectator')} [${ev.gift}]` : ''}`;
        case 'big': return `${t('log_big')} · ${t('day_n', { n: ev.day })}`;
        case 'erase': return t('log_erase');
        case 'debuff': return `${t('log_debuff')}: ${t('debuff_pricey')} · ${t('day_n', { n: ev.day })}${ev.lifted ? ` · ${t('log_lifted')}` : ''}`;
        case 'lost': return `${t('log_lost')}: ${ev.item}`;
        case 'note': return `${t('log_note')}: ${ev.text}`;
        case 'use': return t('used_x', { name: ev.item });
        case 'skillUse': return `${t('log_skill_used')}: [${ev.skill}] (${ev.grade})`;
        case 'skill': return `${t('log_skill_got')}: [${ev.skill}] (${ev.grade} · ${t(`skill_${ev.skillType}`)}) · ${t(`skill_from_${ev.from}`)}`;
        case 'draw': return `${t('log_draw')}: ${ev.item} (${t(`rarity_${ev.rarity}`)})`;
        case 'unlock': return `${t('log_unlock')}: [${ev.skill}] ${ev.effect}${ev.evidence ? ` · ${t('evidence')} "${ev.evidence}"` : ''}`;
        case 'buy': return `${t('bought', { name: ev.item })} −${ev.pts}P`;
        case 'restock': return `${t('restocked')} −${ev.pts}P`;
        case 'tutorial': return `${t('pop_tut_done')} +${ev.pts}P`;
        case 'boost': return `${t('toast_tut_boost')} +${ev.pts}P`;
        case 'death': return `${t('log_death')}${ev.why ? ` · "${ev.why}"` : ''}`;
        case 'cycle': return t('log_cycle', { n: ev.n });
        default: return '';
    }
}

export function buildLog(format = 'txt') {
    const r = room();
    const view = chatView();
    const { byKey, loose } = systemEvents(r, view);
    const chatId = chatName() || '';
    if (format === 'json') {
        return JSON.stringify({
            systemBlink: VERSION, chat: chatId, exportedAt: new Date().toISOString(), user: ownerName(r),
            messages: view.list.map((m, i) => ({
                index: i, name: m?.name || (m?.is_user ? 'User' : ''), isUser: !!m?.is_user, isSystem: !!m?.is_system,
                sendDate: m?.send_date ?? null, text: String(m?.mes ?? ''), system: byKey.get(view.keys[i]) || [],
            })),
            notInMessages: loose,
        }, null, 1);
    }
    const out = [`# ${chatId}`, `# System Blink ${VERSION} · ${time(Date.now())}`, ''];
    view.list.forEach((m, i) => {
        if (!m) return;
        out.push(`#${i} ${m.name || (m.is_user ? 'User' : '')}: ${String(m.mes ?? '')}`);
        for (const ev of byKey.get(view.keys[i]) || []) out.push(`    [SYS] ${line(ev)}`);
        out.push('');
    });
    if (loose.length) {
        out.push(`## ${t('log_loose')}`);
        for (const ev of loose) out.push(`[SYS] ${ev.at ? `${time(ev.at)} · ` : ''}${line(ev)}`);
    }
    return out.join('\n');
}

export function logFileName(format) {
    const id = String(chatName() || 'chat').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    return `${id} - System Blink.${format === 'json' ? 'json' : 'txt'}`;
}

