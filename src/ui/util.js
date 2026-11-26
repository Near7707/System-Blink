import { settings } from '../store.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $id = (id) => document.getElementById(id);
export const motionOn = () => settings().motion !== false;
export const isPhone = () => Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 600;

/** The visible area (iPhone: right after the keyboard closes, visualViewport lies for a moment). */
export function viewport() {
    const vv = window.visualViewport;
    const W = window.innerWidth, H = window.innerHeight;
    if (!vv) return { x: 0, y: 0, w: W, h: H };
    const focusedInput = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!focusedInput && vv.height < H - 80) return { x: 0, y: 0, w: W, h: H };
    return { x: vv.offsetLeft || 0, y: vv.offsetTop || 0, w: vv.width || W, h: vv.height || H };
}

export function safeInsets() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    probe.remove();
    return out;
}

/** The top of SillyTavern's input area (things must stay above it). */
export function inputTop() {
    const el = $id('form_sheld') || $id('send_form');
    const r = el?.getBoundingClientRect();
    return r && r.height ? r.top : window.innerHeight;
}

/** Type text in letter by letter (or all at once when motion is off). */
export function typeIn(el, text, speed = 28) {
    if (!el) return;
    if (!motionOn()) { el.textContent = text; return; }
    el.textContent = '';
    let i = 0;
    const step = () => {
        if (!el.isConnected) return;
        i += 1;
        el.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(step, speed);
    };
    step();
}
