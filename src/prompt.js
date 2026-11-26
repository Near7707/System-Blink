// Short lines for the main reply (no extra AI call). Only for the story reply itself —
// requests other extensions make in the background ("quiet") get nothing.

import { settings, room } from './store.js';
import { active, chatView, lastMine, todays, questState, lifeNow, ownerName } from './engine.js';

const CHANCE = {
    off: 'Just know about them; do not push them into the story.',
    some: 'When it fits the flow naturally, now and then let the story open a chance to do one (e.g. passing a café for a drink quest). Do not force it.',
    more: 'Often let the story open chances to do them, while keeping the story natural.',
};

export function buildPrompt(genType = 'normal') {
    const s = settings();
    const r = room();
    if (!active(r) || ['quiet'].includes(String(genType))) return { text: '', noteIds: [] };
    const view = chatView();
    const who = ownerName(r);
    const lines = ['[System Blink — rules for this story]'];
    lines.push(s.visibility === 'all'
        ? `- ${who} has a game-like "System" (quests, points, a personal shop). People in this world know such Systems exist.`
        : `- ${who} has a game-like "System" (quests, points, a personal shop) that only ${who} can see and hear. Others do not notice it.`);
    lines.push('- The extension shows quest, point and shop notices itself: do not write such System notices in the reply. Keep writing any other status blocks (info blocks, trackers) as usual.');
    lines.push('- Points and bag items are managed by the extension. Do not give or take them in the story.');
    const open = todays(r).filter(q => questState(r, q, view).status === 'active');
    if (open.length) {
        lines.push(`- ${who}'s quests today: ${open.map(q => `"${q.name}"`).join('; ')}. ${CHANCE[s.questChance] || CHANCE.some}`);
        lines.push(`- Never do the quests for ${who}'s character. Only open chances; ${who} decides and acts.`);
    }
    const bag = r.bag.filter(b => b.count > 0 && b.kind === 'item');
    if (bag.length) lines.push(`- ${who} carries (from the System): ${bag.slice(0, 12).map(b => `${b.name}${b.count > 1 ? ` ×${b.count}` : ''}`).join(', ')}.`);
    if (r.title) lines.push(`- ${who}'s System title: "${r.title}".`);
    if (r.lifeMode && s.lifeToAI) {
        const l = lifeNow(r, view);
        const bits = [l.date && `date ${l.date}`, `day ${r.day}`, l.time && `time ${l.time}`, l.weather && `weather ${l.weather}`, l.place && `place ${l.place}`, l.plan && `plan for today: ${l.plan}`].filter(Boolean);
        lines.push(`- Now: ${bits.join(', ')}.`);
    }
    // item uses: tied to my last message (so a re-roll hears about them again), or not sent yet
    const mine = lastMine(view);
    const uses = r.uses.filter(u => u.kind === 'item' && (u.key == null || (mine && u.key === mine.key)));
    for (const u of uses) lines.push(`- Just now ${who} used the System item "${u.name}"${u.desc ? ` (${u.desc})` : ''}. Show its effect in the story.`);
    const notes = r.notes.filter(n => n.deliveredKey == null || !view.index.has(n.deliveredKey));
    for (const n of notes) lines.push(`- ${n.text}`);
    return { text: lines.join('\n'), noteIds: notes.map(n => n.id) };
}
