// 0.6.5: the quest panel — the quests in progress, always in sight while chatting.
// PC: a small window against the chat column's side (outside it, opposite the bookmark), moved by its head.
// Phone (or no room beside the column): one line on top of the chat column that opens downwards.
// Only shows what is already known: no AI calls. Tapping a line opens the Quests tab there.

import { t } from '../i18n.js';
import { settings, room, currentChatId, device, saveDevice } from '../store.js';
import { active, chatView, todays, questState, condsOf, penaltyQuests, goalNow, suddenLeft, rate, toneOf } from '../engine.js';
import { esc, $id, viewport, safeInsets, isPhone, inputTop, motionOn } from './util.js';

const W = 248;          // the PC panel's width
const GAP = 10;         // from the chat column
const BAR_H = 40;       // the phone line
let hooks = { open: () => {}, off: () => {} };
export function setPanelHooks(h) { hooks = { ...hooks, ...h }; }

let hidden = false;     // the System window is open
let openBar = false;    // phone: the line is opened
let drag = null;
let mode = 'side';      // side (PC, beside the column) | bar (phone line)

export function setPanelHidden(on) { hidden = !!on; renderPanel(); }
/** A message was sent / the keyboard came up: close the opened line (phone). */
export function foldPanel() { if (openBar) { openBar = false; renderPanel(); } }

const pcState = () => {
    const d = device();
    const p = d.panel && typeof d.panel === 'object' ? d.panel : {};
    return { side: p.side === undefined ? 'left' : p.side, fx: Number(p.fx) || 0, fy: Number(p.fy) || 0, folded: !!p.folded, v: 1 };
};
function savePc(p) { const d = device(); d.panel = p; saveDevice(d); }

/** What is in progress now, in the order the panel shows it. */
function rows(r, view) {
    const out = { goal: null, sudden: [], penalty: [], hidden: [], daily: [], dailyDone: 0, tut: null };
    if (r.tutorial?.state === 'active') {
        const next = r.tutorial.done.findIndex(x => !x);
        if (next >= 0) out.tut = { n: r.tutorial.done.filter(Boolean).length, text: t(`tut_${next}`) };
    }
    if (r.goal) {
        const g = goalNow(r, view);
        if (g.current && !g.complete) {
            const st = questState(r, g.current, view);
            const c = condsOf(g.current);
            out.goal = { q: g.current, done: g.done, total: g.total, title: r.goal.title, conds: c ? `${st.condDone.filter(Boolean).length} / ${c.length}` : '' };
        }
    }
    for (const q of r.quests) {
        if (q.kind !== 'sudden' && q.kind !== 'hidden') continue;
        const st = questState(r, q, view).status;
        if (q.kind === 'sudden' && (st === 'active' || st === 'offered')) out.sudden.push({ q, st, left: suddenLeft(q, view) });
        if (q.kind === 'hidden' && st === 'active') out.hidden.push({ q });
    }
    for (const q of penaltyQuests(r)) if (questState(r, q, view).status === 'active') out.penalty.push({ q });
    for (const q of todays(r)) {
        const st = questState(r, q, view).status;
        if (st === 'done') out.dailyDone += 1;
        out.daily.push({ q, st });
    }
    out.any = !!(out.tut || out.goal || out.sudden.length || out.penalty.length || out.hidden.length || out.daily.length);
    return out;
}

const dias = (left, all, cls = '') => `<span class="sblink-qp-dias${cls}">${Array.from({ length: all }, (_, i) => `<i class="${i < left ? 'sblink-on' : ''}"></i>`).join('')}</span>`;

function summary(x) {
    const bits = [];
    if (x.goal) bits.push(esc(t('panel_goal', { n: x.goal.done + 1, all: x.goal.total })));
    const s = x.sudden.find(y => y.st === 'active');
    if (s) bits.push(`<span class="sblink-qp-orange">${esc(t('panel_sudden'))}</span>${dias(s.left, s.q.limit || 3)}`);
    else if (x.sudden.length) bits.push(`<span class="sblink-qp-orange">${esc(t('panel_offer'))}</span>`);
    if (x.penalty.length) bits.push(`<span class="sblink-qp-red">${esc(t('panel_penalty'))}</span>`);
    if (x.daily.length) bits.push(esc(t('panel_daily', { n: x.dailyDone, all: x.daily.length })));
    if (!bits.length && x.tut) bits.push(esc(t('panel_tut', { n: x.tut.n })));
    if (!bits.length && x.hidden.length) bits.push(`<span class="sblink-qp-purple">${esc(t('panel_hidden'))}</span>`);
    return bits.join('<span class="sblink-qp-sep"> · </span>');
}

function listHtml(x) {
    let h = '';
    if (x.tut) h += `<div class="sblink-qp-row" data-qp="tut"><div class="sblink-qp-k">TUTORIAL · ${x.tut.n} / 4</div><div class="sblink-qp-name sblink-ell">${esc(x.tut.text)}</div></div>`;
    if (x.goal) {
        const g = x.goal;
        h += `<div class="sblink-qp-row sblink-qp-goal" data-qp="${esc(g.q.id)}"><div class="sblink-qp-k">MAIN · ${g.done + 1} / ${g.total}</div>
          <div class="sblink-qp-name">${esc(g.q.name)}</div>
          <div class="sblink-qp-bar">${Array.from({ length: g.total }, (_, i) => `<i class="${i < g.done ? 'sblink-on' : i === g.done ? 'sblink-now' : ''}"></i>`).join('')}</div>
          <div class="sblink-qp-meta sblink-ell">${esc(g.title)}${g.conds ? ` · ${esc(t('cond_n', { n: g.conds.split(' / ')[0], all: g.conds.split(' / ')[1] }))}` : ''}</div></div>`;
    }
    for (const s of x.sudden) {
        h += `<div class="sblink-qp-row sblink-qp-sudden" data-qp="${esc(s.q.id)}"><div class="sblink-qp-k">SUDDEN${s.st === 'active' ? dias(s.left, s.q.limit || 3, ' sblink-qp-right') : ` <span class="sblink-qp-wait">${esc(t('panel_offer'))}</span>`}</div>
          <div class="sblink-qp-line"><span class="sblink-qp-name">${esc(s.q.name)}</span><b class="sblink-qp-pts">+${rate(s.q.reward)}P</b></div></div>`;
    }
    for (const p of x.penalty) {
        h += `<div class="sblink-qp-row sblink-qp-pen" data-qp="${esc(p.q.id)}"><div class="sblink-qp-k">PENALTY</div><div class="sblink-qp-name">${esc(p.q.name)}</div></div>`;
    }
    if (x.daily.length) {
        h += `<div class="sblink-qp-row sblink-qp-daily"><div class="sblink-qp-k">DAILY ${x.dailyDone} / ${x.daily.length}</div>
          ${x.daily.map(d => `<div class="sblink-qp-line sblink-qp-d-${d.st}" data-qp="${esc(d.q.id)}"><span class="sblink-qp-mark">${d.st === 'done' ? '✓' : d.st === 'failed' ? '✕' : '◆'}</span><span class="sblink-qp-name">${esc(d.q.name)}</span>${d.st === 'done' || d.st === 'failed' ? '' : `<b class="sblink-qp-pts">+${rate(d.q.reward)}P</b>`}</div>`).join('')}</div>`;
    }
    for (const p of x.hidden) {
        h += `<div class="sblink-qp-row sblink-qp-hidden" data-qp="${esc(p.q.id)}"><div class="sblink-qp-k">HIDDEN</div><div class="sblink-qp-line"><span class="sblink-qp-name">${esc(p.q.name)}</span><b class="sblink-qp-pts">+${rate(p.q.reward)}P</b></div></div>`;
    }
    return h;
}

function shouldHide(r) {
    const s = settings();
    return !s.enabled || !s.questPanel || hidden || !currentChatId() || !active(r);
}

/** Draw (or remove) the panel for this chat. */
export function renderPanel() {
    const r = room();
    let el = $id('sblink-qpanel');
    if (shouldHide(r)) { if (el && !el.hidden) { el.hidden = true; onDrawn(); } return; }
    const x = rows(r, chatView());
    if (!x.any) { if (el && !el.hidden) { el.hidden = true; onDrawn(); } return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'sblink-qpanel';
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('pointerdown', onDown);
    }
    mode = pickMode();
    const pc = pcState();
    const folded = mode === 'bar' ? !openBar : pc.folded;
    const tone = toneOf(r);
    el.className = `sblink-qpanel sblink-holo sblink-tn-${tone} sblink-qp-${mode}${folded ? ' sblink-qp-folded' : ''}${motionOn() ? ' sblink-moving' : ''}`;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', t('panel_name'));
    const head = folded
        ? `<button type="button" class="sblink-qp-sum" data-qp-act="unfold" aria-expanded="false"><span class="sblink-qp-tag">QUEST</span><span class="sblink-qp-sumtext sblink-ell">${summary(x)}</span><span class="sblink-qp-arrow">▾</span></button>`
        : `<div class="sblink-qp-head"><span class="sblink-qp-tag">QUEST</span><span class="sblink-code">SYS.TRACK</span><span class="sblink-sp"></span>
            <button type="button" class="sblink-qp-btn" data-qp-act="tab" aria-label="${esc(t('panel_tab'))}"><span class="sblink-ell">${esc(t('panel_tab'))}</span></button>
            <button type="button" class="sblink-qp-btn" data-qp-act="fold" aria-label="${esc(t('panel_fold'))}">▴</button>
            ${mode === 'side' ? `<button type="button" class="sblink-qp-btn" data-qp-act="off" aria-label="${esc(t('panel_off'))}">✕</button>` : ''}</div>`;
    el.innerHTML = `${head}${folded ? '' : `<div class="sblink-qp-list">${listHtml(x)}</div><div class="sblink-qp-foot sblink-ell">${esc(t(mode === 'side' ? 'panel_foot_pc' : 'panel_foot'))}</div>`}`;
    el.hidden = false;
    placePanel();
    onDrawn();
}
let onDrawn = () => {};
/** Called after each draw (small notices move with the opened / folded line). */
export function setPanelDrawn(fn) { onDrawn = fn; }

/** Beside the column when there is room for it (PC), else the line on top. */
function pickMode() {
    if (isPhone()) return 'bar';
    const c = colBox();
    const roomL = c.l - c.left, roomR = c.right - c.r;
    return Math.max(roomL, roomR - 40) >= W + GAP + 6 ? 'side' : 'bar';
}

function colBox() {
    const vp = viewport();
    const ins = safeInsets();
    const left = vp.x + ins.left, right = vp.x + vp.w - ins.right;
    const r = ($id('sheld') || $id('chat'))?.getBoundingClientRect();
    const bar = ($id('top-settings-holder') || $id('top-bar'))?.getBoundingClientRect();
    let top = Math.max(vp.y + ins.top, bar && bar.height ? bar.bottom : 0);
    if (!r || r.width < 160) return { l: left, r: right, left, right, top, vp, ins };
    top = Math.max(top, r.top);
    return { l: Math.max(left, r.left), r: Math.min(right, r.right), left, right, top, vp, ins };
}

export function placePanel() {
    const el = $id('sblink-qpanel');
    if (!el || el.hidden || drag) return;
    const c = colBox();
    if (mode === 'bar') {
        el.style.left = `${Math.round(c.l + 8)}px`;
        el.style.width = `${Math.round(Math.max(160, c.r - c.l - 16))}px`;
        el.style.top = `${Math.round(c.top + 6)}px`;
        el.style.maxHeight = `${Math.round(Math.max(BAR_H, (inputTop() - c.top) * 0.6))}px`;
        return;
    }
    const p = pcState();
    const h = el.offsetHeight || 200;
    const minY = c.top + 12;
    const maxY = Math.max(minY, Math.min(inputTop(), c.vp.y + c.vp.h) - h - 10);
    let x;
    if (p.side === 'left' && c.l - c.left >= W + GAP + 6) x = c.l - W - GAP;
    else if (p.side === 'right' && c.right - c.r >= W + GAP + 46) x = c.r + 40 + GAP; // clear of the bookmark
    else if (p.side === 'left' || p.side === 'right') x = c.l - c.left >= W + GAP + 6 ? c.l - W - GAP : c.r + 40 + GAP;
    else x = c.left + 6 + p.fx * Math.max(0, c.right - c.left - W - 12);
    const y = minY + Math.min(1, Math.max(0, p.fy)) * Math.max(0, maxY - minY);
    el.style.width = `${W}px`;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(Math.min(maxY, Math.max(minY, y)))}px`;
    el.style.maxHeight = `${Math.round(Math.max(120, Math.min(inputTop(), c.vp.y + c.vp.h) - minY - 10))}px`;
}

/** The bottom of the phone line while it shows (small notices go under it; whole = the opened list too), else 0. */
export function panelBarBottom(whole = false) {
    const el = $id('sblink-qpanel');
    if (!el || el.hidden || mode !== 'bar') return 0;
    const r = el.getBoundingClientRect();
    return r.height ? (whole ? r.bottom : r.top + Math.min(r.height, BAR_H + 2)) : 0;
}

function onClick(e) {
    if (dragMoved) { dragMoved = false; return; }
    const a = e.target.closest('[data-qp-act]')?.dataset.qpAct;
    if (a === 'unfold') { if (mode === 'bar') openBar = true; else { const p = pcState(); p.folded = false; savePc(p); } return renderPanel(); }
    if (a === 'fold') { if (mode === 'bar') openBar = false; else { const p = pcState(); p.folded = true; savePc(p); } return renderPanel(); }
    if (a === 'tab') { openBar = false; return hooks.open({}); }
    if (a === 'off') return hooks.off();
    const q = e.target.closest('[data-qp]')?.dataset.qp;
    if (q) { openBar = false; return hooks.open(q === 'tut' ? {} : { quest: q }); }
}

// ---------- moving it (PC: by the head) ----------
let dragMoved = false;
function onDown(e) {
    if (mode !== 'side' || e.button > 0) return;
    const head = e.target.closest('.sblink-qp-head, .sblink-qp-sum');
    if (!head || (e.target.closest('button') && !e.target.closest('.sblink-qp-sum'))) return;
    const el = $id('sblink-qpanel');
    const r = el.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, moved: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endPanelDrag);
}
function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    const el = $id('sblink-qpanel');
    el.classList.add('sblink-qp-dragging');
    el.style.left = `${Math.round(drag.x + dx)}px`;
    el.style.top = `${Math.round(drag.y + dy)}px`;
}
function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    const el = $id('sblink-qpanel');
    if (moved && el) {
        dragMoved = true;
        setTimeout(() => { dragMoved = false; }, 0);
        const r = el.getBoundingClientRect();
        const c = colBox();
        const p = pcState();
        // let go near the column's side = stick to it again
        if (Math.abs(r.right - c.l) < 60 && c.l - c.left >= W + GAP + 6) p.side = 'left';
        else if (Math.abs(r.left - c.r) < 90 && c.right - c.r >= W + GAP + 46) p.side = 'right';
        else { p.side = null; p.fx = Math.min(1, Math.max(0, (r.left - c.left - 6) / Math.max(1, c.right - c.left - W - 12))); }
        const minY = c.top + 12;
        const maxY = Math.max(minY + 1, Math.min(inputTop(), c.vp.y + c.vp.h) - r.height - 10);
        p.fy = Math.min(1, Math.max(0, (r.top - minY) / (maxY - minY)));
        savePc(p);
    }
    endPanelDrag();
}
export function endPanelDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', endPanelDrag);
    if (!drag) return;
    drag = null;
    $id('sblink-qpanel')?.classList.remove('sblink-qp-dragging');
    placePanel();
}

export function resetPanelPos() { const d = device(); delete d.panel; saveDevice(d); placePanel(); }
export function unmountPanel() { endPanelDrag(); $id('sblink-qpanel')?.remove(); }
