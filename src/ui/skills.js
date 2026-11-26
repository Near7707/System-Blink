// Skill pieces shared by the window, popups and the gacha (stage 2-C):
// grade colours, the honeycomb tile, the small hexagon badge.

import { t } from '../i18n.js';
import { esc } from './util.js';

/** F·E grey / D·C blue / B·A purple / S gold / SS pink. */
const BAND = { F: 'low', E: 'low', D: 'mid', C: 'mid', B: 'high', A: 'high', S: 's', SS: 'ss' };
export const gradeClass = (g) => `sblink-g-${BAND[g] || 'low'}`;
export const isTop = (g) => g === 'S' || g === 'SS';

const PTS = '45,3 87,27 87,77 45,101 3,77 3,27';

/** One honeycomb tile. Active = turning dashed ring, passive = quiet line, NEW = a sweep of light,
 *  a hidden effect still shut = "?" that glitches now and then, S·SS = light running round the edge. */
export function skillTile(k, { on = false, locked = false } = {}) {
    const cls = ['sblink-hex', gradeClass(k.grade), k.type === 'active' ? 'sblink-hex-active' : 'sblink-hex-passive'];
    if (k.fresh) cls.push('sblink-hex-new');
    if (isTop(k.grade)) cls.push('sblink-hex-top');
    if (on) cls.push('sblink-hex-on');
    return `<button type="button" class="${cls.join(' ')}" data-skill="${esc(k.id)}" aria-label="${esc(k.name)}">
      <span class="sblink-hexfill">${k.fresh ? '<span class="sblink-hexsweep"></span>' : ''}</span>
      <svg class="sblink-hexsvg" viewBox="0 0 90 104" aria-hidden="true"><polygon class="sblink-hexedge" points="${PTS}"/>${k.type === 'active' ? `<polygon class="sblink-hexring" points="${PTS}"/>` : ''}${isTop(k.grade) ? `<polygon class="sblink-hexflow" points="${PTS}"/>` : ''}</svg>
      <span class="sblink-hexin"><b class="sblink-hexgrade">${esc(k.grade)}</b><span class="sblink-hexname">${esc(k.name)}</span><span class="sblink-hextype">${esc(t(`skill_${k.type}`))}</span></span>
      ${k.fresh ? '<span class="sblink-hexnew">NEW</span>' : ''}
      ${locked ? '<span class="sblink-hexq">?</span>' : ''}
    </button>`;
}

export function blankTile() {
    return `<button type="button" class="sblink-hex sblink-hex-blank" data-act="skillBlank" aria-label="${esc(t('skill_blank'))}">
      <span class="sblink-hexfill"></span>
      <svg class="sblink-hexsvg" viewBox="0 0 90 104" aria-hidden="true"><polygon class="sblink-hexedge" points="${PTS}"/></svg>
      <span class="sblink-hexin"><b class="sblink-hexplus">+</b><span class="sblink-hextype">${esc(t('skill_blank'))}</span></span>
    </button>`;
}

/** Tiles in rows of 3 and 2 by turns, so the hexagons fit into each other. */
export function honeycomb(tiles) {
    const rows = [];
    let i = 0, three = true;
    while (i < tiles.length) {
        const n = three ? 3 : 2;
        const row = tiles.slice(i, i + n);
        // a short last row keeps its slots, so its tiles still sit between the ones above
        while (row.length < n) row.push('<span class="sblink-hex sblink-hex-gap" aria-hidden="true"></span>');
        rows.push(row); i += n; three = !three;
    }
    return `<div class="sblink-comb">${rows.map(r => `<div class="sblink-combrow">${r.join('')}</div>`).join('')}</div>`;
}

/** The flat hexagon badge with the grade letter. */
export const gradeBadge = (g, big = false) => `<span class="sblink-gbadge ${gradeClass(g)}${big ? ' sblink-gbadge-big' : ''}">${esc(g)}</span>`;

export const tag = (text, cls = '') => `<span class="sblink-stag ${cls}">${esc(text)}</span>`;
