// Short lines for the main reply (no extra AI call). Only for the story reply itself —
// requests other extensions make in the background ("quiet") get nothing.

import { settings, room } from './store.js';
import { active, chatView, lastMine, lastReply, todays, questState, lifeNow, ownerName, goalNow, condsOf, suddenLeft, hiddenOpen, questsToTell, STORY_KIND } from './engine.js';

const CHANCE = {
    off: 'Just know about them; do not push them into the story.',
    some: 'When it fits the flow naturally, now and then let the story open a chance to do one (e.g. passing a café for a drink quest). Do not force it.',
    more: 'Often let the story open chances to do them, while keeping the story natural.',
};

/** For a quest with conditions: the ones still to do. */
function condsLeft(r, q, view) {
    const conds = condsOf(q);
    if (!conds) return '';
    const st = questState(r, q, view);
    const left = conds.filter((_, i) => !st.condDone?.[i]);
    return left.length ? ` (still to do: ${left.map(c => `"${c}"`).join(', ')})` : '';
}

export function buildPrompt(genType = 'normal') {
    const s = settings();
    const r = room();
    if (!active(r) || ['quiet'].includes(String(genType))) return { text: '', noteIds: [], tellIds: [] };
    const view = chatView();
    const who = ownerName(r);
    const lines = ['[System Blink — rules for this story]'];
    lines.push(s.visibility === 'all'
        ? `- ${who} has a game-like "System" (quests, points, a personal shop). People in this world know such Systems exist.`
        : `- ${who} has a game-like "System" (quests, points, a personal shop) that only ${who} can see and hear. Others do not notice it.`);
    const kind = String(genType);
    const tell = kind === 'impersonate' ? [] : questsToTell(r, view, kind === 'swipe' ? lastReply(view)?.key : null);
    lines.push(tell.length
        ? '- The extension shows point and shop notices itself and judges quests itself: apart from the quest lines asked for below, do not write System notices in the reply (no quest cleared, no rewards, no points). Keep writing any other status blocks (info blocks, trackers) as usual.'
        : '- The extension shows quest, point and shop notices itself: do not write such System notices in the reply. Keep writing any other status blocks (info blocks, trackers) as usual.');
    lines.push('- Points and bag items are managed by the extension. Do not give or take them in the story.');
    const open = todays(r).filter(q => questState(r, q, view).status === 'active');
    const extra = [];
    const g = r.goal ? goalNow(r, view) : null;
    if (g?.current) {
        const conds = condsOf(g.current);
        const st = questState(r, g.current, view);
        const left = conds ? conds.filter((_, i) => !st.condDone?.[i]) : null;
        extra.push(`- ${who}'s main goal: "${r.goal.title}". Stage ${g.done + 1} of ${g.total} now: "${g.current.name}"${left ? ` (still to do: ${left.map(c => `"${c}"`).join('; ')})` : ''}.`);
    }
    for (const q of r.quests) {
        if (q.kind === 'sudden' && questState(r, q, view).status === 'active') extra.push(`- ${who} accepted a sudden quest (${suddenLeft(q, view)} replies left): "${q.name}".`);
        if (q.kind === 'hidden' && questState(r, q, view).status === 'active') extra.push(`- ${who} found a hidden quest: "${q.name}".`);
        if (q.kind === 'penalty' && q.day === r.day && questState(r, q, view).status === 'active') extra.push(`- ${who} has a penalty quest from the System: "${q.name}".`);
    }
    const anyQuest = open.length + extra.length > 0;
    if (g?.complete) extra.push(`- ${who} has reached the main goal "${r.goal.title}".`);
    if (open.length) lines.push(`- ${who}'s quests today: ${open.map(q => `"${q.name}"${condsLeft(r, q, view)}`).join('; ')}.`);
    lines.push(...extra);
    if (anyQuest) {
        lines.push(`- ${CHANCE[s.questChance] || CHANCE.some}`);
        lines.push(`- Never do the quests for ${who}'s character. Only open chances; ${who} decides and acts.`);
    }
    const bag = r.bag.filter(b => b.count > 0 && b.kind === 'item');
    if (bag.length) lines.push(`- ${who} carries (from the System): ${bag.slice(0, 12).map(b => `${b.name}${b.count > 1 ? ` ×${b.count}` : ''}`).join(', ')}.`);
    if (r.title) lines.push(`- ${who}'s System title: "${r.title}".`);
    // passive skills are always on (in the order they were gained, so the lines stay the same from turn to turn)
    const passive = (r.skills || []).filter(k => k.type === 'passive').slice(0, 12);
    if (passive.length) {
        lines.push(`- ${who}'s System skills (always on): ${passive.map(k => `[${k.name} (${k.grade})] ${k.effect}${hiddenOpen(k, view) ? ` Hidden effect, now open: ${k.hidden.effect}` : ''}`).join(' / ')}`);
        lines.push('- Let these skills show now and then when they fit; do not force them.');
    }
    if (r.lifeMode && s.lifeToAI) {
        const l = lifeNow(r, view);
        const bits = [l.date && `date ${l.date}`, `day ${r.day}`, l.time && `time ${l.time}`, l.weather && `weather ${l.weather}`, l.place && `place ${l.place}`, l.plan && `plan for today: ${l.plan}`].filter(Boolean);
        lines.push(`- Now: ${bits.join(', ')}.`);
    }
    // item uses: tied to my last message (so a re-roll hears about them again), or not sent yet
    const mine = lastMine(view);
    const uses = r.uses.filter(u => u.kind === 'item' && (u.key == null || (mine && u.key === mine.key)));
    for (const u of uses) lines.push(`- Just now ${who} used the System item "${u.name}"${u.desc ? ` (${u.desc})` : ''}. Show its effect in the story.`);
    const used = r.uses.filter(u => u.kind === 'skill' && (u.key == null || (mine && u.key === mine.key)));
    for (const u of used) {
        const k = (r.skills || []).find(x => x.id === u.skillId);
        const eff = k ? `${k.effect}${hiddenOpen(k, view) ? ` ${k.hidden.effect}` : ''}` : (u.desc || '');
        lines.push(`- Just now ${who} used the System skill [${u.name} (${u.grade})]${eff ? `: ${eff}` : ''}. Show its effect in the story.`);
    }
    const notes = r.notes.filter(n => n.deliveredKey == null || !view.index.has(n.deliveredKey));
    for (const n of notes) lines.push(`- ${n.text}`);
    // 0.6.0: new quests show up in the story as exact lines; the extension draws them as System windows
    if (tell.length) {
        lines.push(`- New System quests appear before ${who}'s eyes now. Where ${who} would notice them in this reply (near the start is fine), copy each line below exactly, each on its own line with nothing else on it, then let ${who}'s character react naturally.${s.visibility === 'all' ? '' : ' Only ' + who + ' sees them; others do not.'} Do not change the wording, do not add rewards, and never write a quest as cleared.`);
        for (const q of tell) lines.push(`[SYS:QUEST] ${STORY_KIND[q.kind] || 'DAILY'} · ${String(q.name).replace(/[\r\n]+/g, ' ')}`);
    }
    return { text: lines.join('\n'), noteIds: notes.map(n => n.id), tellIds: tell.map(q => q.id) };
}
