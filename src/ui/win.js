// The System window (B: a floating window that leaves the chat visible behind it).
// Tabs on top: Status / Shop / Bag / Quests, then ⚙ and ✕. Same size on every tab; only the inside scrolls.

import { t } from '../i18n.js';
import { settings, room, currentChatId, save } from '../store.js';
import {
    active, chatView, points, todays, questState, clearByHand, undoClear, giveUpHidden, lifeNow, setLife, nextDay, ownerName,
    standingItems, dailyReady, stockDaily, restockStanding, RESTOCK_COST, buy, useItem, tutorialStep, skipTutorial, switchOn, rate, bus,
    goalNow, condsOf, suddenLeft, setGoal, editGoal, nextStage, isMakingStage, goalLocked, isGivingGoal, goalGiveFailed, giveGoal,
    diffOf, penaltyFor, debuffsNow, priceOf, penaltyQuests, toneOf, warnFor, warnCount, WARN_MAX,
    skillsOf, hiddenOpen, seeSkill, useSkill, openGacha, isDrawing, gradeRarity, veiled,
} from '../engine.js';
import { runCheck, isChecking, cancelCheck } from '../ai.js';
import {
    cycleOn, cycleDay, eventsOf, evState, omens, setEvent, journalNow, knownLines, addLine, editLine, dropLine, regress, stopTemp, isSorting, sortLog,
    setupCycle, setEventsText, eventLine, fillCycle,
} from '../cycle.js';
import { gearHtml, setValue, runButton, toggleGroup, openGroup, ROWS, getValue, setScope } from '../prefs.js';
import { icon, hexMark } from '../icons.js';
import { esc, $id, viewport, safeInsets, isPhone, motionOn } from './util.js';
import { notice, popup, diamonds, gachaShow, warnDias, fitPop } from './pop.js';
import { skillTile, blankTile, honeycomb, gradeBadge, gradeClass, tag } from './skills.js';

const TABS = ['status', 'shop', 'bag', 'quests'];
const ui = {
    view: 'status', back: 'status', shopSide: 'daily', selShop: null, selBag: null, openQuest: null,
    modal: null, textKey: '', titlePick: false, stocking: false, restocking: false, checkingNow: false,
    goalDraft: null, goalMode: 'new', suggesting: false, makingStage: false,
    skillFilter: 'all', selSkill: null, skillId: null,
    scroll: {},      // where each tab / page was scrolled to (kept until SillyTavern reloads)
    drafts: {},      // unsaved "set the goal" drafts, per chat (‹ Back keeps them, Cancel drops them)
    rest: null,      // the window's place before the keyboard came up
};
const SUBS = ['gear', 'text', 'life', 'goal', 'goalEdit', 'skill', 'cycle', 'cycleGo', 'cycleSetup'];
const SUB_CODE = { gear: 'CONFIG', life: 'DAY', text: 'TEXT', goal: 'GOAL', goalEdit: 'GOAL', skill: 'SKILL', cycle: 'CYCLE', cycleGo: 'CYCLE', cycleSetup: 'CYCLE' };
let hooks = { opened: () => {}, closed: () => {}, regressed: () => {} };
export function setWinHooks(h) { hooks = { ...hooks, ...h }; }

export const isOpen = () => !!$id('sblink-win');

const RC = { common: 'sblink-r-common', rare: 'sblink-r-rare', epic: 'sblink-r-epic', legendary: 'sblink-r-legendary' };
const rarityTag = (r) => `<b class="sblink-rar ${RC[r] || ''}">${esc(t(`rarity_${r}`))}</b>`;
const HUD_ICON = '<svg class="sblink-hudico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/><path d="M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="currentColor" stroke="none"/></svg>';
const HEX = '<svg class="sblink-cellhex" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,1.5 21.5,7 21.5,17 12,22.5 2.5,17 2.5,7"/></svg>';
const SPARK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0L6 4L10 5L6 6L5 10L4 6L0 5L4 4Z"/></svg>';

/** One shop / bag square: grade colour, a hex stand behind the icon, the name, and a bar at the bottom (price or count). Higher grades shine more. */
function cellHtml(x, { on, data, label, bar, barCls = '', extra = '' }) {
    return `<button type="button" class="sblink-cell ${RC[x.rarity] || 'sblink-r-common'}${on ? ' sblink-cell-on' : ''}${x.sold ? ' sblink-sold' : ''}" ${data}>
        ${x.rarity === 'legendary' ? `<i class="sblink-cellsweep"></i><span class="sblink-spark sblink-spark1">${SPARK}</span><span class="sblink-spark sblink-spark2">${SPARK}</span>` : ''}
        <span class="sblink-cellrar">${esc(label)}</span>${extra}
        <span class="sblink-cellart">${HEX}${icon(x.icon, 'sblink-cellico')}</span>
        <span class="sblink-cellname sblink-ell">${esc(x.cellName || x.name)}</span>
        <span class="sblink-price${barCls}">${bar}</span>
        ${x.sold ? '<span class="sblink-stamp">SOLD</span>' : ''}
      </button>`;
}

// ---------- open / close ----------
export function openWindow(tab, opts = {}) {
    if (!settings().enabled) return openOffline();
    if (!$id('sblink-win')) setScope('gear', 'room');   // 0.6.8: opening the window starts on [This chat]
    if (tab && TABS.includes(tab)) ui.view = tab;
    if (opts.skill) { ui.skillFilter = 'all'; ui.selSkill = opts.skill; seeSkill(opts.skill); }
    // 0.6.5: straight to one part of ⚙ (the first-time guide), or to one quest (the quest panel)
    if (opts.gear) { ui.back = TABS.includes(ui.view) ? ui.view : 'status'; ui.view = 'gear'; openGroup(opts.gear); setScope('gear', ['screen', 'button'].includes(opts.gear) ? 'common' : 'room'); }
    if (opts.quest) { ui.view = 'quests'; ui.openQuest = opts.quest; }
    // 0.8.0: regression pages
    if (opts.cycle) { ui.back = TABS.includes(ui.view) ? ui.view : 'status'; ui.view = opts.cycle; if (opts.cycle === 'cycleGo') ui.cycleDraft = null; if (opts.cycle === 'cycleSetup') ui.setupDraft = null; }
    if (!TABS.includes(ui.view) && !SUBS.includes(ui.view)) ui.view = 'status';
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
        // the keyboard slides up over a moment: look again once it has settled
        win.addEventListener('focusin', (e) => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { setTimeout(place, 320); setTimeout(place, 650); } });
        win.addEventListener('focusout', () => setTimeout(() => { if (!keyboardUp()) place(); }, 320));
    }
    win.className = `sblink-win sblink-holo${motionOn() ? ' sblink-moving' : ''}`;
    render();
    place();
    if (opts.gear || opts.quest) {
        const el = opts.gear ? win.querySelector(`[data-group="${opts.gear}"]`) : win.querySelector(`[data-quest="${CSS.escape(opts.quest)}"]`);
        const body = win.querySelector('.sblink-body');
        if (el && body) body.scrollTop = Math.max(0, body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 6);
    }
    const r = room();
    if (active(r)) { tutorialStep(r, 0); save(); }
    hooks.opened();
}

export function closeWindow() {
    keepScroll();
    if (ui.view === 'cycleGo') { stopTemp(); ui.cycleDraft = null; } // closed without going back: as if never begun
    if (ui.view === 'goalEdit') stashDraft();
    $id('sblink-win')?.remove();
    $id('sblink-shade')?.remove();
    ui.modal = null; ui.titlePick = false;
    if (SUBS.includes(ui.view)) ui.view = ui.back || 'status';
    hooks.closed();
}

export function refreshWin() { if (isOpen()) render(); }

/** Is the phone keyboard up for a box inside the window? */
function keyboardUp() {
    const vv = window.visualViewport;
    const el = document.activeElement;
    return !!(vv && el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && $id('sblink-win')?.contains(el) && vv.height < window.innerHeight - 80);
}

export function place() {
    const win = $id('sblink-win');
    if (!win) return;
    // The keyboard is up: keep the window's size and place, let the keyboard cover its lower part,
    // and scroll the box being typed in up above the keyboard instead.
    if (ui.rest && keyboardUp()) {
        const vv = window.visualViewport;
        win.style.width = `${ui.rest.w}px`;
        win.style.height = `${ui.rest.h}px`;
        win.style.left = `${ui.rest.left + Math.round(vv.offsetLeft || 0)}px`;
        win.style.top = `${ui.rest.top + Math.round(vv.offsetTop || 0)}px`;
        showField();
        return;
    }
    unpadBody();
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
    if (!vp.y && !vp.x) ui.rest = { w: Math.round(w), h: Math.round(Math.max(260, h)), left: Math.round((vp.w - w) / 2), top: Math.round(topGap + Math.max(0, (vp.h - topGap - botGap - h) / 2)) };
}

/** Scroll the box being typed in so it sits above the keyboard (room is added at the bottom for the last box). */
function showField() {
    const win = $id('sblink-win');
    const el = document.activeElement;
    const body = win?.querySelector('.sblink-body');
    const vv = window.visualViewport;
    if (!body || !vv || !el || !body.contains(el)) return;
    const seeBottom = vv.offsetTop + vv.height - 12;
    const hidden = Math.max(0, win.getBoundingClientRect().bottom - seeBottom);
    body.style.paddingBottom = `${Math.round(hidden + 14)}px`;
    const br = body.getBoundingClientRect();
    const seeTop = Math.max(br.top, vv.offsetTop) + 8;
    const r = el.getBoundingClientRect();
    const fieldBottom = Math.min(r.bottom, r.top + 120);   // a tall text box: its first lines are enough
    if (fieldBottom > seeBottom) body.scrollTop += fieldBottom - seeBottom;
    else if (r.top < seeTop) body.scrollTop -= seeTop - r.top;
}

function unpadBody() {
    const body = $id('sblink-win')?.querySelector('.sblink-body');
    if (body && body.style.paddingBottom) body.style.paddingBottom = '';
}

/** Remember how far this tab / page was scrolled. */
function keepScroll() {
    const body = $id('sblink-win')?.querySelector('.sblink-body');
    if (body?.dataset.view) ui.scroll[body.dataset.view] = body.scrollTop;
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
    fitPop(wrap);
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
    keepScroll();
    const keep = ui.scroll[ui.view] || 0;
    if (ui.view === 'goalEdit' && !ui.freshDraft) readDraft();
    if (ui.view === 'cycleGo') readGo();
    if (ui.view === 'cycleSetup' && !ui.freshSetup) readSetup();
    ui.freshSetup = false;
    ui.freshDraft = false;
    const inSub = SUBS.includes(ui.view);
    const r = room();
    win.classList.toggle('sblink-hell', active(r) && diffOf(r) === 'hell');
    const tone = active(r) ? toneOf(r) : 'game';
    for (const x of ['game', 'star', 'threat']) win.classList.toggle(`sblink-tn-${x}`, x === tone);
    const tabs = inSub
        ? `<button type="button" class="sblink-backbtn" data-act="back"><span class="sblink-ell">‹ ${esc(t('back'))}</span></button>
           <div class="sblink-subtitle sblink-ell">${esc(t(`sub_${ui.view}`))} <span class="sblink-code">// ${SUB_CODE[ui.view]}</span></div>`
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

const sec = (title, extra = '', cls = '') => `<div class="sblink-sechead${cls ? ` ${cls}` : ''}"><span class="sblink-dia">◆</span><span>${esc(title)}</span><i class="sblink-secline"></i>${extra}</div>`;

// ----- status -----
function statusTab(r) {
    const view = chatView();
    const pts = points(r, view);
    const name = ownerName(r);
    const initial = Array.from(name.trim())[0] || '?';
    const tut = r.tutorial;
    const tutDone = tut.done.filter(Boolean).length;
    const sub = tut.state === 'active' ? t('tut_progress', { n: tutDone }) : t('day_n', { n: r.day });
    const list = todays(r).filter(q => !veiled(r, q, view));
    const done = list.filter(q => questState(r, q, view).status === 'done').length;
    const life = lifeNow(r, view);
    const cell = (k, ic) => `<div class="sblink-lifecell">${icon(ic)}<div class="sblink-code">${esc(t(`life_${k}`))}</div><div class="sblink-lifeval sblink-ell">${esc(k === 'date' ? (life.date || t('day_n', { n: r.day })) : (life[k] || '—'))}</div></div>`;
    const titles = r.titles || [];
    let body = diffOf(r) === 'hell' ? `<div class="sblink-hellband"><span class="sblink-hellchip">HELL</span><span class="sblink-ell">${esc(t('hell_band'))}</span></div>` : '';
    body += `
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
    const debuffs = debuffsNow(r, view);
    if (debuffs.length) {
        body += sec(t('debuffs'), `<span class="sblink-code sblink-neg">${debuffs.length}</span>`)
            + debuffs.map(d => `<div class="sblink-debuff"><span class="sblink-debuffchip">${esc(t('debuff_pricey'))}</span><span class="sblink-code sblink-neg">${esc(t('until_next_day'))}</span></div>`).join('')
            + (debuffs.some(d => d.questId) ? `<div class="sblink-hint">${esc(t('debuff_lift_hint'))}</div>` : '');
    }
    const warns = warnCount(r, view);
    if (toneOf(r) === 'threat' || warns) {
        body += sec(t('warnings'), `<span class="sblink-code sblink-neg">${warns} / ${WARN_MAX}</span>`)
            + `<div class="sblink-warnbox">${warnDias(Math.min(WARN_MAX, warns))}<b>${warns} / ${WARN_MAX}</b></div><div class="sblink-hint">${esc(t('warn_hint'))}</div>`;
    }
    body += cycleBlock(r, view);
    body += `<button type="button" class="sblink-todayline" data-tab="quests"><span class="sblink-code">TODAY</span><span class="sblink-ell">${esc(t('today_quests', { done, all: list.length }))}</span><span>▸</span></button>`;
    body += skillsBlock(r, view);
    const foot = `${r.lifeMode ? `<button type="button" class="sblink-btn" data-act="lifeEdit"><span class="sblink-ell">${esc(t('edit'))}</span></button>` : ''}
      <button type="button" class="sblink-btn sblink-btn-main" data-act="nextDay"><span class="sblink-ell">${esc(t('next_day'))} ▸</span></button>`;
    return { body, foot };
}

// ----- 0.8.0 regression: the Status tab's part, the life record, "where do we start?", the confirm page -----
const SRC_TAG = { ai: 'src_ai', quest: 'src_quest', flow: 'src_flow', star: 'src_star', hand: 'src_hand', log: 'src_log' };
const srcTag = (src) => `<span class="sblink-code sblink-srctag sblink-src-${src}">${esc(t(SRC_TAG[src] || 'src_ai'))}</span>`;
const dayWord = (d) => (d ? t('cyc_day', { n: d }) : '—');

function cycleBlock(r, view) {
    if (!cycleOn(r)) return '';
    const c = r.cycle;
    const d = cycleDay(r, view);
    const om = new Set(omens(r, view).map(ev => ev.id));
    let html = sec(t('cyc_sec'), `<span class="sblink-code">CYCLE ${String(c.n).padStart(2, '0')}</span>`, 'sblink-cychead');
    html += `<div class="sblink-cycnow"><span class="sblink-code">NOW</span><b class="sblink-ell">${esc(t('cyc_now', { n: c.n, d }))}</b></div>`;
    html += `<div class="sblink-cycrow"><span class="sblink-code">${esc(t('cyc_truth'))}</span><span class="sblink-ell">${esc(c.truth || '—')}</span></div>`;
    html += `<div class="sblink-cycrow"><span class="sblink-code">${esc(t('cyc_memo', { name: ownerName(r) }))}</span><span class="sblink-ell">${esc(c.memo || '—')}</span></div>`;
    if (c.knowers.length) html += `<div class="sblink-hint">${esc(t('cyc_knowers', { list: c.knowers.join(', ') }))}</div>`;
    html += `<div class="sblink-cycsub">${esc(t('cyc_events'))}</div>`;
    const evs = eventsOf(r);
    if (!evs.length) html += `<div class="sblink-hint">${esc(t('cyc_none'))}</div>`;
    for (const ev of evs) {
        const st = evState(r, ev, view);
        html += `<button type="button" class="sblink-cycev sblink-ev-${st}${ui.selEvent === ev.id ? ' sblink-on' : ''}" data-ev="${esc(ev.id)}">
            <span class="sblink-code">${esc(ev.day ? t('cyc_day', { n: ev.day }) : ev.when || '?')}</span><span class="sblink-ell">${esc(ev.what)}</span>
            ${om.has(ev.id) ? `<span class="sblink-omen">${esc(t('omen'))}</span>` : ''}<span class="sblink-evst">${esc(t(`ev_${st}`))}</span></button>`;
        if (ui.selEvent === ev.id) {
            html += `<div class="sblink-chips sblink-evmenu">${['happened', 'blocked', 'changed'].map(x => `<button type="button" class="sblink-chip${ev.byHand && ev.state === x ? ' sblink-chip-on' : ''}" data-evset="${x}"><span class="sblink-ell">${esc(t(`ev_${x}`))}</span></button>`).join('')}
              <button type="button" class="sblink-chip${!ev.byHand ? ' sblink-chip-on' : ''}" data-evset=""><span class="sblink-ell">${esc(t('ev_auto'))}</span></button>
              <button type="button" class="sblink-chip sblink-evnow" data-evset="now"><span class="sblink-ell">${esc(t('ev_now'))}</span></button></div>`;
        }
    }
    html += `<div class="sblink-cycbtns"><button type="button" class="sblink-btn" data-act="cycleEdit"><span class="sblink-ell">${esc(t('cyc_edit'))}</span></button>
      <button type="button" class="sblink-btn" data-act="cycleLog"><span class="sblink-ell">${esc(t('cyc_journal'))}</span></button></div>
      <button type="button" class="sblink-btn sblink-btn-wide sblink-cycgo" data-act="cycleGo"><span class="sblink-ell">${esc(t('cyc_next'))}</span></button>`;
    return html;
}

/** ⑧ this life's record (and the earlier lives). */
function cyclePage() {
    const r = room();
    if (!r?.cycle) return { body: '', foot: '' };
    const c = r.cycle;
    const view = chatView();
    const lines = journalNow(r, view);
    const known = knownLines(r, view);
    let body = `<div class="sblink-cycsub">${esc(t('jn_this', { n: c.n }))}</div>`;
    if (!lines.length && !known.length) body += `<div class="sblink-hint">${esc(t('jn_empty'))}</div>`;
    for (const j of lines) {
        body += `<div class="sblink-jline${j.cand ? ' sblink-jcand' : ''}">${srcTag(j.star ? 'star' : j.src)}<span class="sblink-code">${esc(dayWord(j.day))}</span>
          <input class="sblink-input sblink-jinput" data-jl="${esc(j.id)}" value="${esc(j.text)}" maxlength="160">
          <button type="button" class="sblink-x" data-jdrop="${esc(j.id)}" aria-label="${esc(t('cancel'))}">${icon('close')}</button></div>`;
    }
    for (const k of known) body += `<div class="sblink-jline sblink-jknown">${srcTag(k.src)}<span class="sblink-code">${esc(dayWord(k.day))}</span><span class="sblink-ell">${esc(k.text)}</span></div>`;
    body += `<div class="sblink-jadd"><input class="sblink-input" data-jadd maxlength="160" placeholder="${esc(t('jn_add_ph'))}"><button type="button" class="sblink-btn sblink-btn-sm" data-act="jAdd"><span class="sblink-ell">${esc(t('jn_add'))}</span></button></div>`;
    if (c.past.length) {
        body += `<div class="sblink-cycsub">${esc(t('jn_past'))}</div>`;
        for (const p of [...c.past].reverse()) {
            body += `<div class="sblink-jpast"><div class="sblink-code">${esc(t('jn_past_line', { n: p.n, days: p.days, pts: p.pts }))}</div>${(p.journal || []).map(x => `<div class="sblink-hint sblink-ell">◇ ${esc(x)}</div>`).join('')}</div>`;
        }
    }
    return { body, foot: '' };
}

/** ⑦ "Where do we start?" — and, once answered, editing the truth, memory, events and who remembers. */
function setupPage() {
    const r = room();
    const c = r?.cycle;
    if (!c) return { body: '', foot: '' };
    const d = ui.setupDraft ||= { again: c.set ? true : null, n: Math.max(2, c.n), truth: c.truth, memo: c.memo, back: c.back, events: eventsOf(r).map(eventLine).join('\n'), knowers: c.knowers.join(', '), filling: false };
    const who = ownerName(r);
    let body = '';
    if (!c.set) {
        body += `<div class="sblink-poptitle">${esc(t('setup_q'))}</div><div class="sblink-radios" role="radiogroup">
          ${[['first', false], ['again', true]].map(([k, v]) => `<button type="button" class="sblink-radio${d.again === v ? ' sblink-radio-on' : ''}" data-setup="${k}" role="radio" aria-checked="${d.again === v}">
            <i class="sblink-radiodot"></i><span class="sblink-radiotext"><b class="sblink-radioname">${esc(t(`setup_${k}`))}</b><span class="sblink-radiodesc">${esc(t(`setup_${k}_d`))}</span></span></button>`).join('')}</div>`;
    }
    if (d.again) {
        const f = (k, label, hint, tag = 'input', extra = '') => `<label class="sblink-field"><span class="sblink-code">${esc(label)}</span>
            ${tag === 'input' ? `<input class="sblink-input" data-sd="${k}" value="${esc(d[k] ?? '')}"${extra}>` : `<textarea class="sblink-ta sblink-ta-s" data-sd="${k}"${extra}>${esc(d[k] ?? '')}</textarea>`}</label>${hint ? `<div class="sblink-hint">${esc(hint)}</div>` : ''}`;
        if (!c.set) body += `<div class="sblink-cycbtns"><button type="button" class="sblink-btn" data-act="setupFill"${d.filling ? ' disabled' : ''}><span class="sblink-ell">${esc(d.filling ? t('setup_filling') : t('setup_ai'))}</span></button>
            <button type="button" class="sblink-btn" data-act="setupRandom"${d.filling ? ' disabled' : ''}><span class="sblink-ell">${esc(t('setup_random'))}</span></button></div>`;
        body += f('n', t('setup_n'), '', 'input', ' inputmode="numeric" maxlength="3"')
            + f('truth', t('setup_truth'), t('setup_truth_hint'), 'ta', ' maxlength="2000"')
            + f('memo', t('setup_memo', { name: who }), t('setup_memo_hint'), 'ta', ' maxlength="2000"')
            + f('events', t('setup_events'), t('setup_events_hint'), 'ta', ` placeholder="${esc(t('go_add_ph'))}"`)
            + f('back', t('setup_back'), '', 'input', ` maxlength="120" placeholder="${esc(t('go_back_ph'))}"`)
            + f('knowers', t('setup_knowers'), t('setup_knowers_hint', { name: who }), 'input', ' maxlength="200"');
    }
    return {
        body,
        foot: `<button type="button" class="sblink-btn" data-act="back"><span class="sblink-ell">${esc(t('cancel'))}</span></button>
          <button type="button" class="sblink-btn sblink-btn-main" data-act="setupSave"${d.again === null ? ' disabled' : ''}><span class="sblink-ell">${esc(t('save'))}</span></button>`,
    };
}

function readSetup() {
    const d = ui.setupDraft;
    if (!d) return;
    $id('sblink-win')?.querySelectorAll('[data-sd]').forEach(el => { d[el.dataset.sd] = el.value; });
}

/** ③④ [Go back?] */
function goPage() {
    const r = room();
    const c = r?.cycle;
    if (!c) return { body: '', foot: '' };
    const view = chatView();
    const d = ui.cycleDraft ||= { mode: c.mode, keepItem: '', keepSkills: false, off: {}, extra: '', back: '', backText: '', tried: false };
    const lines = journalNow(r, view);
    const known = knownLines(r, view);
    // nothing on record yet: the AI puts it down from the story, once (the page can be used meanwhile)
    if (!lines.length && !d.tried && !isSorting()) { d.tried = true; setTimeout(runSort, 0); }
    const sortingNow = isSorting();
    const open = r.quests.filter(q => ['active', 'offered'].includes(questState(r, q, view).status)).length;
    const bag = r.bag.filter(b => b.count > 0);
    const part = (k, inner) => `<div class="sblink-gosec"><div class="sblink-cycsub"><span class="sblink-dia">◆</span> ${esc(t(k))}</div>${inner}</div>`;
    let body = `<div class="sblink-poptitle">${esc(t('go_title'))}</div><div class="sblink-hint">${esc(t('go_now', { n: c.n }))}</div>`;
    body += part('go_keep', `<div class="sblink-hint">${esc(t('go_keep_v'))}</div>`);
    body += part('go_lose', d.mode === 'all' ? `<div class="sblink-golose"><s>${esc(t('go_lose_all'))}</s></div>`
        : `<div class="sblink-golose"><s>${esc(t('go_lose_pts', { n: points(r, view) }))}</s><s>${esc(t('go_lose_bag', { n: bag.length }))}</s><s>${esc(t('go_lose_q', { n: open }))}</s></div>`);
    body += part('go_mode', `<div class="sblink-chips">${['memory', 'one', 'all'].map(x => `<button type="button" class="sblink-chip${d.mode === x ? ' sblink-chip-on' : ''}" data-gomode="${x}"><span class="sblink-ell">${esc(t(`opt_cycleMode_${x}`))}</span></button>`).join('')}</div>`);
    if (d.mode === 'one') {
        body += part('go_take', (bag.length ? `<div class="sblink-chips">${bag.map(b => `<button type="button" class="sblink-chip${d.keepItem === b.id ? ' sblink-chip-on' : ''}" data-gotake="${esc(b.id)}"><span class="sblink-ell">${esc(b.name)}</span></button>`).join('')}</div>` : `<div class="sblink-hint">${esc(t('go_take_none'))}</div>`)
            + `<div class="sblink-rowmain"><span class="sblink-rowlabel">${esc(t('go_take_skills'))}</span><button type="button" class="sblink-tog${d.keepSkills ? ' sblink-on' : ''}" data-act="goSkills" role="switch" aria-checked="${d.keepSkills}"><i></i></button></div>`);
    }
    let rec = `<div class="sblink-hint">${esc(t('go_log_hint'))}</div>`;
    if (sortingNow) rec += `<div class="sblink-gosort">${esc(t('go_sorting'))}</div>`;
    else if (d.failed) rec += `<div class="sblink-gosort sblink-neg">${esc(t('go_sort_fail'))}</div>`;
    const item = (id, src, day, text, editable) => `<div class="sblink-jline${src === 'ai' ? ' sblink-jcand' : ''}"><button type="button" class="sblink-check${d.off[id] ? '' : ' sblink-on'}" data-gopick="${esc(id)}" role="checkbox" aria-checked="${!d.off[id]}">${d.off[id] ? '' : '✓'}</button>
        ${srcTag(src)}<span class="sblink-code">${esc(dayWord(day))}</span>${editable ? `<input class="sblink-input sblink-jinput" data-jl="${esc(id)}" value="${esc(text)}" maxlength="160">` : `<span class="sblink-ell">${esc(text)}</span>`}</div>`;
    for (const j of lines) rec += item(j.id, j.star ? 'star' : j.src, j.day, j.text, true);
    for (const k of known) rec += item(k.id, k.src, k.day, k.text, false);
    rec += `<textarea class="sblink-ta sblink-ta-s" data-goextra placeholder="${esc(t('go_add_ph'))}">${esc(d.extra)}</textarea>`;
    rec += `<div class="sblink-cycbtns"><button type="button" class="sblink-btn" data-act="goSort"${sortingNow ? ' disabled' : ''}><span class="sblink-ell">${esc(t('go_resort'))}</span></button></div>`;
    body += part('go_log', rec);
    body += part('go_back', `<div class="sblink-chips">${['first', 'text'].map(x => `<button type="button" class="sblink-chip${(d.back || 'first') === x ? ' sblink-chip-on' : ''}" data-goback="${x}"><span class="sblink-ell">${esc(t(`go_back_${x}`))}</span></button>`).join('')}</div>`
        + (d.back === 'text' ? `<input class="sblink-input" data-gobacktext maxlength="120" value="${esc(d.backText)}" placeholder="${esc(t('go_back_ph'))}">` : ''));
    body += part('go_where', `<div class="sblink-hint">◇ ${esc(t('go_where_here'))}</div>`);
    return {
        body,
        foot: `<button type="button" class="sblink-btn" data-act="goStop"><span class="sblink-ell">${esc(t('stop'))}</span></button>
          <button type="button" class="sblink-btn sblink-btn-main" data-act="goGo"${sortingNow ? ' disabled' : ''}><span class="sblink-ell">${esc(t('go_btn', { n: c.n + 1 }))}</span></button>`,
    };
}

function readGo() {
    const d = ui.cycleDraft;
    const win = $id('sblink-win');
    if (!d || !win) return;
    const ex = win.querySelector('[data-goextra]');
    if (ex) d.extra = ex.value;
    const bt = win.querySelector('[data-gobacktext]');
    if (bt) d.backText = bt.value;
}

async function runSort() {
    if (ui.cycleDraft) ui.cycleDraft.failed = false;
    render();
    const ok = await sortLog();
    if (ui.cycleDraft) ui.cycleDraft.failed = ok === false;
    render();
}

async function doRegress() {
    readGo();
    const r = room();
    const d = ui.cycleDraft;
    if (!r?.cycle || !d || isSorting()) return;
    const view = chatView();
    const pick = [...journalNow(r, view).map(j => ({ id: j.id, day: j.day, text: j.text })), ...knownLines(r, view)].filter(x => !d.off[x.id]);
    const lines = [...pick.map(x => `${x.day || ''} | ${x.text}`), ...String(d.extra || '').split('\n')].map(x => x.trim()).filter(x => x && x !== '|');
    const bag = r.bag.find(b => b.id === d.keepItem);
    const kept = d.mode === 'all' ? [t('opt_cycleMode_all')] : [bag && d.mode === 'one' ? bag.name : '', d.mode === 'one' && d.keepSkills && r.skills.length ? t('skills') : ''].filter(Boolean);
    const res = await regress(currentChatId(), { mode: d.mode, keepItem: d.keepItem, keepSkills: d.keepSkills, lines, back: d.back === 'text' ? d.backText : '' });
    if (!res) return;
    ui.cycleDraft = null;
    closeWindow();
    hooks.regressed(res, kept);
}

// ----- skills (㉖-B honeycomb, ㉗ detail) -----
const gradeWord = (g) => `${g} · ${t(`rarity_${gradeRarity(g)}`)}`;

function skillsBlock(r, view) {
    const all = skillsOf(r);
    const nA = all.filter(k => k.type === 'active').length;
    const f = ui.skillFilter;
    const list = all.filter(k => f === 'all' || k.type === f);
    let html = sec(t('skills'), `<span class="sblink-code">SYS.SKILL // GRID · ${all.length}</span>`);
    if (all.length) {
        const chip = (k, n) => `<button type="button" class="sblink-chip${f === k ? ' sblink-chip-on' : ''}" data-sfilter="${k}"><span class="sblink-ell">${esc(t(`skill_f_${k}`))} ${n}</span></button>`;
        html += `<div class="sblink-chips sblink-skillchips">${chip('all', all.length)}${chip('passive', all.length - nA)}${chip('active', nA)}</div>`;
    }
    // 0.6.9: no skills yet = the hint alone, centred (no empty hexagon)
    if (all.length) {
        const tiles = list.map(k => skillTile(k, { on: k.id === ui.selSkill, locked: !!k.hidden && !hiddenOpen(k, view) }));
        tiles.push(blankTile());
        html += honeycomb(tiles);
    } else html += `<div class="sblink-hint sblink-center sblink-skillnone">${esc(t('skill_none'))}</div>`;
    const sel = list.find(k => k.id === ui.selSkill);
    if (sel) {
        const open = hiddenOpen(sel, view);
        html += `<div class="sblink-skillcard ${gradeClass(sel.grade)}">
          <div class="sblink-skillcardhead"><b class="sblink-skillname sblink-ell">[${esc(sel.name)}]</b>${tag(gradeWord(sel.grade), 'sblink-stag-g')}${tag(t(`skill_${sel.type}`), 'sblink-stag-acc')}</div>
          <div class="sblink-detaildesc">${esc(sel.effect)}</div>
          ${open ? `<div class="sblink-hiddenfx"><b>${esc(t('skill_hidden'))} · </b>${esc(sel.hidden.effect)}</div>` : ''}
          <div class="sblink-skillbtns"><button type="button" class="sblink-btn" data-act="skillMore"><span class="sblink-ell">${esc(t('skill_more'))}</span></button>
          ${sel.type === 'active' ? `<button type="button" class="sblink-btn sblink-btn-main" data-act="skillUse"><span class="sblink-ell">${esc(t('use'))}</span></button>`
            : `<button type="button" class="sblink-btn" disabled><span class="sblink-ell">${esc(t('skill_always'))}</span></button>`}</div>
        </div>`;
    }
    return html;
}

function skillPage() {
    const r = room();
    const view = chatView();
    const k = skillsOf(r).find(x => x.id === ui.skillId);
    if (!k) return { body: `<div class="sblink-hint sblink-center">${esc(t('skill_gone'))}</div>`, foot: '' };
    const open = hiddenOpen(k, view);
    let body = `<div class="sblink-skillhero ${gradeClass(k.grade)}">${gradeBadge(k.grade, true)}
        <div class="sblink-skillbig">[${esc(k.name)}]</div>
        <div class="sblink-stags">${tag(gradeWord(k.grade), 'sblink-stag-g')}${tag(t(`skill_${k.type}`), 'sblink-stag-acc')}${tag(t(`skill_mode_${k.mode || 'life'}`))}${tag(t(`skill_from_${k.star ? 'star' : (k.from || 'gacha')}`))}</div></div>`;
    body += sec(t('skill_effect')) + `<div class="sblink-skilltext">${esc(k.effect)}</div>`;
    if (k.hidden) {
        body += sec(t('skill_hidden'), open ? '<span class="sblink-code sblink-goldtxt">UNLOCKED</span>' : '<span class="sblink-code">LOCKED</span>');
        body += open
            ? `<div class="sblink-hiddenfx"><b>✦ </b>${esc(k.hidden.effect)}</div>${k.hidden.reason ? `<div class="sblink-qwhy"><span class="sblink-code">${esc(t('evidence'))}</span> “${esc(k.hidden.reason)}”</div>` : ''}`
            : `<div class="sblink-hiddenlock"><b class="sblink-hexq sblink-hexq-in">?</b><span>${esc(t('skill_hidden_locked'))}</span></div>`;
    }
    body += sec(t('skill_record'));
    body += `<div class="sblink-recgrid"><div class="sblink-rec"><span>${esc(t('skill_got'))}</span><b>${esc(t('day_n', { n: k.day || 1 }))}</b></div>
        <div class="sblink-rec"><span>${esc(t('skill_used'))}</span><b>${esc(k.type === 'active' ? t('times_n', { n: k.uses || 0 }) : '—')}</b></div></div>`;
    body += `<div class="sblink-hint">${esc(k.type === 'active' ? t('skill_use_hint') : t('skill_passive_hint'))}</div>`;
    const foot = k.type === 'active'
        ? `<button type="button" class="sblink-btn sblink-btn-main sblink-btn-wide" data-act="skillUse"><span class="sblink-ell">${esc(t('use'))}</span></button>`
        : `<button type="button" class="sblink-btn sblink-btn-wide" disabled><span class="sblink-ell">${esc(t('skill_always'))}</span></button>`;
    return { body, foot };
}

function askUseSkill(id) {
    const k = skillsOf().find(x => x.id === id);
    if (!k || k.type !== 'active') return;
    ui.modal = {
        title: t('skill_use_q', { name: k.name }), body: t('skill_use_hint'), yes: t('use'), code: 'SYS.CONFIRM // SKILL',
        run: async () => {
            const u = useSkill(k.id);
            if (!u) return;
            popup({ variant: 'skill', tag: 'SKILL', code: 'SYS.LOG // SKILL', title: t('pop_skill_used'), lines: [`${gradeBadge(k.grade)}<span class="sblink-ell">[${esc(k.name)}]</span>`], body: esc(k.effect) });
            render();
        },
    };
    render();
}

async function runGacha(bagId) {
    if (isDrawing()) return;
    const show = gachaShow({
        skill: (id) => openWindow('status', { skill: id }),
        bag: () => openWindow('bag'),
    });
    let res = null;
    try { res = await openGacha(bagId); } catch (e) { console.error('[System Blink] gacha', e); }
    if (!room()?.bag.some(x => x.id === bagId)) ui.selBag = null;
    refreshWin();
    show.reveal(res);
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
    const pricey = debuffsNow(r).some(d => d.kind === 'pricey');
    const selPrice = sel ? priceOf(sel, r) : 0;
    const cells = items.map(x => cellHtml(x.kind === 'skillbook' ? { ...x, cellName: x.skill?.name || x.name } : x, {
        on: x.id === ui.selShop, data: `data-shop="${esc(x.id)}"`,
        label: x.kind === 'skillbook' ? t('skillbook_short', { g: x.grade }) : t(`rarity_${RC[x.rarity] ? x.rarity : 'common'}`),
        bar: `${priceOf(x, r)}P${pricey ? '▴' : ''}`, barCls: pricey ? ' sblink-neg' : '',
        extra: x.limited ? `<span class="sblink-limited">${esc(t('limited'))}</span>` : '',
    })).join('');
    const tone = toneOf(r);
    const head = `<div class="sblink-shophead"><span class="sblink-code">${{ game: 'SYS.SHOP', star: 'SYS.STAR', threat: 'SYS.ALERT' }[tone]} // ${side === 'daily' ? ({ game: 'DAILY', star: 'BUNDLE', threat: 'MARKET' }[tone]) : 'STANDING'}</span>
        <span class="sblink-shopname sblink-ell">${esc(t(`shop_title_${tone}`))}</span><i class="sblink-shopline"></i></div>`;
    const top = head + `<div class="sblink-shoptop">
        <div class="sblink-seg">
          <button type="button" class="sblink-chip${side === 'daily' ? ' sblink-chip-on' : ''}" data-side="daily"><span class="sblink-ell">${esc(t('shop_daily'))}</span></button>
          <button type="button" class="sblink-chip${side === 'standing' ? ' sblink-chip-on' : ''}" data-side="standing"><span class="sblink-ell">${esc(t('shop_standing'))}</span></button>
        </div>
        <b class="sblink-ptsmall">${pts}P</b>
      </div>
      <div class="sblink-hint sblink-ell">${esc(side === 'daily' ? t('shop_next') : t('shop_standing_hint', { n: RESTOCK_COST }))}</div>
      ${pricey ? `<div class="sblink-debuff"><span class="sblink-debuffchip">${esc(t('debuff_pricey'))}</span><span class="sblink-code sblink-neg">${esc(t('until_next_day'))}</span></div>` : ''}`;
    let detail = '';
    if (sel) {
        const after = pts - selPrice;
        detail = `<div class="sblink-detail">
          <div class="sblink-detailhead">${icon(sel.icon, 'sblink-bigico')}<div><div class="sblink-detailname">${esc(sel.name)}</div>${rarityTag(sel.rarity)}</div></div>
          ${sel.kind === 'skillbook' ? `<div class="sblink-stags">${tag(`SKILL ${sel.grade}`, 'sblink-stag-g ' + gradeClass(sel.grade))}${tag(t(`skill_${sel.skill?.type || 'passive'}`), 'sblink-stag-acc')}</div>` : ''}
          <div class="sblink-detaildesc">${esc(sel.desc || '')}</div>
          ${sel.kind === 'skillbook' ? `<div class="sblink-hint">${esc(t('book_hint'))}</div>` : ''}
          ${sel.sold ? `<div class="sblink-hint">${esc(t('sold_out'))}</div>` : after < 0 ? `<div class="sblink-afterpts"><b class="sblink-neg">${esc(t('pts_short', { n: -after }))}</b></div>` : `<div class="sblink-afterpts">${pts}P → <b>${after}P</b></div>`}
        </div>`;
    } else if (items.length) detail = `<div class="sblink-hint sblink-center">${esc(t('pick_item'))}</div>`;
    const grid = items.length ? `<div class="sblink-grid sblink-grid3">${cells}</div>` : status || `<div class="sblink-hint sblink-center">${esc(t('shop_empty'))}</div>`;
    const can = sel && !sel.sold && pts >= selPrice;
    let foot = '';
    if (side === 'standing') foot += `<button type="button" class="sblink-btn" data-act="restock"${ui.restocking || pts < RESTOCK_COST ? ' disabled' : ''}><span class="sblink-ell">${esc(ui.restocking ? t('stocking') : `${t('restock')} ${RESTOCK_COST}P`)}</span></button>`;
    foot += `<button type="button" class="sblink-btn sblink-btn-main" data-act="buy"${can ? '' : ' disabled'}><span class="sblink-ell">${esc(!sel ? t('buy') : sel.sold ? t('sold_out') : pts < selPrice ? t('not_enough') : `${t('buy')} ${selPrice}P`)}</span></button>`;
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
    const cells = bag.map(b => cellHtml(b, { on: b.id === ui.selBag, data: `data-bag="${esc(b.id)}"`, label: t(`rarity_${RC[b.rarity] ? b.rarity : 'common'}`), bar: `×${b.count}` })).join('');
    const fill = Math.max(0, Math.ceil(Math.max(8, bag.length) / 4) * 4 - bag.length);
    const blanks = '<div class="sblink-cell sblink-cell-blank"></div>'.repeat(fill);
    let body = sec(t('tab_bag'), `<span class="sblink-code">${bag.reduce((a, b) => a + b.count, 0)}</span>`) + `<div class="sblink-grid sblink-grid4">${cells}${blanks}</div>`;
    if (!bag.length) body += `<div class="sblink-hint sblink-center">${esc(t('bag_empty'))}</div>`;
    if (sel) {
        body += `<div class="sblink-detail">
          <div class="sblink-detailhead">${icon(sel.icon, 'sblink-bigico')}<div><div class="sblink-detailname">${esc(sel.name)} <span class="sblink-times">×${sel.count}</span></div>${rarityTag(sel.rarity)}</div></div>
          <div class="sblink-detaildesc">${esc(sel.desc || '')}</div>
          <div class="sblink-hint">${esc(sel.kind === 'gacha' ? t('gacha_hint') : sel.kind === 'reroll' ? t('reroll_hint') : sel.kind === 'eraser' ? t('eraser_hint') : t('use_hint'))}</div>
        </div>`;
    } else if (bag.length) body += `<div class="sblink-hint sblink-center">${esc(t('pick_item'))}</div>`;
    const gacha = sel?.kind === 'gacha';
    const foot = `<button type="button" class="sblink-btn sblink-btn-main sblink-btn-wide" data-act="use"${sel && !(gacha && isDrawing()) ? '' : ' disabled'}><span class="sblink-ell">${esc(gacha ? t('gacha_open') : t('use'))}</span></button>`;
    return { body, foot };
}

// ----- quests -----
const KIND_CLASS = { daily: '', sudden: ' sblink-k-sudden', hidden: ' sblink-k-hidden', goal: ' sblink-k-goal', penalty: ' sblink-k-penalty' };

function questRow(r, q, view) {
    const st = questState(r, q, view);
    const isOpenRow = ui.openQuest === q.id;
    const conds = condsOf(q);
    const cls = { done: 'sblink-q-done', failed: 'sblink-q-failed', declined: 'sblink-q-failed' }[st.status] || 'sblink-q-active';
    const pen = penaltyFor(q);
    const warn = warnFor(q);
    const penBit = (on) => (on && pen ? ` · <b class="sblink-neg">−${pen}P</b>` : on && warn ? ` · <b class="sblink-neg">${esc(t('warn_plus'))}</b>` : '');
    let extra = '';
    if (st.status === 'done') {
        extra += `<div class="sblink-qmeta"><span class="sblink-code sblink-clear">CLEAR</span> · ${esc(st.entry?.byHand || !st.entry?.key ? t('by_hand') : t('by_ai'))}</div>`;
        if (!conds && st.entry?.reason) extra += `<div class="sblink-qwhy"><span class="sblink-code">${esc(t('evidence'))}</span> “${esc(st.entry.reason)}”</div>`;
    } else if (st.status === 'offered') {
        extra += `<div class="sblink-qmeta"><span class="sblink-code sblink-orange">${esc(t('limit_replies', { n: q.limit }))}</span>${pen ? ` · <span class="sblink-neg">${esc(t('penalty_short', { pts: pen }))}</span>` : warn ? ` · <span class="sblink-neg">${esc(t('warn_short'))}</span>` : ''}</div>
          <div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm" data-sudden="no" data-id="${esc(q.id)}"><span class="sblink-ell">${esc(t('decline'))}</span></button>
          <button type="button" class="sblink-btn sblink-btn-sm sblink-btn-main" data-sudden="yes" data-id="${esc(q.id)}"><span class="sblink-ell">${esc(t('accept'))}</span></button></div>`;
    } else if (st.status === 'declined') extra += `<div class="sblink-qmeta">${esc(t('declined'))}${penBit(true)}</div>`;
    else if (st.rerolled && !conds) {
        extra += `<div class="sblink-qwhy sblink-rerolled">${icon('undo')}<span>${esc(t('rerolled', { pts: rate(q.reward) }))}</span></div>`;
    } else if (st.status === 'failed') extra += `<div class="sblink-qmeta">${esc(q.kind === 'sudden' ? t('sudden_failed') : q.kind === 'penalty' ? t('penalty_expired') : q.givenUp ? t('hidden_given_up') : t('failed'))}${penBit(q.kind === 'sudden' || !!q.failedAt)}</div>`;
    else {
        const bits = ['<span class="sblink-code">IN PROGRESS</span>'];
        if (conds) bits.push(esc(t('cond_n', { n: st.condDone.filter(Boolean).length, all: conds.length })));
        if (q.kind === 'sudden') bits.push(`<span class="sblink-orange">${esc(t('replies_left', { n: suddenLeft(q, view) }))}</span>${diamonds(suddenLeft(q, view), q.limit)}`);
        if (q.kind === 'hidden') bits.push(esc(t('hidden_meta')));
        if (q.kind === 'penalty') bits.push(esc(t('penalty_meta')));
        if (q.kind === 'daily' && pen) bits.push(`<span class="sblink-neg">${esc(t('fail_cost', { pts: pen }))}</span>`);
        if (q.kind === 'daily' && warn) bits.push(`<span class="sblink-neg">${esc(t('fail_warn'))}</span>`);
        extra += `<div class="sblink-qmeta">${bits.join(' · ')}</div>`;
    }
    if (conds && st.status !== 'offered') {
        const live = r.ledger.filter(e => e.questId === q.id && !e.undone && view.index.has(e.key));
        extra += `<div class="sblink-conds">${conds.map((c, i) => {
            const e = live.find(x => x.cond === i);
            return `<div class="sblink-cond${st.condDone[i] ? ' sblink-cond-on' : ''}"><i class="sblink-condbox"></i><span class="sblink-condtext">${esc(c)}</span></div>
              ${e?.reason ? `<div class="sblink-qwhy sblink-condwhy"><span class="sblink-code">${esc(t('evidence'))}</span> 「${esc(e.reason)}」</div>` : ''}`;
        }).join('')}</div>`;
        if (st.rerolled && st.status !== 'done') extra += `<div class="sblink-qwhy sblink-rerolled">${icon('undo')}<span>${esc(t('rerolled_cond'))}</span></div>`;
    }
    let actions = '';
    if (isOpenRow && st.status === 'done') actions = `<div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm sblink-btn-danger" data-undo="${esc(q.id)}"><span class="sblink-ell">${esc(t('undo_clear'))}</span></button></div>`;
    if (isOpenRow && st.status === 'active') actions = `<div class="sblink-qacts">${q.kind === 'hidden' ? `<button type="button" class="sblink-btn sblink-btn-sm" data-giveup="${esc(q.id)}"><span class="sblink-ell">${esc(t('hidden_give_up'))}</span></button>` : ''}<button type="button" class="sblink-btn sblink-btn-sm" data-clear="${esc(q.id)}"><span class="sblink-ell">${esc(t('clear_hand'))}</span></button></div>`;
    return `<div class="sblink-quest ${cls}${KIND_CLASS[q.kind] || ''}${isOpenRow ? ' sblink-quest-open' : ''}" data-quest="${esc(q.id)}" role="button" tabindex="0">
      <div class="sblink-qmain"><i class="sblink-qdia"></i><span class="sblink-qname">${esc(q.name)}</span>${q.kind === 'penalty' ? `<b class="sblink-pts sblink-dimpts">${esc(t('no_reward'))}</b>` : `<b class="sblink-pts">+${rate(q.reward)}P</b>`}</div>
      ${extra}${actions}</div>`;
}

const stageBar = (done, total, now) => `<div class="sblink-stagebar">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'sblink-on' : i === now ? 'sblink-now' : ''}"></i>`).join('')}</div>`;

function goalBlock(r, view) {
    if (!r.goal) {
        const head = sec(t('main_goal'), '', 'sblink-goalhead');
        // 0.6.2: locked while the tutorial runs; the System sets it by itself afterwards
        if (goalLocked(r)) return head + `<div class="sblink-goalnone sblink-goallock"><span class="sblink-lockmark">🔒</span><span class="sblink-ell">${esc(t('goal_locked'))}</span></div>`;
        if (isGivingGoal()) return head + `<div class="sblink-goalnone">${hexMark('sblink-spin')}<span class="sblink-ell">${esc(t('goal_giving'))}</span></div>`;
        const retry = goalGiveFailed() ? `<button type="button" class="sblink-btn sblink-btn-sm" data-act="goalRetry"><span class="sblink-ell">${esc(t('goal_retry'))}</span></button>` : '';
        return head + `<div class="sblink-goalnone"><span class="sblink-ell">${esc(t('no_goal'))}</span>${retry}
          <button type="button" class="sblink-btn sblink-btn-sm" data-act="goalNew"><span class="sblink-ell">${esc(t('goal_set'))}</span></button></div>`;
    }
    const g = goalNow(r, view);
    // 0.7.0 genre mode: a goal (or stage) the story has not brought in yet
    if (g.current && veiled(r, g.current, view)) {
        return sec(t('main_goal'), '', 'sblink-goalhead') + incomingBox();
    }
    let now = '';
    if (g.complete) now = `<span class="sblink-code sblink-clear">CLEAR</span> <span class="sblink-ell">${esc(t('goal_complete'))}</span>`;
    else if (g.current) now = `<span class="sblink-code">${esc(t('stage_now'))} ▸</span> <span class="sblink-ell">${esc(g.current.name)}</span><b class="sblink-pts">+${rate(g.current.reward)}P</b>`;
    else now = `<span class="sblink-ell">${esc((ui.makingStage || isMakingStage()) ? t('stage_making') : t('stage_failed'))}</span>`;
    return sec(t('main_goal'), `<span class="sblink-code">${esc(t('stage_of', { n: Math.min(g.done + (g.complete ? 0 : 1), g.total), all: g.total }))}</span>`, 'sblink-goalhead')
        + `<button type="button" class="sblink-goalcard" data-act="goalOpen">
            ${stageBar(g.done, g.total, g.complete ? -1 : g.done)}
            <div class="sblink-goaltitle">${esc(r.goal.title)}</div>
            <div class="sblink-goalnow">${now}<span>▸</span></div>
          </button>`;
}

/** 0.7.0: something is on its way (genre mode: shown once the story brings it in). */
const incomingBox = () => `<div class="sblink-incoming"><span class="sblink-incdots"><i></i><i></i><i></i></span><span class="sblink-ell">${esc(t('incoming'))}</span></div>`;

function questsTab(r) {
    const view = chatView();
    const pinned = !!settings().questPanel;
    // 0.7.2: the quest HUD — a drawn corner-bracket mark (no 📌) and its state as a System code
    let body = `<div class="sblink-pinrow"><span class="sblink-code${pinned ? '' : ' sblink-dimcode'}">SYS.HUD // ${pinned ? 'ON' : 'OFF'}</span><button type="button" class="sblink-btn sblink-btn-sm sblink-hudbtn${pinned ? ' sblink-btn-main' : ''}" data-act="pinPanel" aria-pressed="${pinned}">${HUD_ICON}<span class="sblink-ell">${esc(t(pinned ? 'panel_pinned' : 'panel_pin'))}</span></button></div>`;
    const tut = r.tutorial;
    if (tut.state === 'active') {
        const next = tut.done.findIndex(x => !x);
        body += sec(t('tutorial'), `<span class="sblink-code">${tut.done.filter(Boolean).length} / 4</span>`)
            + `<div class="sblink-tutbar">${tut.done.map((d, i) => `<i class="${d ? 'sblink-on' : i === next ? 'sblink-now' : ''}"></i>`).join('')}</div>
               <div class="sblink-tutnext"><span class="sblink-code">${next >= 0 ? 'NEXT' : 'CLEAR'}</span> ▸ <span class="sblink-ell">${esc(next >= 0 ? t(`tut_${next}`) : '')}</span>
                 <button type="button" class="sblink-link sblink-tutskip" data-act="tutSkip">${esc(t('tut_skip'))}</button></div>`;
    }
    body += goalBlock(r, view);
    const seen = (q) => !veiled(r, q, view);
    const shown = (q) => seen(q) && (q.day === r.day || ['active', 'offered'].includes(questState(r, q, view).status));
    // a hidden / penalty quest on its way: only "something is coming" (not what kind)
    if (r.quests.some(q => (q.kind === 'hidden' || q.kind === 'penalty') && !seen(q) && questState(r, q, view).status === 'active')) body += incomingBox();
    const sudden = r.quests.filter(q => q.kind === 'sudden' && shown(q));
    if (sudden.length) body += sec(t('sudden_quests')) + sudden.map(q => questRow(r, q, view)).join('');
    const pq = penaltyQuests(r).filter(seen);
    if (pq.length) body += sec(t('penalty_quests'), '', 'sblink-penhead') + pq.map(q => questRow(r, q, view)).join('');
    const all = todays(r);
    const list = all.filter(seen);
    const done = list.filter(q => questState(r, q, view).status === 'done').length;
    body += sec(t(toneOf(r) === 'threat' ? 'daily_quests_threat' : 'daily_quests'), `<span class="sblink-code">${esc(t('day_n', { n: r.day }))} · ${done} / ${list.length}</span>`);
    if (list.length < all.length) body += incomingBox();
    else if (!list.length) body += `<div class="sblink-hint sblink-center">${esc(t('no_quests'))}</div>`;
    body += list.map(q => questRow(r, q, view)).join('');
    const hidden = r.quests.filter(q => q.kind === 'hidden' && shown(q));
    if (hidden.length) body += sec(t('hidden_quests')) + hidden.map(q => questRow(r, q, view)).join('');
    body += `<div class="sblink-hint sblink-center">${esc(t('settle_note'))}</div>`;
    const checking = isChecking();
    const foot = checking
        ? `<button type="button" class="sblink-btn sblink-btn-wide" data-act="cancelCheck">${hexMark('sblink-spin')}<span class="sblink-ell">${esc(t('checking'))} · ${esc(t('cancel'))}</span></button>`
        : `<button type="button" class="sblink-btn sblink-btn-wide" data-act="checkNow"><span class="sblink-ell">${esc(t('check_now'))}</span></button>`;
    return { body, foot };
}

// ----- the main goal (⑳) -----
function goalPage() {
    const r = room();
    if (!r?.goal) return { body: '', foot: '' };
    const view = chatView();
    const g = goalNow(r, view);
    let rows = '';
    for (let i = 0; i < g.total; i++) {
        const q = g.list[i];
        const st = q ? questState(r, q, view) : null;
        // 0.7.0 genre mode: a stage still waiting for its scene shows only "something is arriving"
        const coming = !!(q && st.status !== 'done' && veiled(r, q, view));
        const locked = !q || (i > g.done) || coming;
        const isNow = q && q === g.current && !coming;
        let inner;
        if (coming) {
            inner = `<div class="sblink-stagename">???</div><div class="sblink-qmeta">${esc(t('panel_incoming'))}</div>`;
        } else if (locked && !isNow) {
            inner = `<div class="sblink-stagename">${esc(i === g.total - 1 ? t('stage_last_locked') : '???')}</div><div class="sblink-qmeta">${esc(!q && i === g.list.length && g.pending ? ((ui.makingStage || isMakingStage()) ? t('stage_making') : t('stage_failed')) : t('stage_locked'))}</div>`;
        } else {
            inner = `<div class="sblink-stagename">${esc(q.name)}</div>`;
            const conds = condsOf(q);
            if (st.status === 'done') inner += `<div class="sblink-qmeta"><span class="sblink-code sblink-clear">CLEAR</span></div>`;
            else inner += `<div class="sblink-qmeta"><span class="sblink-code">IN PROGRESS</span>${conds ? ` · ${esc(t('cond_n', { n: st.condDone.filter(Boolean).length, all: conds.length }))}` : ''}</div>`;
            if (conds) inner += `<div class="sblink-conds">${conds.map((c, k) => `<div class="sblink-cond${st.condDone[k] ? ' sblink-cond-on' : ''}"><i class="sblink-condbox"></i><span class="sblink-condtext">${esc(c)}</span></div>`).join('')}</div>`;
            if (isNow && ui.openQuest === q.id) inner += `<div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm" data-clear="${esc(q.id)}"><span class="sblink-ell">${esc(t('clear_hand'))}</span></button></div>`;
            if (st.status === 'done' && ui.openQuest === q.id && i === g.done - 1) inner += `<div class="sblink-qacts"><button type="button" class="sblink-btn sblink-btn-sm sblink-btn-danger" data-undo="${esc(q.id)}"><span class="sblink-ell">${esc(t('undo_clear'))}</span></button></div>`;
        }
        const cls = st?.status === 'done' ? ' sblink-stage-done' : isNow ? ' sblink-stage-now' : ' sblink-stage-locked';
        rows += `<div class="sblink-stage${cls}"${q && !locked ? ` data-quest="${esc(q.id)}" role="button" tabindex="0"` : ''}>
          <span class="sblink-stagenum">${i + 1}</span><div class="sblink-stagebody">${inner}</div><b class="sblink-pts">${q && !coming ? `+${rate(q.reward)}P` : '+?P'}</b></div>`;
    }
    const retry = g.pending && !ui.makingStage && !isMakingStage() ? `<button type="button" class="sblink-btn sblink-btn-sm" data-act="stageRetry"><span class="sblink-ell">${esc(t('stage_retry'))}</span></button>` : '';
    const body = `<div class="sblink-code">SYS.GOAL // MAIN</div>
      <div class="sblink-goalbig">${esc(r.goal.title)}</div>
      <div class="sblink-hint">${esc(t('goal_hint'))}</div>
      ${sec(t('stages'), `<span class="sblink-code">${g.done} / ${g.total}</span>`)}${stageBar(g.done, g.total, g.complete ? -1 : g.done)}
      <div class="sblink-stages">${rows}</div>${retry}
      <div class="sblink-hint">${esc(t('goal_note'))}</div>`;
    const foot = `<button type="button" class="sblink-btn" data-act="goalEdit"><span class="sblink-ell">${esc(t('goal_edit'))}</span></button>
      <button type="button" class="sblink-btn sblink-btn-main" data-act="goalNew"><span class="sblink-ell">${esc(t('goal_new'))}</span></button>`;
    return { body, foot };
}

function blankDraft() { return { title: '', total: 4, stage: { name: '', conds: ['', ''] } }; }
const isBlank = (d) => !d || (!d.title.trim() && !d.stage.name.trim() && !d.stage.conds.some(c => c.trim()));

/** ‹ Back (or closing the window) keeps an unsaved new goal for this chat; Cancel and Save drop it. */
function stashDraft() {
    if (ui.goalMode !== 'new' || !ui.goalDraft) return;
    readDraft();
    const id = currentChatId();
    if (!id) return;
    if (isBlank(ui.goalDraft)) delete ui.drafts[id];
    else ui.drafts[id] = structuredClone(ui.goalDraft);
}
const dropDraft = () => { delete ui.drafts[currentChatId()]; };

function draftFromGoal(r) {
    const g = goalNow(r);
    const cur = g.current;
    const conds = condsOf(cur) || [];
    return { title: r.goal.title, total: r.goal.total, stage: { name: cur?.name || '', conds: [conds[0] || '', conds[1] || ''] }, minTotal: g.done + 1, hasStage: !!cur };
}

/** Keep what was typed when the window is drawn again. */
function readDraft() {
    const win = $id('sblink-win');
    const d = ui.goalDraft;
    if (!win || !d) return;
    const v = (k) => win.querySelector(`[data-goal="${k}"]`);
    if (v('title')) d.title = v('title').value;
    if (v('name')) d.stage.name = v('name').value;
    if (v('c0')) d.stage.conds[0] = v('c0').value;
    if (v('c1')) d.stage.conds[1] = v('c1').value;
}

function goalEditPage() {
    const d = ui.goalDraft || (ui.goalDraft = blankDraft());
    const f = (k, label, val, ph) => `<label class="sblink-field"><span class="sblink-code">${esc(label)}</span><input class="sblink-input" data-goal="${k}" maxlength="80" value="${esc(val)}" placeholder="${esc(ph)}"></label>`;
    const totals = [3, 4, 5].filter(n => n >= (d.minTotal || 2));
    let body = '';
    if (ui.goalMode === 'new') {
        body += `<button type="button" class="sblink-btn sblink-btn-wide sblink-suggest" data-act="goalSuggest"${ui.suggesting ? ' disabled' : ''}>${ui.suggesting ? hexMark('sblink-spin') : ''}<span class="sblink-ell">${esc(ui.suggesting ? t('goal_suggesting') : t('goal_suggest'))}</span></button>
          <div class="sblink-hint">${esc(t('goal_suggest_hint'))}</div>`;
    }
    body += f('title', t('goal_title'), d.title, t('goal_title_ph'));
    body += `<div class="sblink-row"><div class="sblink-rowlabel">${esc(t('goal_total'))}</div><div class="sblink-chips">${totals.map(n => `<button type="button" class="sblink-chip${n === d.total ? ' sblink-chip-on' : ''}" data-gtotal="${n}"><span class="sblink-ell">${esc(t('stage_count', { n }))}</span></button>`).join('')}</div></div>`;
    if (ui.goalMode === 'new' || d.hasStage) {
        body += sec(t('stage_now'));
        body += f('name', t('stage_name'), d.stage.name, t('stage_name_ph'));
        body += f('c0', t('cond_label', { n: 1 }), d.stage.conds[0] || '', t('cond_ph'));
        body += f('c1', t('cond_label', { n: 2 }), d.stage.conds[1] || '', t('cond_ph2'));
        body += `<div class="sblink-hint">${esc(t('cond_hint'))}</div>`;
    }
    const foot = `<button type="button" class="sblink-btn" data-act="goalCancel"><span class="sblink-ell">${esc(t('cancel'))}</span></button>
      <button type="button" class="sblink-btn sblink-btn-main" data-act="goalSave"><span class="sblink-ell">${esc(t('save'))}</span></button>`;
    return { body, foot };
}

/** The [Ask the AI] button: if something is already written, ask before it is replaced. */
function askSuggest() {
    readDraft();
    if (isBlank(ui.goalDraft)) return suggestGoal();
    ui.modal = { title: t('goal_replace_q'), body: t('goal_replace_body'), yes: t('goal_suggest'), code: 'SYS.CONFIRM // GOAL', run: suggestGoal };
    return render();
}

async function suggestGoal() {
    if (ui.suggesting) return;
    ui.suggesting = true; render();
    const chatId = currentChatId();
    let made = null;
    try { made = await bus.ask('goal', {}); } catch (e) { console.warn('[System Blink] goal', e); }
    ui.suggesting = false;
    if (currentChatId() !== chatId) return render();
    if (!made) { notice(t('make_failed'), 'warn'); return render(); }
    const c = made.stage?.conds || [];
    const draft = { title: made.title, total: [3, 4, 5].includes(Math.round(made.total)) ? Math.round(made.total) : 4, stage: { name: made.stage?.name || '', conds: [c[0] || '', c[1] || ''], reward: made.stage?.reward } };
    // left the page while waiting: the suggestion waits in the draft instead of being thrown away
    if (ui.view !== 'goalEdit' || ui.goalMode !== 'new') { ui.drafts[chatId] = draft; notice(t('goal_suggest_kept')); return render(); }
    ui.freshDraft = true;
    ui.goalDraft = draft;
    render();
}

async function retryStage() {
    ui.makingStage = true; render();
    try { const q = await nextStage(); if (!q) notice(t('make_failed'), 'warn'); } finally { ui.makingStage = false; render(); }
}

// ----- sub pages -----
function subBody() {
    if (ui.view === 'gear') return { body: gearHtml(), foot: '' };
    if (ui.view === 'goal') return goalPage();
    if (ui.view === 'goalEdit') return goalEditPage();
    if (ui.view === 'skill') return skillPage();
    if (ui.view === 'cycle') return cyclePage();
    if (ui.view === 'cycleGo') return goPage();
    if (ui.view === 'cycleSetup') return setupPage();
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
    if (d.skill) {
        ui.selSkill = ui.selSkill === d.skill ? null : d.skill;
        if (ui.selSkill) seeSkill(d.skill);
        render();
        // the card opens under the grid: bring it into sight
        $id('sblink-win')?.querySelector('.sblink-skillcard')?.scrollIntoView?.({ block: 'nearest' });
        return;
    }
    if (d.sfilter) { ui.skillFilter = d.sfilter; ui.selSkill = null; return render(); }
    // 0.8.0 regression
    if (d.ev) { ui.selEvent = ui.selEvent === d.ev ? null : d.ev; return render(); }
    if (d.evset !== undefined) { setEvent(ui.selEvent, d.evset || null); return render(); }
    if (d.jdrop) { dropLine(d.jdrop); return render(); }
    if (d.gomode) { ui.cycleDraft.mode = d.gomode; return render(); }
    if (d.gotake) { ui.cycleDraft.keepItem = ui.cycleDraft.keepItem === d.gotake ? '' : d.gotake; return render(); }
    if (d.gopick) { ui.cycleDraft.off[d.gopick] = !ui.cycleDraft.off[d.gopick]; return render(); }
    if (d.goback) { ui.cycleDraft.back = d.goback; return render(); }
    if (d.setup) { readSetup(); ui.setupDraft.again = d.setup === 'again'; return render(); }
    if (d.title !== undefined) { const r = room(); if (r) { r.title = d.title; save(); } ui.titlePick = false; bus.emit('change'); return render(); }
    if (d.sudden) { bus.emit('sudden', { id: d.id, yes: d.sudden === 'yes' }); return render(); }
    if (d.gtotal) { readDraft(); ui.goalDraft.total = Number(d.gtotal); return render(); }
    if (d.clear) { clearByHand(d.clear); ui.openQuest = null; return render(); }
    if (d.giveup) { const id = d.giveup; ui.modal = { title: t('hidden_give_up_q'), body: t('hidden_give_up_body'), yes: t('hidden_give_up'), code: 'SYS.CONFIRM // HIDDEN', run: () => { giveUpHidden(id); ui.openQuest = null; } }; return render(); }
    if (d.undo) { undoClear(d.undo); ui.openQuest = null; return render(); }
    if (d.quest && !e.target.closest('button')) { ui.openQuest = ui.openQuest === d.quest ? null : d.quest; return render(); }
    if (d.fold) { toggleGroup(d.fold); return render(); }
    if (d.scope) { setScope('gear', d.scope); render(); const b = $id('sblink-win')?.querySelector('.sblink-body'); if (b) b.scrollTop = 0; return; }
    if (d.set) {
        const row = ROWS[d.set];
        let v = d.val;
        if (row.kind === 'toggle') v = d.val === '1';
        else if (row.k === 'pointRate' || row.k === 'suddenRest') v = Number(v);
        await setValue(d.set, v);
        return;
    }
    if (d.run) return runButton(d.run);
    if (d.text) { ui.textKey = d.text; ui.view = 'text'; return render(); }
    switch (d.act) {
        case 'close': return closeWindow();
        case 'gear': ui.back = TABS.includes(ui.view) ? ui.view : 'status'; ui.view = 'gear'; return render();
        case 'back':
            if (ui.view === 'goalEdit') stashDraft();
            if (ui.view === 'cycleGo') { stopTemp(); ui.cycleDraft = null; }
            ui.view = ui.view === 'text' ? 'gear' : ui.view === 'goalEdit' && room()?.goal ? 'goal' : (ui.back || 'status'); ui.goalDraft = null; return render();
        case 'goalCancel':
            if (ui.goalMode === 'new') dropDraft();
            ui.view = room()?.goal ? 'goal' : (ui.back || 'quests'); ui.goalDraft = null; return render();
        case 'skillMore': if (!ui.selSkill) return; ui.skillId = ui.selSkill; ui.back = 'status'; ui.view = 'skill'; return render();
        case 'skillUse': return askUseSkill(ui.view === 'skill' ? ui.skillId : ui.selSkill);
        case 'skillBlank': return notice(t('skill_none'));
        case 'goalOpen': ui.back = 'quests'; ui.view = 'goal'; ui.openQuest = null; return render();
        case 'goalEdit': { const r = room(); if (!r?.goal) return; ui.goalMode = 'edit'; ui.goalDraft = draftFromGoal(r); ui.freshDraft = true; ui.view = 'goalEdit'; return render(); }
        case 'goalNew': {
            const go = () => {
                const kept = ui.drafts[currentChatId()];
                ui.back = 'quests'; ui.goalMode = 'new'; ui.goalDraft = kept ? structuredClone(kept) : blankDraft(); ui.freshDraft = true; ui.view = 'goalEdit'; render();
            };
            if (goalLocked()) return notice(t('goal_locked'));
            if (room()?.goal && !goalNow().complete) { ui.modal = { title: t('goal_new_q'), body: t('goal_new_body'), yes: t('goal_new'), code: 'SYS.CONFIRM // GOAL', run: go }; return render(); }
            return go();
        }
        case 'goalSuggest': return askSuggest();
        case 'pinPanel': return setValue('questPanel', !settings().questPanel);
        case 'tutSkip': ui.modal = { title: t('tut_skip_q'), body: t('tut_skip_body'), yes: t('tut_skip'), code: 'SYS.CONFIRM // TUTORIAL', run: () => skipTutorial() }; return render();
        case 'goalRetry': { const p = giveGoal(currentChatId(), true); render(); await p; return render(); }
        case 'stageRetry': return retryStage();
        case 'goalSave': {
            readDraft();
            const d = ui.goalDraft;
            const conds = d.stage.conds.map(x => x.trim()).filter(Boolean);
            if (!d.title.trim() || ((ui.goalMode === 'new' || d.hasStage) && !d.stage.name.trim())) { notice(t('goal_need'), 'warn'); return; }
            const stage = { name: d.stage.name.trim(), conds, reward: d.stage.reward };
            if (ui.goalMode === 'new') setGoal({ title: d.title.trim(), total: d.total, stage });
            else editGoal({ title: d.title.trim(), total: d.total, stage: d.hasStage ? stage : null });
            if (ui.goalMode === 'new') dropDraft();
            ui.goalDraft = null; ui.view = 'goal'; ui.back = 'quests';
            return render();
        }
        case 'roomOn': await switchOn(); return render();
        case 'cycleEdit': ui.back = 'status'; ui.setupDraft = null; ui.view = 'cycleSetup'; return render();
        case 'cycleLog': ui.back = 'status'; ui.view = 'cycle'; return render();
        case 'cycleGo': ui.back = 'status'; ui.cycleDraft = null; ui.view = 'cycleGo'; return render();
        case 'jAdd': { const inp = $id('sblink-win').querySelector('[data-jadd]'); if (inp?.value.trim()) addLine(inp.value); return render(); }
        case 'goSkills': ui.cycleDraft.keepSkills = !ui.cycleDraft.keepSkills; return render();
        case 'goSort': readGo(); return runSort();
        case 'goStop': stopTemp(); ui.cycleDraft = null; ui.view = 'status'; return render();
        case 'goGo': return doRegress();
        case 'setupFill': case 'setupRandom': {
            readSetup();
            const sd = ui.setupDraft; sd.filling = true; render();
            const got = await fillCycle(currentChatId(), d.act === 'setupRandom');
            sd.filling = false;
            if (got) ui.freshSetup = true;
            if (got) Object.assign(sd, { n: got.n, truth: got.truth, memo: got.memory, back: got.back, events: got.events.map(e => `${e.day || ''} | ${e.what}`).join('\n') });
            else notice(t('setup_fail'), 'warn');
            return render();
        }
        case 'setupSave': {
            readSetup();
            const sd = ui.setupDraft;
            const r = room();
            if (!r?.cycle || sd.again === null) return;
            const knowers = String(sd.knowers || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean).slice(0, 12);
            if (!r.cycle.set) setupCycle(currentChatId(), sd.again ? { again: true, n: sd.n, truth: sd.truth, memo: sd.memo, events: sd.events, back: sd.back } : {});
            else {
                const c = r.cycle;
                c.n = Math.max(1, Math.min(999, Math.round(Number(sd.n) || c.n)));
                c.truth = String(sd.truth || '').slice(0, 2000); c.memo = String(sd.memo || '').slice(0, 2000); c.back = String(sd.back || '').slice(0, 120);
                setEventsText(r, sd.events);
                save();
            }
            if (sd.again) { r.cycle.knowers = knowers; if (knowers.length && r.cycle.scope === 'me') r.cycle.scope = 'some'; save(); }
            ui.setupDraft = null; ui.view = 'status'; bus.emit('change');
            return render();
        }
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
                title: t('buy_q', { name: it.name }), body: `${points(r)}P → ${points(r) - priceOf(it, r)}P`, yes: `${t('buy')} ${priceOf(it, r)}P`, code: 'SYS.CONFIRM // SHOP',
                run: async () => { if (buy(it, ui.shopSide)) notice(t('bought', { name: it.name })); else notice(t('not_enough')); render(); },
            };
            return render();
        }
        case 'restock':
            ui.restocking = true; render();
            try {
                const ok = await restockStanding();
                if (ok === 'short') notice(t('not_enough'), 'warn');
                else if (!ok) notice(t('restock_failed'), 'warn');
            } finally { ui.restocking = false; render(); }
            return;
        case 'use': {
            const r = room();
            const b = r.bag.find(x => x.id === ui.selBag);
            if (!b) return;
            if (b.kind === 'gacha') {
                ui.modal = { title: t('gacha_q'), body: t('gacha_hint'), yes: t('gacha_open'), code: 'SYS.CONFIRM // GACHA', run: () => runGacha(b.id) };
                return render();
            }
            ui.modal = {
                title: t('use_q', { name: b.name }), body: b.kind === 'reroll' ? t('reroll_hint') : b.kind === 'eraser' ? t('eraser_hint') : t('use_hint'), yes: t('use'), code: 'SYS.CONFIRM // ITEM',
                run: async () => {
                    const u = await useItem(b.id);
                    if (!u) return;
                    if (u.blocked) { notice(t('erase_none'), 'warn'); return render(); }
                    if (u.kind === 'eraser') {
                        if (!room()?.bag.some(x => x.id === b.id)) ui.selBag = null;
                        const n = warnCount();
                        popup({ tag: 'ITEM', code: 'SYS.LOG // ERASE', title: t('pop_erased'), lines: [`${icon(u.icon)}<span class="sblink-ell">${esc(u.name)}</span>`], body: `<div class="sblink-warnmeter">${warnDias(n)}<span>${esc(t('erased_left', { n }))}</span></div>` });
                        return render();
                    }
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
    const jl = e.target.closest('[data-jl]');
    if (jl) { editLine(jl.dataset.jl, jl.value); return; }
    const sel = e.target.closest('[data-sel]');
    if (sel) setValue(sel.dataset.sel, sel.value);
}

export function windowView() { return ui.view; }
export { runCheck };
