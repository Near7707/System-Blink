// The floating hexagon button. Tap = open the System window; press and move a few px = drag.
// Its place, size and ring are kept per device. It stays out of the notch, the home bar and the input box.
// 0.5.5: let go against the side of the chat column and it tucks in as a bookmark tab (tap = open,
// drag it inward = the hexagon again). On a phone the chat column is the whole screen.

import { t } from '../i18n.js';
import { settings, device, saveDevice, currentChatId, room } from '../store.js';
import { hexMark } from '../icons.js';
import { $id, esc, viewport, safeInsets, inputTop, isPhone } from './util.js';

let hooks = { open: () => {} };
export function setFabHooks(h) { hooks = { ...hooks, ...h }; }

const DRAG_START = 6;
let drag = null;     // { id, sx, sy, ox, oy, moved }
let hidden = false;  // the window is open
let noChat = false;  // no chat is open (start screen, character list)
let count = 0;
let idleTimer = 0;
let colWatch = null; // watches the chat column's width

const TAB_W = 24, TAB_H = 72, HIT = 36, TUCK_NEAR = 36;
/** The button's box for its shape and size: w wide, h tall in all, body = the part a finger aims at. */
function dims() {
    const d = device();
    const small = d.size === 'small';
    if (d.shape === 'tab') return small ? { w: 30, h: 68, body: 68 } : { w: 34, h: 76, body: 76 };
    const sz = d.shape === 'badge' ? (small ? 46 : 54) : (small ? 46 : 60);
    return { w: sz, h: sz + 18, body: sz }; // the SYS mark sits under it
}
const sizeOf = () => dims().w;
const devKey = () => (isPhone() ? 'phone' : 'pc');

export function mountFab() {
    const s = settings();
    let el = $id('sblink-fab');
    if (!s.enabled || !s.btnShow) { el?.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'sblink-fab';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        document.body.appendChild(el);
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hooks.open(); } });
    }
    const d = device();
    el.className = `sblink-fab sblink-fab-${d.size} sblink-ring-${d.ring} sblink-shape-${d.shape}${settings().motion ? ' sblink-moving' : ''}`;
    el.setAttribute('aria-label', t('ext_name'));
    el.innerHTML = `
      <svg class="sblink-fabring" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"/><polyline class="sblink-fabringlow" points="9,73.5 50,97 91,73.5"/><polyline class="sblink-fabringtick" points="9,38 9,26.5 19,20.8"/><polyline class="sblink-fabringtick" points="91,38 91,26.5 81,20.8"/><polyline class="sblink-fabringtick" points="43,7 50,3 57,7"/></svg>
      <div class="sblink-fabbody${d.shape === 'hexb' || d.shape === 'badge' ? ' sblink-glass' : ''}"><i class="sblink-fabscan"></i>${hexMark('sblink-fabmark')}</div>
      <div class="sblink-fabcode">SYS<span class="sblink-cursor">▌</span></div>
      <div class="sblink-fabtab sblink-glass">${hexMark('sblink-fabtabmark')}<span class="sblink-fabtabcode">SYS</span></div>
      <div class="sblink-fabchip"${count ? '' : ' hidden'}>${esc(count)}</div>`;
    noChat = gone();
    watchColumn();
    el.hidden = hidden || noChat;
    place();
    wakeUp();
}

export function unmountFab() { $id('sblink-fab')?.remove(); endDrag(); colWatch?.disconnect(); colWatch = null; }

/** No chat open, or (when the setting is on) this chat has not woken the System. */
function gone() {
    if (!currentChatId()) return true;
    return settings().btnOnlyOn !== false && !room()?.on;
}

/** Follow the chat column when its width changes (SillyTavern's chat width setting, side panels). */
function watchColumn() {
    if (colWatch || typeof ResizeObserver !== 'function') return;
    const col = $id('sheld');
    if (!col) return;
    colWatch = new ResizeObserver(() => { if (!drag) place(); });
    colWatch.observe(col);
}

export function setFabHidden(on) { hidden = !!on; const el = $id('sblink-fab'); if (el) el.hidden = hidden || noChat; }
/** Hide the button while no chat is open; show it again in a chat. */
export function syncFabChat() {
    noChat = gone();
    const el = $id('sblink-fab');
    if (el) { const was = el.hidden; el.hidden = hidden || noChat; if (was && !el.hidden) place(); }
}

export function setFabCount(n) {
    count = n;
    const chip = $id('sblink-fab')?.querySelector('.sblink-fabchip');
    if (chip) { chip.hidden = !n; chip.textContent = String(n); }
}

function bounds(h) {
    const vp = viewport();
    const ins = safeInsets();
    const sz = sizeOf();
    const tall = h || dims().h;
    const minX = vp.x + Math.max(4, ins.left + 4);
    const maxX = vp.x + vp.w - sz - Math.max(4, ins.right + 4);
    const minY = vp.y + Math.max(8, ins.top + 8) + 40; // under the top bar
    const bottomLimit = Math.min(vp.y + vp.h - Math.max(8, ins.bottom + 8), inputTop() - 8);
    const stripEl = $id('sblink-strip');
    const stripTop = stripEl && !stripEl.hidden ? stripEl.getBoundingClientRect().top - 8 : Infinity;
    const maxY = Math.min(bottomLimit, stripTop) - tall;
    return { minX, maxX, minY, maxY: Math.max(minY, maxY), sz, vp, ins };
}

function savedPos() {
    const p = device().pos[devKey()];
    return p && typeof p.fx === 'number' ? p : null;
}

/** Put the button where it was kept (as a share of the screen, so turning the phone keeps it inside). */
export function place() {
    const el = $id('sblink-fab');
    if (!el || drag) return;
    const p = savedPos();
    if (p?.tuck && settings().btnTuck !== false) return placeTab(el, p.tuck, p.fy);
    setTucked(el, null);
    const b = bounds();
    let x, y;
    if (p) {
        x = b.minX + p.fx * (b.maxX - b.minX);
        y = b.minY + p.fy * (b.maxY - b.minY);
    } else { x = b.maxX; y = b.minY + 0.55 * (b.maxY - b.minY); }
    x = Math.min(b.maxX, Math.max(b.minX, x));
    y = Math.min(b.maxY, Math.max(b.minY, y));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dataset.x = x; el.dataset.y = y;
}

/** The chat column's left and right edges on screen (the whole screen when there is no column). */
function column(b) {
    const left = b.vp.x + b.ins.left, right = b.vp.x + b.vp.w - b.ins.right;
    const r = ($id('sheld') || $id('chat'))?.getBoundingClientRect();
    if (!r || r.width < 160) return { l: left, r: right, left, right };
    return { l: Math.max(left, r.left), r: Math.min(right, r.right), left, right };
}

/** Where the bookmark sits: against the column's side, outside it when there is room (PC), else inside. */
function tabSpot(side, fy) {
    const b = bounds(TAB_H);
    const c = column(b);
    let x, flat; // flat = the tab's straight side, the one that touches the edge
    if (side === 'right') {
        const room = c.right - c.r;
        if (room >= TAB_W + 4) { x = c.r; flat = 'l'; }
        else { x = c.r - HIT; flat = 'r'; }
    } else {
        const room = c.l - c.left;
        if (room >= TAB_W + 4) { x = c.l - HIT; flat = 'r'; }
        else { x = c.l; flat = 'l'; }
    }
    const y = b.minY + Math.min(1, Math.max(0, Number(fy) || 0)) * (b.maxY - b.minY);
    return { x, y, flat, b };
}

function placeTab(el, side, fy) {
    const s = tabSpot(side, fy);
    setTucked(el, s.flat);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    el.dataset.x = s.x; el.dataset.y = s.y;
}

function setTucked(el, flat) {
    const dm = dims();
    el.style.width = `${flat ? HIT : dm.w}px`;
    el.style.height = `${flat ? TAB_H : dm.h}px`;
    el.classList.toggle('sblink-fab-tuck', !!flat);
    el.classList.toggle('sblink-tab-l', flat === 'l');
    el.classList.toggle('sblink-tab-r', flat === 'r');
    el.dataset.tuck = flat ? '1' : '';
}

/** Let go here → tuck into this side ('left' / 'right') or stay a hexagon (null). */
function tuckSide(x) {
    if (settings().btnTuck === false) return null;
    const b = bounds();
    const c = column(b);
    const cx = x + b.sz / 2;
    if (Math.abs(cx - c.r) < TUCK_NEAR || cx > b.maxX + b.sz / 2 - 2) return 'right';
    if (Math.abs(cx - c.l) < TUCK_NEAR || cx < b.minX + b.sz / 2 + 2) return 'left';
    return null;
}

export function resetPos() {
    const d = device();
    delete d.pos[devKey()];
    saveDevice(d);
    place();
}

function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.currentTarget;
    endDrag();
    let ox = Number(el.dataset.x) || 0, oy = Number(el.dataset.y) || 0;
    const fromTab = el.dataset.tuck === '1';
    if (fromTab) { // the hexagon that comes out sits where the tab was
        const b = bounds();
        ox = Math.min(b.maxX, Math.max(b.minX, ox + HIT / 2 - b.sz / 2));
        oy = Math.min(b.maxY, Math.max(b.minY, oy + TAB_H / 2 - dims().body / 2));
    }
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox, oy, moved: false, fromTab };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.add('sblink-pressed');
    wakeUp();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
}

function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const el = $id('sblink-fab');
    if (!el) return endDrag();
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
    e.preventDefault();
    if (!drag.moved) {
        drag.moved = true;
        setTucked(el, null);
        el.classList.add('sblink-dragging');
        const ghost = document.createElement('div');
        ghost.id = 'sblink-fabghost';
        const dm = dims();
        ghost.className = `sblink-fabghost sblink-shape-${device().shape}`;
        ghost.style.width = `${dm.w}px`; ghost.style.height = `${dm.body}px`;
        ghost.style.transform = `translate(${drag.ox}px, ${drag.oy}px)`;
        document.body.appendChild(ghost);
    }
    const b = bounds();
    const x = Math.min(b.maxX, Math.max(b.minX, drag.ox + dx));
    const y = Math.min(b.maxY, Math.max(b.minY, drag.oy + dy));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dataset.x = x; el.dataset.y = y;
}

function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    finishDrag(moved);
    if (!moved) hooks.open();
}
function onCancel(e) { if (drag && e.pointerId === drag.id) finishDrag(drag.moved); }

function finishDrag(moved) {
    const el = $id('sblink-fab');
    if (el && moved) {
        const b = bounds();
        let x = Number(el.dataset.x) || 0;
        const y = Number(el.dataset.y) || 0;
        const side = tuckSide(x);
        const d = device();
        if (side) {
            const tb = bounds(TAB_H);
            const ty = y + dims().body / 2 - TAB_H / 2;
            // fx is kept too, so turning bookmarks off leaves the hexagon on that side
            d.pos[devKey()] = { fx: side === 'right' ? 1 : 0, fy: tb.maxY > tb.minY ? Math.min(1, Math.max(0, (ty - tb.minY) / (tb.maxY - tb.minY))) : 0.5, tuck: side };
        } else {
            d.pos[devKey()] = { fx: b.maxX > b.minX ? (x - b.minX) / (b.maxX - b.minX) : 1, fy: b.maxY > b.minY ? (y - b.minY) / (b.maxY - b.minY) : 0.5 };
        }
        saveDevice(d);
    }
    endDrag();
    place();
}

/** Always let go: also when the finger lift is lost (page hidden, window blur). */
export function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    const el = $id('sblink-fab');
    el?.classList.remove('sblink-dragging', 'sblink-pressed');
    $id('sblink-fabghost')?.remove();
    drag = null;
    wakeUp();
}

function wakeUp() {
    const el = $id('sblink-fab');
    if (!el) return;
    el.classList.remove('sblink-idle');
    clearTimeout(idleTimer);
    if (settings().btnDim) idleTimer = setTimeout(() => { if (!drag) $id('sblink-fab')?.classList.add('sblink-idle'); }, 3500);
}

export const isDragging = () => !!drag?.moved;
