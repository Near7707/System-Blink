// Short lines for the main reply (no extra AI call). Only for the story reply itself —
// requests other extensions make in the background ("quiet") get nothing.
//
// 0.7.0: two parts. `rules` — sentences that stay the same from reply to reply (who has the System, what the
// extension manages; in genre mode the genre's rules) — go near the top of the prompt, like a lorebook entry, so
// the prompt cache keeps them. `text` — what changes (quests now, what just happened) — stays near the chat's end.

import { conf, room } from './store.js';
import {
    active, chatView, lastMine, todays, questState, lifeNow, ownerName, goalNow, condsOf, suddenLeft, hiddenOpen, questsToTell, STORY_KIND,
    genreSync, genreJustOff, noteDue, veiled,
} from './engine.js';

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

const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');

/** A quest is for the owner to do: no one else does it, not even turned around toward the owner. */
const noSwap = (who) => `- Other characters do not do a quest's action either, not even turned toward ${who} (if the quest is to ask someone something, no one asks ${who} that). Open a situation where ${who} could do it.`;

/** The lines that do not change from reply to reply (they only change with the chat's settings). */
function rulesFor(r, s, genre) {
    const who = ownerName(r);
    if (!genre) {
        return [
            '[System Blink — the System]',
            s.visibility === 'all'
                ? `- ${who} has a game-like "System" (quests, points, a personal shop). People in this world know such Systems exist.`
                : `- ${who} has a game-like "System" (quests, points, a personal shop) that only ${who} can see and hear. Others do not notice it.`,
            '- Points and bag items are managed by the extension. Do not give or take them in the story.',
            `- Never do the System's quests for ${who}'s character. Only open chances; ${who} decides and acts.`,
            noSwap(who),
        ].join('\n');
    }
    return [
        '[System Blink — genre: a System story]',
        `- This is a System story. ${who}'s System (quests, points, a personal shop, skills) is a core part of this world, not a side detail: it shapes what happens, and the story gives it the weight of the world's own rules.`,
        s.visibility === 'all'
            ? `- People in this world know such Systems exist. Those around ${who} can notice ${who}'s System windows and react to them too.`
            : `- Only ${who} can see and hear the System. Others do not notice it, though they may notice how ${who} reacts.`,
        `- At key moments a System window appears before ${who}. Write a System window only as an exact line the extension gives in its notes (a line starting with [SYS:), on its own line with nothing else on it, or as [SYS:CLEAR] for one of the listed quests that ${who} clearly finishes in the reply. Never invent other System windows, quests, rewards or points.`,
        `- When a window appears, the narration says plainly that it appears before ${who} — by name (or as "you" if the story speaks to ${who} that way), never as "someone" or "one person".`,
        `- ${who}'s own reactions, words and thoughts follow your usual rules for ${who}: if you do not write ${who}'s actions, leave them to ${who} — show the window reaching ${who} and keep the world and the others moving. Others react only to what they can notice.`,
        '- Points and bag items are managed by the extension. Do not give or take them in the story.',
        `- Never do the System's quests for ${who}'s character. Only open chances; ${who} decides and acts.`,
        noSwap(who),
    ].join('\n');
}

export function buildPrompt(genType = 'normal') {
    const s = conf();
    const r = room();
    if (!active(r) || ['quiet'].includes(String(genType))) return { rules: '', text: '', noteIds: [], tellIds: [] };
    const view = chatView();
    genreSync(r, view);
    const genre = !!s.genreMode;
    const who = ownerName(r);
    const lines = ['[System Blink — this reply]'];
    const kind = String(genType);
    // the reply being replaced (a swipe, or a regenerate — SillyTavern removes the old reply only after this) shows them again
    const lastMsg = view.list[view.length - 1];
    const redo = (kind === 'swipe' || kind === 'regenerate') && lastMsg && !lastMsg.is_user && !lastMsg.is_system ? view.keys[view.length - 1] : null;
    const tell = kind === 'impersonate' ? [] : questsToTell(r, view, redo);
    const wins = []; // exact System window lines for this reply (genre mode, or quest lines in a quiet chat)
    if (genre) lines.push('- Follow the System Blink genre rules above. Only the System window lines given here may be written; nothing else from the System.');
    else if (genreJustOff(r, view)) lines.push('- Genre mode is off now: do not write System windows or any line that starts with [SYS:, even though earlier replies have them. The extension shows the System on screen itself.');
    if (!genre) {
        lines.push(tell.length
            ? '- The extension shows point and shop notices itself and judges quests itself: apart from the quest lines asked for below, do not write System notices in the reply (no quest cleared, no rewards, no points). Keep writing any other status blocks (info blocks, trackers) as usual.'
            : '- The extension shows quest, point and shop notices itself: do not write such System notices in the reply. Keep writing any other status blocks (info blocks, trackers) as usual.');
    } else lines.push('- Keep writing any other status blocks (info blocks, trackers) as usual.');
    // quests the story knows (in genre mode, a hidden one being brought in now is told with its window below)
    const told = new Set(tell.map(q => q.id));
    const known = (q) => !veiled(r, q, view) || told.has(q.id);
    const open = todays(r).filter(q => questState(r, q, view).status === 'active' && known(q));
    const clearable = [...open];
    const extra = [];
    const g = r.goal ? goalNow(r, view) : null;
    if (g?.current && known(g.current)) {
        const conds = condsOf(g.current);
        const st = questState(r, g.current, view);
        const left = conds ? conds.filter((_, i) => !st.condDone?.[i]) : null;
        extra.push(`- ${who}'s main goal: "${r.goal.title}". Stage ${g.done + 1} of ${g.total} now: "${g.current.name}"${left ? ` (still to do: ${left.map(c => `"${c}"`).join('; ')})` : ''}.`);
        clearable.push(g.current);
    }
    for (const q of r.quests) {
        if (!known(q)) continue;
        const st = questState(r, q, view).status;
        if (q.kind === 'sudden' && st === 'active') { extra.push(`- ${who} accepted a sudden quest (${suddenLeft(q, view)} replies left): "${q.name}".`); clearable.push(q); }
        if (q.kind === 'hidden' && st === 'active') { extra.push(`- ${who} found a hidden quest: "${q.name}".`); clearable.push(q); }
        if (q.kind === 'penalty' && q.day === r.day && st === 'active') { extra.push(`- ${who} has a penalty quest from the System: "${q.name}".`); clearable.push(q); }
    }
    const anyQuest = open.length + extra.length > 0;
    if (g?.complete) extra.push(`- ${who} has reached the main goal "${r.goal.title}".`);
    if (open.length) lines.push(`- ${who}'s quests today: ${open.map(q => `"${q.name}"${condsLeft(r, q, view)}`).join('; ')}.`);
    lines.push(...extra);
    if (anyQuest) {
        lines.push(`- ${CHANCE[s.questChance] || CHANCE.some}`);
        lines.push(`- Never do the quests for ${who}'s character. Only open chances; ${who} decides and acts.`);
        lines.push(noSwap(who));
    }
    // 0.7.0 genre mode: a quest cleared in the reply gets its window right there (the extension still judges it)
    if (genre && clearable.length) {
        lines.push(`- If ${who} clearly finishes one of these quests in this reply (all of it), write [SYS:CLEAR] and the quest's name on its own line right at that moment, e.g. "[SYS:CLEAR] ${oneLine(clearable[0].name)}". Only when it is really done in this reply; never for anything else, never with rewards.`);
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
    if (r.lifeToAI !== false) {
        const l = lifeNow(r, view);
        const bits = [l.date && `date ${l.date}`, `day ${r.day}`, l.time && `time ${l.time}`, l.weather && `weather ${l.weather}`, l.place && `place ${l.place}`, l.plan && `plan for today: ${l.plan}`].filter(Boolean);
        lines.push(`- Now: ${bits.join(', ')}.`);
    }
    // item uses: tied to my last message (so a re-roll hears about them again), or not sent yet
    const mine = lastMine(view);
    const uses = r.uses.filter(u => u.kind === 'item' && (u.key == null || (mine && u.key === mine.key)));
    for (const u of uses) {
        lines.push(`- Just now ${who} used the System item "${u.name}"${u.desc ? ` (${u.desc})` : ''}. Show its effect in the story.`);
        if (genre) wins.push(`[SYS:NOTICE] ITEM · ${oneLine(u.name)}`);
    }
    const used = r.uses.filter(u => u.kind === 'skill' && (u.key == null || (mine && u.key === mine.key)));
    for (const u of used) {
        const k = (r.skills || []).find(x => x.id === u.skillId);
        const eff = k ? `${k.effect}${hiddenOpen(k, view) ? ` ${k.hidden.effect}` : ''}` : (u.desc || '');
        lines.push(`- Just now ${who} used the System skill [${u.name} (${u.grade})]${eff ? `: ${eff}` : ''}. Show its effect in the story.`);
        if (genre) wins.push(`[SYS:NOTICE] SKILL · ${oneLine(u.name)}`);
    }
    // one-time notes; 0.7.0: the reply being replaced does not count as having had them (a swipe hears them again)
    const notes = r.notes.filter(n => noteDue(n, view, redo));
    for (const n of notes) {
        const text = genre && n.gtext ? n.gtext : n.text;
        if (text) lines.push(`- ${text}`);
        if (genre && n.line) wins.push(n.line);
    }
    // 0.6.0: new quests show up in the story as exact lines; the extension draws them as System windows
    if (tell.length) {
        if (!genre) lines.push(`- New System quests appear before ${who}'s eyes now. At a fitting spot in this reply (near the start is fine), make clear they appear before ${who} — by name (or as "you" if the story speaks to ${who} that way), never "someone" or "one person" — and copy each line below exactly, each on its own line with nothing else on it, even if the story is in another language.${s.visibility === 'all' ? '' : ' Only ' + who + ' sees them; others do not.'} ${who}'s own reaction follows your usual rules for ${who} (if you do not write ${who}'s actions, leave it to ${who}). Do not change the wording, do not add rewards, and never write a quest as cleared.`);
        for (const q of tell) wins.push(`[SYS:QUEST] ${STORY_KIND[q.kind] || 'DAILY'} · ${oneLine(q.name)}`);
    }
    if (genre && wins.length) {
        lines.push(`- System windows appear before ${who} in this reply. Where they fit (near the start is fine), say they appear before ${who} (by name, never "someone"), and copy each line below exactly, each on its own line with nothing else on it, even if the story is in another language. Do not change the wording and do not add rewards.`);
    }
    lines.push(...(genre || tell.length ? wins : []));
    return { rules: rulesFor(r, s, genre), text: lines.join('\n'), noteIds: notes.map(n => n.id), tellIds: tell.map(q => q.id) };
}
