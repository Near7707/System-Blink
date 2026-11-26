// The floating hexagon button. Tap = open the System window; press and move a few px = drag.
// Its place, size and ring are kept per device. It stays out of the notch, the home bar and the input box.

import { t } from '../i18n.js';
import { settings, device, saveDevice, currentChatId } from '../store.js';
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

const sizeOf = () => (device().size === 'small' ? 48 : 60);
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
    el.className = `sblink-fab sblink-fab-${d.size} sblink-ring-${d.ring}${settings().motion ? ' sblink-moving' : ''}`;
    el.setAttribute('aria-label', t('ext_name'));
    el.innerHTML = `
      <svg class="sblink-fabring" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"/></svg>
      <div class="sblink-fabbody"><i class="sblink-fabscan"></i>${hexMark('sblink-fabmark')}</div>
      <div class="sblink-fabcode">SYS<span class="sblink-cursor">▌</span></div>
      <div class="sblink-fabchip"${count ? '' : ' hidden'}>${esc(count)}</div>`;
    noChat = !currentChatId();
    el.hidden = hidden || noChat;
    place();
    wakeUp();
}

export function unmountFab() { $id('sblink-fab')?.remove(); endDrag(); }

export function setFabHidden(on) { hidden = !!on; const el = $id('sblink-fab'); if (el) el.hidden = hidden || noChat; }
/** Hide the button while no chat is open; show it again in a chat. */
export function syncFabChat() {
    noChat = !currentChatId();
    const el = $id('sblink-fab');
    if (el) { const was = el.hidden; el.hidden = hidden || noChat; if (was && !el.hidden) place(); }
}

export function setFabCount(n) {
    count = n;
    const chip = $id('sblink-fab')?.querySelector('.sblink-fabchip');
    if (chip) { chip.hidden = !n; chip.textContent = String(n); }
}

function bounds() {
    const vp = viewport();
    const ins = safeInsets();
    const sz = sizeOf();
    const minX = vp.x + Math.max(4, ins.left + 4);
    const maxX = vp.x + vp.w - sz - Math.max(4, ins.right + 4);
    const minY = vp.y + Math.max(8, ins.top + 8) + 40; // under the top bar
    const bottomLimit = Math.min(vp.y + vp.h - Math.max(8, ins.bottom + 8), inputTop() - 8);
    const stripEl = $id('sblink-strip');
    const stripTop = stripEl && !stripEl.hidden ? stripEl.getBoundingClientRect().top - 8 : Infinity;
    const maxY = Math.min(bottomLimit, stripTop) - sz - 18; // room for the SYS mark under it
    return { minX, maxX, minY, maxY: Math.max(minY, maxY), sz, vp };
}

function savedPos() {
    const p = device().pos[devKey()];
    return p && typeof p.fx === 'number' ? p : null;
}

/** Put the button where it was kept (as a share of the screen, so turning the phone keeps it inside). */
export function place() {
    const el = $id('sblink-fab');
    if (!el || drag) return;
    const b = bounds();
    const p = savedPos();
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
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: Number(el.dataset.x) || 0, oy: Number(el.dataset.y) || 0, moved: false };
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
        el.classList.add('sblink-dragging');
        const ghost = document.createElement('div');
        ghost.id = 'sblink-fabghost';
        ghost.className = `sblink-fabghost sblink-fab-${device().size}`;
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
        if (settings().btnSnap) x = (x + b.sz / 2 < b.vp.x + b.vp.w / 2) ? b.minX : b.maxX;
        const d = device();
        d.pos[devKey()] = { fx: b.maxX > b.minX ? (x - b.minX) / (b.maxX - b.minX) : 1, fy: b.maxY > b.minY ? (y - b.minY) / (b.maxY - b.minY) : 0.5 };
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
