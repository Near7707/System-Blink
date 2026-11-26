// The System window (B: a floating window that leaves the chat visible behind it).
// Tabs on top: Status / Shop / Bag / Quests, then ⚙ and ✕. Same size on every tab; only the inside scrolls.

import { t, lang } from '../i18n.js';
import { settings, room, currentChatId, save } from '../store.js';
import {
    active, chatView, points, todays, questState, clearByHand, undoClear, lifeNow, setLife, nextDay, ownerName,
    standingItems, dailyReady, stockDaily, restockStanding, buy, useItem, tutorialStep, skipTutorial, switchOn, rate, bus,
} from '../engine.js';
import { runCheck, isChecking, cancelCheck } from '../ai.js';
import { gearHtml, setValue, runButton, toggleGroup, ROWS, getValue } from '../prefs.js';
import { icon, hexMark } from '../icons.js';
import { esc, $id, viewport, safeInsets, isPhone, motionOn } from './util.js';
import { notice, popup } from './pop.js';

const TABS = ['status', 'shop', 'bag', 'quests'];
const ui = {
    view: 'status', back: 'status', shopSide: 'daily', selShop: null, selBag: null, openQuest: null,
    modal: null, textKey: '', titlePick: false, stocking: false, restocking: false, checkingNow: false,
};
let hooks = { opened: () => {}, closed: () => {} };
export function setWinHooks(h) { hooks = { ...hooks, ...h }; }

export const isOpen = () => !!$id('sblink-win');

const RC = { common: 'sblink-r-common', rare: 'sblink-r-rare', epic: 'sblink-r-epic', legendary: 'sblink-r-legendary' };
const rarityTag = (r) => `<b class="sblink-rar ${RC[r] || ''}">${esc(t(`rarity_${r}`))}</b>`;

// ---------- open / close ----------
export function openWindow(tab) {
    if (!settings().enabled) return openOffline();
    if (tab && TABS.includes(tab)) ui.view = tab;
    if (!TABS.includes(ui.view) && !['gear', 'text', 'life'].includes(ui.view)) ui.view = 'status';
    let win = $id('sblink-win');
    if (!win) {
        const shade = document.createElement('div');
        shade.id = 'sblink-shade';
        shade.className = 'sblink-shade';
        shade.addEventListener('click', closeWindow);
        document.body.appendChild(shade);
        win = document.createElement('div');
        win.id = 'sblink-win';
        win.setAttribute('role', 'dialog');
        win.setAttribute('aria-modal', 'true');
        document.body.appendChild(win);
        win.addEventListener('click', onClick);
        win.addEventListener('change', onChange);
        win.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest?.('[data-fold]')) e.target.click(); });
    }
    win.className = `sblink-win sblink-holo${motionOn() ? ' sblink-moving' : ''}`;
    render();
    place();
    const r = room();
    if (active(r)) { tutorialStep(r, 0); save(); }
    hooks.opened();
}

export function closeWindow() {
    $id('sblink-win')?.remove();
    $id('sblink-shade')?.remove();
    ui.modal = null; ui.titlePick = false;
    if (['gear', 'text', 'life'].includes(ui.view)) ui.view = ui.back || 'status';
    hooks.closed();
}

export function refreshWin() { if (isOpen()) render(); }

export function place() {
    const win = $id('sblink-win');
    if (!win) return;
    const vp = viewport();
    const ins = safeInsets();
    const phone = isPhone();
    const side = phone ? 14 : 24;
    const w = phone ? vp.w - side * 2 : Math.min(460, vp.w - side * 2);
    const topGap = Math.max(ins.top + 10, phone ? 18 : 30);
    const botGap = Math.max(ins.bottom + 10, phone ? 18 : 30);
    const h = Math.min(phone ? 640 : 620, vp.h - topGap - botGap);
    win.style.width = `${Math.round(w)}px`;
    win.style.height = `${Math.round(Math.max(260, h))}px`;
    win.style.left = `${Math.round(vp.x + (vp.w - w) / 2)}px`;
    win.style.top = `${Math.round(vp.y + topGap + Math.max(0, (vp.h - topGap - botGap - h) / 2))}px`;
}

// ---------- the "system is off" mini window (from the wand menu) ----------
function openOffline() {
    $id('sblink-off')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'sblink-off';
    wrap.className = 'sblink-popwrap';
    wrap.innerHTML = `<div class="sblink-pop sblink-holo sblink-offbox" role="dialog">
      <i class="sblink-cn sblink-cn-tl"></i><i class="sblink-cn sblink-cn-tr"></i><i class="sblink-cn sblink-cn-bl"></i><i class="sblink-cn sblink-cn-br"></i>
      <div class="sblink-pophead"><span class="sblink-code">SYS.STATUS // OFFLINE</span></div>
      <div class="sblink-poptitle">${esc(t('off_title'))}</div>
      <div class="sblink-popbody">${esc(t('off_body'))}</div>
      <div class="sblink-popbtns"><button type="button" class="sblink-btn" data-off="close"><span class="sblink-ell">${esc(t('close'))}</span></button>
      <button type="button" class="sblink-btn sblink-btn-main" data-off="on"><span class="sblink-ell">${esc(t('turn_on'))}</span></button></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-off]');
        if (!b && e.target !== wrap) return;
        wrap.remove();
        if (b?.dataset.off === 'on') runButton('allOn');
    });
}

// ---------- drawing ----------
function render() {
    const win = $id('sblink-win');
    if (!win) return;
    const body = win.querySelector('.sblink-body');
    const keep = body && body.dataset.view === ui.view ? body.scrollTop : 0;
    const inSub = ['gear', 'text', 'life'].includes(ui.view);
    const r = room();
    const tabs = inSub
        ? `<button type="button" class="sblink-backbtn" data-act="back"><span class="sblink-ell">‹ ${esc(t('back'))}</span></button>
           <div class="sblink-subtitle sblink-ell">${esc(t(`sub_${ui.view}`))} <span class="sblink-code">// ${ui.view === 'gear' ? 'CONFIG' : ui.view === 'life' ? 'DAY' : 'TEXT'}</span></div>`
        : TABS.map(k => `<button type="button" class="sblink-tab${ui.view === k ? ' sblink-tab-on' : ''}" data-tab="${k}"><span class="sblink-ell">${esc(t(`tab_${k}`))}</span></button>`).join('');
    const content = inSub ? subBody() : !currentChatId() ? empty(t('no_chat')) : !active(r) ? roomOff() : tabBody(r);
    win.innerHTML = `
      <i class="sblink-cn sblink-cn-tl"></i><i class="sblink-cn sblink-cn-tr"></i><i class="sblink-cn sblink-cn-bl"></i><i class="sblink-cn sblink-cn-br"></i>
      <div class="sblink-tabs">${tabs}<span class="sblink-sp"></span>
        ${inSub ? '' : `<button type="button" class="sblink-iconbtn" data-act="gear" aria-label="${esc(t('settings'))}">${icon('gear')}</button>`}
        <button type="button" class="sblink-iconbtn" data-act="close" aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
      <div class="sblink-tabline"></div>
      <div class="sblink-body" data-view="${ui.view}">${content.body}</div>
      ${content.foot ? `<div class="sblink-foot">${content.foot}</div>` : ''}
      ${ui.modal ? modalHtml() : ''}`;
    const nb = win.querySelector('.sblink-body');
    if (nb && keep) nb.scrollTop = keep;
}

const empty = (text, extra = '') => ({ body: `<div class="sblink-empty">${hexMark('sblink-emptymark')}<div>${esc(text)}</div>${extra}</div>`, foot: '' });

function roomOff() {
    return {
        body: `<div class="sblink-empty">${hexMark('sblink-emptymark')}
          <div class="sblink-code">SYS.STATUS // STANDBY</div>
          <div class="sblink-emptytitle">${esc(t('room_off_title'))}</div>
          <div>${esc(t('room_off_body'))}</div></div>`,
        foot: `<button type="button" class="sblink-btn sblink-btn-main sblink-btn-wide" data-act="roomOn"><span class="sblink-ell">${esc(t('room_on'))}</span></button>`,
    };
}

function tabBody(r) {
    if (ui.view === 'shop') return shopTab(r);
    if (ui.view === 'bag') return bagTab(r);
    if (ui.view === 'quests') return questsTab(r);
    return statusTab(r);
}

const sec = (title, extra = '') => `<div class="sblink-sechead"><span class="sblink-dia">◆</span><span>${esc(title)}</span><i class="sblink-secline"></i>${extra}</div>`;

// ----- status -----
function statusTab(r) {
    const view = chatView();
    const pts = points(r, view);
    const name = ownerName(r);
    const initial = Array.from(name.trim())[0] || '?';
    const tut = r.tutorial;
    const tutDone = tut.done.filter(Boolean).length;
    const sub = tut.state === 'active' ? t('tut_progress', { n: tutDone }) : t('day_n', { n: r.day });
    const list = todays(r);
    const done = list.filter(q => questState(r, q, view).status === 'done').length;
    const life = lifeNow(r, view);
    const cell = (k, ic) => `<div class="sblink-lifecell">${icon(ic)}<div class="sblink-code">${esc(t(`life_${k}`))}</div><div class="sblink-lifeval sblink-ell">${esc(k === 'date' ? (life.date || t('day_n', { n: r.day })) : (life[k] || '—'))}</div></div>`;
    const titles = r.titles || [];
    let body = `
      <div class="sblink-me">
        <div class="sblink-avatar"><i class="sblink-dashhex"></i>${hexMark('sblink-avhex')}<span class="sblink-initial">${esc(initial)}</span></div>
        <div class="sblink-meinfo">
          <div class="sblink-name sblink-ell">${esc(name)}</div>
          <button type="button" class="sblink-titlebtn" data-act="titlePick"><span class="sblink-ell">${esc(r.title || t('no_title'))}</span> ▾</button>
          <div class="sblink-sub sblink-ell">${esc(sub)}</div>
        </div>
      </div>`;
    if (ui.titlePick) {
        body += `<div class="sblink-chips sblink-titlechips">${titles.length
            ? [`<button type="button" class="sblink-chip${!r.title ? ' sblink-chip-on' : ''}" data-title=""><span class="sblink-ell">${esc(t('no_title'))}</span></button>`,
                ...titles.map(x => `<button type="button" class="sblink-chip${x === r.title ? ' sblink-chip-on' : ''}" data-title="${esc(x)}"><span class="sblink-ell">${esc(x)}</span></button>`)].join('')
            : `<div class="sblink-hint">${esc(t('no_titles'))}</div>`}</div>`;
    }
    body += `<div class="sblink-pointsband"><span class="sblink-code">POINTS</span><b>${pts}P</b></div>`;
    if (r.lifeMode) {
        body += sec(t('life'), `<span class="sblink-code">${esc(t('day_n', { n: r.day }))}</span>`)
            + `<div class="sblink-lifegrid">${cell('date', 'calendar')}${cell('time', 'clock')}${cell('weather', 'sun')}${cell('place', 'pin')}</div>
               <div class="sblink-plan"><span class="sblink-code">${esc(t('life_plan'))}</span><span class="sblink-ell">${esc(life.plan || t('no_plan'))}</span></div>`;
    }
    body += `<button type="button" class="sblink-todayline" data-tab="quests"><span class="sblink-code">TODAY</span><span class="sblink-ell">${esc(t('today_quests', { done, all: list.length }))}</span><span>▸</span></button>`;
    body += sec(t('skills')) + `<div class="sblink-hint sblink-lockline">${esc(t('skills_soon'))}</div>`;
    const foot = `${r.lifeMode ? `<button type="button" class="sblink-btn" data-act="lifeEdit"><span class="sblink-ell">${esc(t('edit'))}</span></button>` : ''}
      <button type="button" class="sblink-btn sblink-btn-main" data-act="nextDay"><span class="sblink-ell">${esc(t('next_day'))} ▸</span></button>`;
    return { body, foot };
}

// ----- shop -----
function shopTab(r) {
    const pts = points(r);
    const side = ui.shopSide;
    let items = [];
    let status = '';
    if (side === 'daily') {
        if (!dailyReady(r)) {
            if (!ui.stocking) startStock();
            status = `<div class="sblink-loading">${hexMark('sblink-spin')}<span>${esc(t('stocking'))}</span></div>`;
        } else items = r.shop.daily;
    } else items = standingItems(r);
    const sel = items.find(x => x.id === ui.selShop) || null;
    const cells = items.map(x => `
      <button type="button" class="sblink-cell ${RC[x.rarity] || ''}${x.id === ui.selShop ? ' sblink-cell-on' : ''}${x.sold ? ' sblink-sold' : ''}" data-shop="${esc(x.id)}">
        <span class="sblink-cellrar">${esc(t(`rarity_${x.rarity}`).slice(0, lang() === 'ko' ? 2 : 1))}</span>
        ${x.limited ? `<span class="sblink-limited">${esc(t('limited'))}</span>` : ''}
        ${icon(x.icon, 'sblink-cellico')}
        <span class="sblink-price">${x.price}P</span>
        ${x.sold ? '<span class="sblink-stamp">SOLD</span>' : ''}
      </button>`).join('');
    const top = `<div class="sblink-shoptop">
        <div class="sblink-seg">
          <button type="button" class="sblink-chip${side === 'daily' ? ' sblink-chip-on' : ''}" data-side="daily"><span class="sblink-ell">${esc(t('shop_daily'))}</span></button>
          <button type="button" class="sblink-chip${side === 'standing' ? ' sblink-chip-on' : ''}" data-side="standing"><span class="sblink-ell">${esc(t('shop_standing'))}</span></button>
        </div>
        <b class="sblink-ptsmall">${pts}P</b>
      </div>
      <div class="sblink-hint sblink-ell">${esc(side === 'daily' ? t('shop_next') : t('shop_standing_hint'))}</div>`;
    let detail = '';
    if (sel) {
        const after = pts - sel.price;
        detail = `<div class="sblink-detail">
          <div class="sblink-detailhead">${icon(sel.icon, 'sblink-bigico')}<div><div class="sblink-detailname">${esc(sel.name)}</div>${rarityTag(sel.rarity)}</div></div>
          <div class="sblink-detaildesc">${esc(sel.desc || '')}</div>
          ${sel.sold ? `<div class="sblink-hint">${esc(t('sold_out'))}</div>` : `<div class="sblink-afterpts">${pts}P → <b class="${after < 0 ? 'sblink-neg' : ''}">${after}P</b></div>`}
        </div>`;
    } else if (items.length) detail = `<div class="sblink-hint sblink-center">${esc(t('pick_item'))}</div>`;
    const grid = items.length ? `<div class="sblink-grid sblink-grid3">${cells}</div>` : status || `<div class="sblink-hint sblink-center">${esc(t('shop_empty'))}</div>`;
    const can = sel && !sel.sold && pts >= sel.price;
    let foot = '';
    if (side === 'standing') foot += `<button type="button" class="sblink-btn" data-act="restock"${ui.restocking ? ' disabled' : ''}><span class="sblink-ell">${esc(ui.restocking ? t('stocking') : t('restock'))}</span></button>`;
    foot += `<button type="button" class="sblink-btn sblink-btn-main" data-act="buy"${can ? '' : ' disabled'}><span class="sblink-ell">${esc(!sel ? t('buy') : sel.sold ? t('sold_out') : pts < sel.price ? t('not_enough') : `${t('buy')} ${sel.price}P`)}</span></button>`;
    return { body: top + grid + detail, foot };
}

async function startStock() {
    ui.stocking = true;
    try { await stockDaily(); } finally { ui.stocking = false; refreshWin(); }
}

// ----- bag -----
function bagTab(r) {
    const bag = r.bag.filter(b => b.count > 0);
    const sel = bag.find(b => b.id === ui.selBag) || null;
    const cells = bag.map(b => `
      <button type="button" class="sblink-cell ${RC[b.rarity] || ''}${b.id === ui.selBag ? ' sblink-cell-on' : ''}" data-bag="${esc(b.id)}">
        ${icon(b.icon, 'sblink-cellico')}<span class="sblink-count">${b.count}</span>
      </button>`).join('');
    const fill = Math.max(0, Math.ceil(Math.max(8, bag.length) / 4) * 4 - bag.length);
    const blanks = '<div class="sblink-cell sblink-cell-blank"></div>'.repeat(fill);
    let body = sec(t('tab_bag'), `<span class="sblink-code">${bag.reduce((a, b) => a + b.count, 0)}</span>`) + `<div class="sblink-grid sblink-grid4">${cells}${blanks}</div>`;
    if (!bag.length) body += `<div class="sblink-hint sblink-center">${esc(t('bag_empty'))}</div>`;
    if (sel) {
        body += `<div class="sblink-detail">
          <div class="sblink-detailhead">${icon(sel.icon, 'sblink-bigico')}<div><div class="sblink-detailname">${esc(sel.name)} <span class="sblink-times">×${sel.count}</span></div>${rarityTag(sel.rarity)}</div></div>
          <div class="sblink-detaildesc">${esc(sel.desc || '')}</div>
          <div class="sblink-hint">${esc(sel.kind === 'gacha' ? t('gacha_soon') : sel.kind === 'reroll' ? t('reroll_hint') : t('use_hint'))}</div>
        </div>`;
    } else if (bag.length) body += `<div class="sblink-hint sblink-center">${esc(t('pick_item'))}</div>`;
    const locked = sel?.kind === 'gacha';
    const foot = `<button type="button" class="sblink-btn sblink-btn-main sblink-btn-wide" data-act="use"${sel && !locked ? '' : ' disabled'}><span class="sblink-ell">${esc(locked ? t('opens_soon') : t('use'))}</span></button>`;
    return { body, foot };
}

// ----- quests -----
function questsTab(r) {
    const view = chatView();
    let body = '';
    const tut = r.tutorial;
    if (tut.state === 'active') {
        const next = tut.done.findIndex(x => !x);
        body += sec(t('tutorial'), `<span class="sblink-code">${tut.done.filter(Boolean).length} / 4</span>`)
            + `<div class="sblink-tutbar">${tut.done.map((d, i) => `<i class="${d ? 'sblink-on' : i === next ? 'sblink-now' : ''}"></i>`).join('')}</div>
               <div class="sblink-tutnext"><span class="sblink-code">${next >= 0 ? 'NEXT' : 'CLEAR'}</span> ▸ <span class="sblink-ell">${esc(next >= 0 ? t(`tut_${next}`) : '')}</span></div>`;
    }
    const list = todays(r);
    const done = list.filter(q => questState(r, q, view).status === 'done').length;
    body += sec(t('daily_quests'), `<span class="sblink-code">${esc(t('day_n', { n: r.day }))} · ${done} / ${list.length}</span>`);
    if (!list.length) body += `<div class="sblink-hint sblink-center">${esc(t('no_quests'))}</div>`;
    for (const q of list) {
        const st = questState(r, q, view);
        const isOpenRow = ui.openQuest === q.id;
        const cls = st.status === 'done' ? 'sblink-q-done' : st.status === 'failed' ? 'sblink-q-failed' : 'sblink-q-active';
        let extra = '';
        if (st.status === 'done') {
            extra += `<div class="sblink-qmeta"><span class="sblink-code sblink-clear">CLEAR</span> · ${esc(st.entry.byHand ? t('by_hand') : st.entry.key ? t('by_ai') : t('by_hand'))}</div>`;
            if (st.entry.reason) extra += `<div class="sblink-qwhy"><span class="sblink-code">${esc(t('evidence'))}</span> “${esc(st.entry.reason)}”</div>`;
        } else if (st.rerolled) {
            extra += `<div class="sblink-qwhy sblink-rerolled">${icon('undo')}<span>${esc(t('rerolled', { pts: rate(q.reward) }))}</span></div>`;
        } else if (st.status === 'failed') extra += `<div class="sblink-qmeta">${esc(t('failed'))}</div>`;
        else extra += `<div class="sblink-qmeta"><span class="sblink-code">IN PROGRESS</span></div>`;
        let actions = '';
        if (isOpenRow && st.status === 'done') actions = `<div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm sblink-btn-danger" data-undo="${esc(q.id)}"><span class="sblink-ell">${esc(t('undo_clear'))}</span></button></div>`;
        if (isOpenRow && st.status === 'active') actions = `<div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm" data-clear="${esc(q.id)}"><span class="sblink-ell">${esc(t('clear_hand'))}</span></button></div>`;
        body += `<div class="sblink-quest ${cls}${isOpenRow ? ' sblink-quest-open' : ''}" data-quest="${esc(q.id)}" role="button" tabindex="0">
          <div class="sblink-qmain"><i class="sblink-qdia"></i><span class="sblink-qname">${esc(q.name)}</span><b class="sblink-pts">+${rate(q.reward)}P</b></div>
          ${extra}${actions}</div>`;
    }
    body += `<div class="sblink-hint sblink-center">${esc(t('settle_note'))}</div>`;
    const checking = isChecking();
    const foot = checking
        ? `<button type="button" class="sblink-btn sblink-btn-wide" data-act="cancelCheck">${hexMark('sblink-spin')}<span class="sblink-ell">${esc(t('checking'))} · ${esc(t('cancel'))}</span></button>`
        : `<button type="button" class="sblink-btn sblink-btn-wide" data-act="checkNow"><span class="sblink-ell">${esc(t('check_now'))}</span></button>`;
    return { body, foot };
}

// ----- sub pages -----
function subBody() {
    if (ui.view === 'gear') return { body: gearHtml(), foot: '' };
    if (ui.view === 'text') {
        const k = ui.textKey;
        const row = ROWS[k];
        const v = String(getValue(k) || '');
        return {
            body: `<div class="sblink-rowlabel">${esc(t(`set_${k}`))}</div>
              <div class="sblink-hint">${esc(t(`set_${k}_hint`))}</div>
              <textarea class="sblink-ta" data-ta="${esc(k)}" placeholder="${esc(t(`set_${k}_ph`))}" maxlength="${row?.k === 'world' ? 2000 : 4000}">${esc(v)}</textarea>`,
            foot: `<button type="button" class="sblink-btn" data-act="back"><span class="sblink-ell">${esc(t('cancel'))}</span></button>
              <button type="button" class="sblink-btn sblink-btn-main" data-act="saveText"><span class="sblink-ell">${esc(t('save'))}</span></button>`,
        };
    }
    if (ui.view === 'life') {
        const r = room();
        const l = lifeNow(r);
        const f = (k) => `<label class="sblink-field"><span class="sblink-code">${esc(t(`life_${k}`))}</span><input class="sblink-input" data-life="${k}" maxlength="60" value="${esc(l[k] || '')}" placeholder="${esc(t(`life_${k}_ph`))}"></label>`;
        return {
            body: `${f('date')}${f('time')}${f('weather')}${f('place')}${f('plan')}<div class="sblink-hint">${esc(t('life_edit_hint'))}</div>`,
            foot: `<button type="button" class="sblink-btn" data-act="back"><span class="sblink-ell">${esc(t('cancel'))}</span></button>
              <button type="button" class="sblink-btn sblink-btn-main" data-act="saveLife"><span class="sblink-ell">${esc(t('save'))}</span></button>`,
        };
    }
    return { body: '', foot: '' };
}

// ----- confirm box inside the window -----
function modalHtml() {
    const m = ui.modal;
    return `<div class="sblink-modal"><div class="sblink-modalbox sblink-holo">
      <div class="sblink-code">${esc(m.code || 'SYS.CONFIRM')}</div>
      <div class="sblink-modaltitle">${esc(m.title)}</div>
      ${m.body ? `<div class="sblink-hint">${esc(m.body)}</div>` : ''}
      <div class="sblink-popbtns"><button type="button" class="sblink-btn" data-modal="no"><span class="sblink-ell">${esc(t('cancel'))}</span></button>
      <button type="button" class="sblink-btn sblink-btn-main" data-modal="yes"><span class="sblink-ell">${esc(m.yes)}</span></button></div></div></div>`;
}

// ---------- clicks ----------
async function onClick(e) {
    const el = e.target.closest('button, [data-quest], [data-fold]');
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.modal) { const m = ui.modal; ui.modal = null; render(); if (d.modal === 'yes') await m?.run?.(); return; }
    if (d.tab) { ui.view = d.tab; ui.titlePick = false; ui.openQuest = null; return render(); }
    if (d.side) { ui.shopSide = d.side; ui.selShop = null; return render(); }
    if (d.shop) { ui.selShop = ui.selShop === d.shop ? null : d.shop; return render(); }
    if (d.bag) { ui.selBag = ui.selBag === d.bag ? null : d.bag; return render(); }
    if (d.title !== undefined) { const r = room(); if (r) { r.title = d.title; save(); } ui.titlePick = false; bus.emit('change'); return render(); }
    if (d.clear) { clearByHand(d.clear); ui.openQuest = null; return render(); }
    if (d.undo) { undoClear(d.undo); ui.openQuest = null; return render(); }
    if (d.quest && !e.target.closest('button')) { ui.openQuest = ui.openQuest === d.quest ? null : d.quest; return render(); }
    if (d.fold) { toggleGroup(d.fold); return render(); }
    if (d.set) {
        const row = ROWS[d.set];
        let v = d.val;
        if (row.kind === 'toggle') v = d.val === '1';
        else if (row.k === 'pointRate') v = Number(v);
        await setValue(d.set, v);
        return;
    }
    if (d.run) return runButton(d.run);
    if (d.text) { ui.textKey = d.text; ui.view = 'text'; return render(); }
    switch (d.act) {
        case 'close': return closeWindow();
        case 'gear': ui.back = TABS.includes(ui.view) ? ui.view : 'status'; ui.view = 'gear'; return render();
        case 'back': ui.view = ui.view === 'text' ? 'gear' : (ui.back || 'status'); return render();
        case 'roomOn': await switchOn(); return render();
        case 'titlePick': ui.titlePick = !ui.titlePick; return render();
        case 'lifeEdit': ui.back = 'status'; ui.view = 'life'; return render();
        case 'saveLife': {
            const fields = {};
            $id('sblink-win').querySelectorAll('[data-life]').forEach(inp => { fields[inp.dataset.life] = inp.value.trim().slice(0, 60); });
            setLife(fields);
            ui.view = 'status';
            return render();
        }
        case 'saveText': {
            const ta = $id('sblink-win').querySelector('[data-ta]');
            if (ta) await setValue(ta.dataset.ta, ta.value);
            ui.view = 'gear';
            return render();
        }
        case 'nextDay':
            ui.modal = { title: t('next_day_q'), body: t('next_day_body'), yes: t('next_day'), code: 'SYS.CONFIRM // DAY', run: async () => { await nextDay(1); } };
            return render();
        case 'buy': {
            const r = room();
            const items = ui.shopSide === 'daily' ? r.shop.daily : standingItems(r);
            const it = items.find(x => x.id === ui.selShop);
            if (!it) return;
            ui.modal = {
                title: t('buy_q', { name: it.name }), body: `${points(r)}P → ${points(r) - it.price}P`, yes: `${t('buy')} ${it.price}P`, code: 'SYS.CONFIRM // SHOP',
                run: async () => { if (buy(it, ui.shopSide)) notice(t('bought', { name: it.name })); else notice(t('not_enough')); render(); },
            };
            return render();
        }
        case 'restock':
            ui.restocking = true; render();
            try { const ok = await restockStanding(); if (!ok) notice(t('make_failed'), 'warn'); } finally { ui.restocking = false; render(); }
            return;
        case 'use': {
            const r = room();
            const b = r.bag.find(x => x.id === ui.selBag);
            if (!b) return;
            ui.modal = {
                title: t('use_q', { name: b.name }), body: b.kind === 'reroll' ? t('reroll_hint') : t('use_hint'), yes: t('use'), code: 'SYS.CONFIRM // ITEM',
                run: async () => {
                    const u = await useItem(b.id);
                    if (!u) return;
                    if (!room()?.bag.some(x => x.id === b.id)) ui.selBag = null;
                    popup({ tag: 'ITEM', code: 'SYS.LOG // ITEM', title: t('pop_used'), lines: [`${icon(u.icon)}<span class="sblink-ell">${esc(u.name)}</span>${rarityTag(u.rarity)}`], body: esc(u.kind === 'reroll' ? t('reroll_done') : t('use_hint')) });
                    render();
                },
            };
            return render();
        }
        case 'checkNow':
            ui.checkingNow = true; render();
            bus.emit('checkNow');
            return;
        case 'cancelCheck': cancelCheck(); return render();
    }
}

function onChange(e) {
    const sel = e.target.closest('[data-sel]');
    if (sel) setValue(sel.dataset.sel, sel.value);
}

export function windowView() { return ui.view; }
export { runCheck };
