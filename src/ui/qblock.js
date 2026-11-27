// 0.6.0 Quest lines in the story. The AI writes "[SYS:QUEST] DAILY · name" lines; on screen they are
// drawn as small System windows inside the message. The message text itself is never changed: when
// SillyTavern draws the message again the plain lines come back and are drawn again.

import { t, lang } from '../i18n.js';
import { room } from '../store.js';
import { toneOf, rate, warnFor } from '../engine.js';
import { specNames, starWho } from '../data.js';
import { esc } from './util.js';

const RE = /\[SYS:QUEST\]\s*([A-Za-z]+)\s*[·•:|\-–—]?\s*([^\n[]*)/gi;
const KINDS = { DAILY: 'daily', SUDDEN: 'sudden', HIDDEN: 'hidden', MAIN: 'goal', GOAL: 'goal', PENALTY: 'penalty' };
const CODE = { game: 'SYS.NOTICE', star: 'SYS.STAR', threat: 'SYS.ALERT' };
const DAILY_TAG = { game: 'DAILY', star: 'SCENARIO', threat: 'WARNING' };
const TAG = { sudden: 'SUDDEN', hidden: 'HIDDEN', goal: 'MAIN', penalty: 'PENALTY' };

let openTab = () => {};
export function setQBlockHooks(h) { if (h?.openTab) openTab = h.openTab; }

const norm = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,!?~·*_()[\]「」『』-]/g, '');
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** The quest a line names: same kind, same name (or one inside the other); the newest wins. */
function findQuest(r, kind, name) {
    const n = norm(name);
    if (!n || !r?.quests) return null;
    const list = r.quests.filter(q => q.kind === kind);
    for (let i = list.length - 1; i >= 0; i--) if (norm(list[i].name) === n) return list[i];
    for (let i = list.length - 1; i >= 0; i--) { const m = norm(list[i].name); if (m && (m.includes(n) || n.includes(m))) return list[i]; }
    return null;
}

/** 1. Each [SYS:QUEST] text becomes a marker span. */
function markLines(textEl) {
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue.includes('[SYS:QUEST]') && !n.parentElement?.closest('.sblink-qblock') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(text))) {
            const kind = KINDS[m[1].toUpperCase()];
            if (!kind) continue;
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const span = document.createElement('span');
            span.className = 'sblink-qline';
            span.dataset.kind = kind;
            span.dataset.name = m[2].trim();
            span.dataset.raw = m[0].trim();
            span.textContent = m[0];
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if (!last) continue;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    }
}

const blank = (n) => n && ((n.nodeType === 3 && !n.nodeValue.trim()) || n.nodeName === 'BR');
/** A line alone in its own paragraph (blank lines between the lines) stands for the paragraph. */
function rootOf(el) {
    const p = el.parentElement;
    if (p && p.nodeName === 'P' && !p.classList.contains('mes_text') && [...p.childNodes].every(n => n === el || blank(n))) return p;
    return el;
}
function lineIn(n) {
    if (n?.nodeType !== 1) return null;
    if (n.classList.contains('sblink-qline')) return n;
    if (n.nodeName === 'P') { const q = n.querySelector(':scope > span.sblink-qline'); if (q && rootOf(q) === n) return q; }
    return null;
}
function nextLine(el) {
    let n = rootOf(el).nextSibling;
    while (blank(n)) n = n.nextSibling;
    return lineIn(n);
}

/** 2. Markers next to each other: daily ones share one window, the rest get one each. */
function groups(textEl) {
    const out = [];
    const used = new Set();
    for (const el of textEl.querySelectorAll('span.sblink-qline')) {
        if (used.has(el)) continue;
        const g = [el];
        used.add(el);
        if (el.dataset.kind === 'daily') {
            let n = nextLine(el);
            while (n && n.dataset.kind === 'daily') { g.push(n); used.add(n); n = nextLine(n); }
        }
        out.push(g);
    }
    return out;
}

function blockHtml(r, kind, items, key) {
    const quests = items.map(x => findQuest(r, kind, x.name));
    const q0 = quests.find(Boolean);
    const tone = (q0?.tone) || toneOf(r);
    const pts = (q) => {
        if (!q || q.kind === 'penalty' || !q.reward) return '';
        const n = rate(q.reward);
        return tone === 'star' ? t('pts_star', { pts: n }) : `+${n}P`;
    };
    const rows = items.map((x, i) => `<div class="sblink-qbrow"><span class="sblink-qbdia">◆</span><span class="sblink-qbname">${esc(quests[i]?.name || x.name)}</span><b class="sblink-qbpts">${esc(pts(quests[i]))}</b></div>`).join('');
    let meta = '';
    if (kind === 'daily') {
        if (tone === 'star') {
            const names = specNames(lang(), 'star');
            const n = names[hash(String(key || '') + items[0].name) % names.length];
            meta = t('star_expect', { name: starWho(n, lang(), () => (hash(n) % 2) / 2) });
        } else if (tone === 'threat' && quests.some(q => warnFor(q))) meta = t('qb_threat_warn');
    } else if (kind === 'sudden' && q0?.limit) meta = t('limit_replies', { n: q0.limit });
    else if (kind === 'hidden' && q0?.why) meta = `${t('found_why')} · ${q0.why}`;
    else if (kind === 'goal' && q0 && r.goal && q0.goalId === r.goal.id) {
        const total = Number(r.goal.total) || 1;
        const at = (Number(q0.stage) || 0) + 1;
        meta = `<div class="sblink-qbbar">${Array.from({ length: total }, (_, i) => `<i class="${i < at - 1 ? 'sblink-on' : i === at - 1 ? 'sblink-now' : ''}"></i>`).join('')}</div>`
            + `<div>${esc(t('qb_stage', { title: r.goal.title, n: at, total }))}</div>`;
    } else if (kind === 'penalty') meta = t('qb_penalty_meta');
    const metaHtml = meta ? `<div class="sblink-qbmeta">${kind === 'goal' ? meta : esc(meta)}</div>` : '';
    const tag = kind === 'daily' ? DAILY_TAG[tone] : TAG[kind];
    const code = `${CODE[tone] || CODE.game} // ${kind === 'goal' ? 'GOAL' : kind.toUpperCase()}`;
    return {
        tone,
        html: `<div class="sblink-qbhead"><span class="sblink-qbtag">${tag}</span><span class="sblink-qbcode">${code}</span></div>
<div class="sblink-qbtitle">${esc(t(`qb_${kind}_${tone}`))}</div>${rows}${metaHtml}`,
    };
}

/** Draw the windows in one AI message (a no-op when it has no quest lines). */
export function drawQuestBlocks(textEl, key) {
    if (!textEl || !textEl.textContent.includes('[SYS:QUEST]')) return;
    const r = room();
    markLines(textEl);
    for (const g of groups(textEl)) {
        const first = g[0];
        const kind = first.dataset.kind;
        const items = g.map(el => ({ name: el.dataset.name }));
        const { tone, html } = blockHtml(r, kind, items, key);
        const box = document.createElement('div');
        box.className = `sblink-qblock sblink-qb-${kind} sblink-tn-${tone}`;
        box.setAttribute('role', 'button');
        box.tabIndex = 0;
        box.dataset.raw = g.map(el => el.dataset.raw).join('\n');
        box.innerHTML = html;
        box.addEventListener('click', (e) => { e.stopPropagation(); openTab('quests'); });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTab('quests'); } });
        // the line breaks around the lines go: the window is a block of its own
        const start = rootOf(first);
        const prev = start.previousSibling;
        if (prev?.nodeName === 'BR') prev.remove();
        start.parentNode.insertBefore(box, start);
        let n = start;
        const end = rootOf(g[g.length - 1]);
        while (n) {
            const next = n.nextSibling;
            n.remove();
            if (n === end) break;
            n = next;
        }
        const after = box.nextSibling;
        if (after?.nodeName === 'BR') after.remove();
    }
}

/** Put the plain lines back (System switched off in this chat, or the extension turned off). */
export function undrawQuestBlocks(root = document) {
    root.querySelectorAll('.sblink-qblock').forEach(box => {
        const frag = document.createDocumentFragment();
        // the line breaks taken out around the window come back too
        if (box.previousSibling) frag.appendChild(document.createElement('br'));
        String(box.dataset.raw || '').split('\n').forEach((line, i) => {
            if (i) frag.appendChild(document.createElement('br'));
            frag.appendChild(document.createTextNode(line));
        });
        if (box.nextSibling) frag.appendChild(document.createElement('br'));
        box.replaceWith(frag);
    });
    root.querySelectorAll('span.sblink-qline').forEach(el => el.replaceWith(document.createTextNode(el.textContent)));
}

