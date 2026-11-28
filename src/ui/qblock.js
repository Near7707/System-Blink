// 0.6.0 Quest lines in the story. The AI writes "[SYS:QUEST] DAILY · name" lines; on screen they are
// drawn as small System windows inside the message. The message text itself is never changed: when
// SillyTavern draws the message again the plain lines come back and are drawn again.
//
// 0.7.0 (genre mode) adds two kinds of lines:
//   [SYS:CLEAR] name          — the AI shows a quest being cleared in the reply. The window shows the extension's
//                                own judgment: checking · · · → confirmed ✓ +NP, or "not confirmed" (dim, no points).
//   [SYS:NOTICE] KIND · text  — the awakening, a tutorial step, an item or skill used, a new day.
// Only lines the extension can match to its own data are drawn; anything else the AI made up (a quest, a reward)
// is left as plain text (kept in a marker span, so watching the chat does not try it again and again).

import { t, lang } from '../i18n.js';
import { room, conf } from '../store.js';
import { toneOf, rate, warnFor, questState, chatView } from '../engine.js';
import { specNames, starWho } from '../data.js';
import { esc } from './util.js';

const RE = /\[SYS:(QUEST|NOTICE|CLEAR)\]([^\n[]*)/gi;
// The kind word after the tag. The AI is asked for the English word, but a translation extension (or the AI itself,
// writing in another language) may turn it into "일일" and the like: those are known too. (0.7.0)
const WORDS = {
    quest: [
        ['daily', 'daily|일일 ?퀘스트|일일|데일리'],
        ['sudden', 'sudden|돌발 ?퀘스트|돌발'],
        ['hidden', 'hidden|히든 ?퀘스트|히든|숨겨진 ?퀘스트|숨겨진|숨은 ?퀘스트|숨은'],
        ['goal', 'main ?goal|main|goal|메인 ?목표|메인 ?퀘스트|메인|목표'],
        ['penalty', 'penalty|페널티 ?퀘스트|페널티|패널티|벌칙 ?퀘스트|벌칙'],
    ],
    notice: [
        ['awaken', 'awaken(?:ing)?|각성|깨어남'],
        ['tutorial', 'tutorial|튜토리얼'],
        ['item', 'item|아이템|물건'],
        ['skill', 'skill|스킬'],
        ['day', 'new ?day|day|새 ?날|하루|날'],
    ],
};
const WORD_RE = Object.fromEntries(Object.entries(WORDS).map(([k, list]) => [k, list.map(([kind, alt]) => [kind, new RegExp(`^\\s*(?:${alt})(?=$|[\\s·•:|\\-–—])`, 'i')])]));
const STORY_KINDS = new Set(['daily', 'sudden', 'hidden', 'goal', 'penalty']);

/** "DAILY · name" → { kind, name }. A quest line with a word not known → kind 'any' (found by its name). */
function parseLine(type, rest) {
    for (const [kind, re] of WORD_RE[type] || []) {
        const m = re.exec(rest);
        if (m) return { kind, name: rest.slice(m[0].length).replace(SEP, '').trim() };
    }
    if (type !== 'quest') return { kind: '', name: '' };
    const cut = /[·•|:]/.exec(rest);
    return { kind: 'any', name: (cut ? rest.slice(cut.index + 1) : rest).trim() };
}
const NOTICE_TAB = { awaken: 'status', tutorial: 'quests', item: 'bag', skill: 'status', day: 'status' };
const CODE = { game: 'SYS.NOTICE', star: 'SYS.STAR', threat: 'SYS.ALERT' };
const DAILY_TAG = { game: 'DAILY', star: 'SCENARIO', threat: 'WARNING' };
const TAG = { sudden: 'SUDDEN', hidden: 'HIDDEN', goal: 'MAIN', penalty: 'PENALTY' };

let openTab = () => {};
let checking = () => null; // the AI reply whose check is running now (its CLEAR windows show "checking")
export function setQBlockHooks(h) { if (h?.openTab) openTab = h.openTab; if (h?.checking) checking = h.checking; }

const norm = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,!?~·*_()[\]「」『』-]/g, '');
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const SEP = /^\s*[·•:|\-–—]?\s*/;

/** Same name, or one inside the other; the newest wins. */
function byName(list, name, exact = false) {
    const n = norm(name);
    if (!n) return null;
    for (let i = list.length - 1; i >= 0; i--) if (norm(list[i].name) === n) return list[i];
    if (exact) return null;
    for (let i = list.length - 1; i >= 0; i--) { const m = norm(list[i].name); if (m && (m.includes(n) || n.includes(m))) return list[i]; }
    return null;
}

/**
 * The quest a [SYS:CLEAR] line names (any kind); else (a translation renamed it) the one the check cleared with
 * this reply — only when the reply has a single CLEAR line, so a made-up one next to a real one is not matched.
 */
function findCleared(r, name, key, only) {
    if (!r?.quests) return null;
    const q = byName(r.quests, name);
    if (q || !only) return q;
    const ids = [...new Set(r.ledger.filter(e => e.key === key && !e.undone && e.questId !== 'spectator').map(e => e.questId))];
    return ids.length === 1 ? r.quests.find(x => x.id === ids[0]) || null : null;
}

/** A text node holds a System line not yet drawn (or kept plain). */
const plainNode = (n) => n.nodeValue.includes('[SYS:') && !n.parentElement?.closest('.sblink-qblock, .sblink-qplain');
/** This message text still has a System line to look at. */
export function hasPlainSys(el) {
    if (!el || !el.textContent.includes('[SYS:')) return false;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (plainNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    return !!w.nextNode();
}

/** 1. Each System line becomes a marker span. */
function markLines(textEl) {
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (plainNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(text))) {
            const type = m[1].toUpperCase();
            const rest = m[2];
            let kind = '', name = '';
            if (type === 'CLEAR') { kind = 'clear'; name = rest.replace(SEP, '').trim(); }
            else ({ kind, name } = parseLine(type === 'QUEST' ? 'quest' : 'notice', rest));
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const span = document.createElement('span');
            span.className = kind ? 'sblink-qline' : 'sblink-qplain';
            if (kind) { span.dataset.type = type.toLowerCase(); span.dataset.kind = kind; span.dataset.name = name; span.dataset.raw = m[0].trim(); }
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

/** 2. Markers next to each other: daily quest lines share one window, the rest get one each. */
function groups(textEl) {
    const out = [];
    const used = new Set();
    for (const el of textEl.querySelectorAll('span.sblink-qline')) {
        if (used.has(el)) continue;
        const g = [el];
        used.add(el);
        if (el.dataset.type === 'quest' && el.dataset.kind === 'daily') {
            let n = nextLine(el);
            while (n && n.dataset.type === 'quest' && n.dataset.kind === 'daily') { g.push(n); used.add(n); n = nextLine(n); }
        }
        out.push(g);
    }
    return out;
}

const ptsOf = (tone, n) => (tone === 'star' ? t('pts_star', { pts: n }) : `+${n}P`);
const head = (tag, code) => `<div class="sblink-qbhead"><span class="sblink-qbtag">${esc(tag)}</span><span class="sblink-qbcode">${esc(code)}</span></div>`;

function questHtml(r, kind, quests, items, key) {
    const q0 = quests.find(Boolean);
    const tone = (q0?.tone) || toneOf(r);
    const pts = (q) => (!q || q.kind === 'penalty' || !q.reward ? '' : ptsOf(tone, rate(q.reward)));
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
    return { tone, cls: `sblink-qb-${kind}`, tab: 'quests', html: `${head(tag, code)}<div class="sblink-qbtitle">${esc(t(`qb_${kind}_${tone}`))}</div>${rows}${metaHtml}` };
}

/** 0.7.0: a quest cleared in the story — what the extension's own judgment says about it. */
function clearState(r, q, key) {
    const view = chatView();
    const mine = r.ledger.filter(x => x.questId === q.id && x.key === key && !x.undone);
    if (mine.length) {
        // confirmed only if the quest as a whole was finished with this reply (one of two conditions is not a clear)
        const all = r.ledger.filter(x => x.questId === q.id && !x.undone && (x.key == null || view.index.has(x.key)));
        const last = all.reduce((a, x) => ((x.at || 0) >= (a?.at || 0) ? x : a), null);
        if (questState(r, q, view).status === 'done' && last?.key === key) return { st: 'ok', pts: mine.reduce((a, x) => a + (Number(x.pts) || 0), 0) };
        if (key && checking() === key) return { st: 'wait' };
        return { st: 'hold', part: true };
    }
    return { st: key && checking() === key ? 'wait' : 'hold' };
}
function clearHtml(r, q, key) {
    const tone = q.tone || toneOf(r);
    const { st, pts, part } = clearState(r, q, key);
    const mark = st === 'ok' ? '✓' : st === 'wait' ? '·' : '◇';
    const right = st === 'ok' && pts ? ptsOf(tone, pts) : st === 'wait' ? '· · ·' : '';
    const meta = st === 'ok' ? t('qb_clear_ok') : st === 'wait' ? t('qb_clear_wait') : part ? t('qb_clear_part') : t('qb_clear_hold');
    return {
        tone, st, sig: `${st}|${pts || 0}|${part ? 1 : 0}`, cls: `sblink-qb-clear sblink-cl-${st}`, tab: 'quests',
        html: `${head('CLEAR', `${CODE[tone] || CODE.game} // CLEAR`)}<div class="sblink-qbtitle">${esc(t(`qb_clear_${tone}`))}</div>`
            + `<div class="sblink-qbrow"><span class="sblink-qbdia">${mark}</span><span class="sblink-qbname">${esc(q.name)}</span><b class="sblink-qbpts">${esc(right)}</b></div>`
            + `<div class="sblink-qbmeta">${esc(meta)}</div>`,
    };
}

/** 0.7.0: a System notice the extension asked for (or one it knows: an item / skill that was really used). */
function noticeHtml(r, kind, text) {
    const tone = toneOf(r);
    const uses = (r.uses || []).filter(u => (kind === 'skill' ? u.kind === 'skill' : u.kind !== 'skill'));
    if ((kind === 'item' || kind === 'skill') && !byName(uses, text)) return null;
    if (kind === 'tutorial' && (!r.tutorial || r.tutorial.state === 'none')) return null;
    const name = kind === 'item' || kind === 'skill' ? byName(uses, text).name : text;
    const row = kind === 'awaken' ? '' : `<div class="sblink-qbrow"><span class="sblink-qbdia">◆</span><span class="sblink-qbname">${esc(name)}</span></div>`;
    const meta = kind === 'awaken' ? `<div class="sblink-qbmeta">${esc(t('pop_awaken_2'))}</div>` : '';
    return {
        tone, cls: `sblink-qb-notice sblink-qb-n-${kind}`, tab: NOTICE_TAB[kind] || 'status',
        html: `${head(kind.toUpperCase(), `${CODE[tone] || CODE.game} // ${kind.toUpperCase()}`)}<div class="sblink-qbtitle">${esc(t(`qb_n_${kind}`))}</div>${row}${meta}`,
    };
}

/** Lines the extension cannot match stay as plain text. */
function keepPlain(g, later = '') {
    for (const el of g) {
        el.className = 'sblink-qplain';
        for (const k of ['type', 'kind', 'name', 'raw', 'qid']) delete el.dataset[k];
        if (later) el.dataset.later = later;
    }
}

/**
 * 0.7.0: what a line kept plain may wait for — the quests this reply brought in (known once the reply is in) and
 * what its check cleared (known a few seconds later). When that changes, the line is looked at again.
 */
function laterSig(r, key) {
    if (!key) return '';
    const told = r.quests.filter(q => (q.toldKeys || []).includes(key)).length;
    const done = r.ledger.filter(e => e.key === key && !e.undone).length;
    return `${r.quests.length}|${told}|${done}`;
}

/** Lines kept plain for now are put back as text when what they wait for has changed (then drawn again). */
export function redoLater(textEl, key) {
    const spans = textEl?.querySelectorAll?.('span.sblink-qplain[data-later]');
    if (!spans?.length) return;
    const r = room();
    if (!r) return;
    const sig = laterSig(r, key);
    if ([...spans].every(el => el.dataset.later === sig)) return;
    for (const el of textEl.querySelectorAll('span.sblink-qplain')) el.replaceWith(document.createTextNode(el.textContent));
    textEl.normalize();
}

/** Draw the windows in one AI message (a no-op when it has no System lines). */
export function drawQuestBlocks(textEl, key) {
    if (!hasPlainSys(textEl)) return;
    const r = room();
    if (!r) return;
    const genre = !!conf(r).genreMode;
    // 0.6.7: the same letters as the quest panel and the System window (the page's own font), not the
    // chat text's font, which a theme may set apart
    let font = '';
    try { font = getComputedStyle(document.body).fontFamily || ''; } catch { /* keep the chat font */ }
    markLines(textEl);
    // which quest each quest line names. The same name first (all lines), then a near one, then (a translation renamed it) the quests sent with
    // this reply, in order. A quest is used once: a made-up line ahead of the real ones does not take theirs.
    const lines = [...textEl.querySelectorAll('span.sblink-qline[data-type="quest"]')];
    // (lines drawn earlier in this message keep their quests: a line looked at again later must not take them)
    const taken = new Set([...textEl.querySelectorAll('.sblink-qblock[data-qids]')].flatMap(b => b.dataset.qids.split(',')));
    const pool = (kind) => r.quests.filter(q => STORY_KINDS.has(q.kind) && (kind === 'any' || q.kind === kind) && !taken.has(q.id));
    const found = new Map();
    const take = (el, q) => { if (q) { found.set(el, q); taken.add(q.id); } };
    // (every line's exact name first: a made-up line that only contains a real name must not take it from the real line)
    for (const el of lines) take(el, byName(pool(el.dataset.kind), el.dataset.name, true));
    // (a line near a name another line already took is a made-up copy — not that quest again, not an older one of
    // the same name, not a translation)
    const near = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
    const copyOfTaken = (el) => r.quests.some(q => taken.has(q.id) && near(q.name, el.dataset.name));
    for (const el of lines) if (!found.has(el) && !copyOfTaken(el)) take(el, byName(pool(el.dataset.kind), el.dataset.name));
    if (key) for (const el of lines) if (!found.has(el) && !copyOfTaken(el)) take(el, pool(el.dataset.kind).find(q => (q.toldKeys || []).includes(key)));
    const later = laterSig(r, key);
    for (const el of lines) {
        const q = found.get(el);
        if (q) { el.dataset.kind = q.kind; el.dataset.qid = q.id; continue; }
        // in genre mode a quest the extension never gave is the AI's own invention — left as text (looked at
        // again once this reply's quests are known); a line of unknown kind cannot be drawn either
        if (genre || el.dataset.kind === 'any') keepPlain([el], later);
    }
    const list = [];
    for (const g of groups(textEl)) {
        if (g[0].dataset.type !== 'quest') { list.push({ g }); continue; }
        list.push({ g, quests: g.map(el => r.quests.find(q => q.id === el.dataset.qid) || null) });
    }
    const drawnClears = textEl.querySelectorAll('.sblink-qblock.sblink-qb-clear').length;
    const clears = list.filter(x => x.g[0].dataset.type === 'clear').length + drawnClears;
    for (const { g, quests } of list) {
        const first = g[0];
        const { type, kind } = first.dataset;
        let made = null;
        if (type === 'quest') {
            const items = g.map(el => ({ name: el.dataset.name }));
            made = questHtml(r, kind, quests, items, key);
        } else if (type === 'clear') {
            const q = findCleared(r, first.dataset.name, key, clears === 1);
            if (q) { made = clearHtml(r, q, key); made.quest = q.id; }
            else { keepPlain(g, later); continue; } // its check may still name it
        } else if (type === 'notice') made = noticeHtml(r, kind, first.dataset.name);
        if (!made) { keepPlain(g); continue; }
        const box = document.createElement('div');
        box.className = `sblink-qblock ${made.cls} sblink-tn-${made.tone}`;
        box.setAttribute('role', 'button');
        box.tabIndex = 0;
        if (font) box.style.setProperty('--sb-qfont', font);
        box.dataset.raw = g.map(el => el.dataset.raw).join('\n');
        if (made.quest) { box.dataset.quest = made.quest; box.dataset.key = key || ''; box.dataset.sig = made.sig; }
        const qids = type === 'quest' ? (quests || []).filter(Boolean).map(q => q.id) : [];
        if (qids.length) box.dataset.qids = qids.join(',');
        box.innerHTML = made.html;
        const tab = made.tab;
        box.addEventListener('click', (e) => { e.stopPropagation(); openTab(tab); });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTab(tab); } });
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

/** 0.7.0: the CLEAR windows follow the judgment (checking → confirmed / not confirmed, a re-roll, an undo). */
export function refreshClears(root = document) {
    const r = room();
    if (!r) return;
    root.querySelectorAll('.sblink-qblock.sblink-qb-clear').forEach(box => {
        const q = r.quests.find(x => x.id === box.dataset.quest);
        if (!q) return;
        const made = clearHtml(r, q, box.dataset.key || null);
        if (box.dataset.sig === made.sig) return;
        box.dataset.sig = made.sig;
        for (const x of ['wait', 'ok', 'hold']) box.classList.toggle(`sblink-cl-${x}`, x === made.st);
        box.innerHTML = made.html;
    });
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
    root.querySelectorAll('span.sblink-qline, span.sblink-qplain').forEach(el => el.replaceWith(document.createTextNode(el.textContent)));
}
