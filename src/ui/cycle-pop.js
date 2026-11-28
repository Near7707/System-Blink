// 0.8.0 regression popups: ① vital signs lost (the System window, broken at two corners, breaking apart on
// [Start over]), ② beginning the regression, ③ a new life has begun. The tutorial's regression hint too.

import { t } from '../i18n.js';
import { room } from '../store.js';

import { eventsOf } from '../cycle.js';
import { esc, isPhone, motionOn } from './util.js';
import { popup } from './pop.js';

const row = (k, v) => `<div class="sblink-dthrow"><span class="sblink-dia">◆</span><span class="sblink-dthkey">${esc(t(k))}</span><b class="sblink-ell">${v}</b></div>`;
// a few pieces already falling off the broken corners (kept off the title and the table)
const DECO = [
    'right:-4px;top:41%;width:8px;height:8px;--dx:30px;--dy:2px;--r:87deg;--t:3.5s;--dl:-2.4s',
    'right:38px;bottom:-4px;width:8px;height:8px;--dx:21px;--dy:48px;--r:-12deg;--t:4s;--dl:-0.2s',
    'right:-2px;bottom:30px;width:10px;height:10px;--dx:24px;--dy:44px;--r:7deg;--t:4.2s;--dl:-2.6s',
    'left:4px;top:9px;width:9px;height:9px;--dx:-16px;--dy:-26px;--r:45deg;--t:3.9s;--dl:-0.9s',
    'left:60%;top:3px;width:7px;height:7px;--dx:-7px;--dy:-30px;--r:-55deg;--t:3.8s;--dl:-1.6s',
];
const deco = () => `<div class="sblink-deco" aria-hidden="true">${DECO.map(s => `<i class="sblink-chunk" style="${s}"></i>`).join('')}<i class="sblink-hole" style="right:14%;top:22%"></i><i class="sblink-hole" style="right:9%;top:31%;width:4px;height:4px"></i></div>`;

/**
 * ① A death the story check found. `on`: regression is on in this chat (straight to the confirm page) —
 * otherwise ② comes first. `answer(act)`: 'go' | 'cont' | 'noask'.
 */
export function deathPopup(d, { n = 1, answer }) {
    const day = d.day || room()?.day || 1;
    const body = `<div class="sblink-dthtable">
        ${row('dth_cause', esc(d.why || '…'))}
        ${row('dth_life', esc(t('cyc_day', { n: day })))}
        ${row('dth_cycle', `${n} <span class="sblink-acc">→ ${n + 1}</span>`)}
        ${row('dth_return', `${esc(t('dth_return_v'))} <span class="sblink-dim">· ${esc(t('dth_return_later'))}</span>`)}
      </div>
      <div class="sblink-dthq">${esc(t('dth_q'))}</div>
      <div class="sblink-dthq2">${esc(t('dth_q2'))}</div>
      <div class="sblink-dthbond">${esc(t('dth_bonds'))}</div>`;
    popup({
        variant: 'death', tag: 'CYCLE', code: t('dth_code'), title: t('dth_title'), plainTitle: true, shake: false,
        body, deco: deco(), second: t('dth_cont'), ok: t('dth_go'), link: t('dth_noask'), shatter: true, deathFor: d.key,
        onClose: (act) => answer(act === 'ok' ? 'go' : act === 'link' ? 'noask' : 'cont'),
    });
}

/** ② From a chat where regression is off: what [Continue] will do, said plainly. */
export function procPopup(go) {
    const works = ['proc_w1', 'proc_w2', 'proc_w3', 'proc_w4'].map(k => `<div class="sblink-procline"><span class="sblink-dia">◆</span><span>${esc(t(k))}</span></div>`).join('');
    popupNow({
        variant: 'scan', tag: 'CYCLE', code: t('proc_code'), title: t('proc_title'), shake: false,
        lines: ['proc_l1', 'proc_l2', 'proc_l3'].map(k => esc(t(k))),
        body: `<div class="sblink-prochead">${esc(t('proc_head'))}</div>${works}`,
        second: t('stop'), ok: t('go_on'), onClose: (act) => go(act === 'ok'),
    });
}

/** ③ A new life has begun: what came along, [Begin as a story] / [OK], and undo (until my next message). */
export function startPopup({ n, kept, onClose }) {
    const r = room();
    const ahead = eventsOf(r).length;
    const keptText = kept.length ? kept.map(esc).join(' · ') : esc(t('cyc_kept_none'));
    popupNow({ // before the new day's quest popup
        tag: 'CYCLE', code: `SYS.CYCLE // ${String(n).padStart(2, '0')}`, title: t('cyc_start_title', { n }), shake: false,
        body: `<div class="sblink-cycsum">
            <div><span class="sblink-code">${t('cyc_kept')}</span><span class="sblink-ell">${keptText}</span></div>
            <div><span class="sblink-code">${t('cyc_memory')}</span><span class="sblink-ell">${esc(t('cyc_memory_v', { n: n - 1 }))}</span></div>
            <div><span class="sblink-code">${t('cyc_ahead')}</span><span class="sblink-ell">${esc(ahead ? t('cyc_ahead_n', { n: ahead }) : t('cyc_ahead_none'))}</span></div></div>`,
        top: t('wake_story'), ok: t('ok'), link: t('cyc_undo', { n: n - 1 }), onClose,
    });
}

/** The tutorial-complete popup's hint about regression (a dashed box). */
export function cycleHint() {
    return `<div class="sblink-hintbox"><div class="sblink-code">◇ ${esc(t('hint_cycle_code'))}</div>
      <div class="sblink-hinttitle">${esc(t('hint_cycle_title'))}</div>
      <div>◇ ${esc(t('hint_cycle_1'))}</div><div>◇ ${esc(t('hint_cycle_2'))}</div><div>◇ ${esc(t('hint_cycle_3'))}</div>
      <div class="sblink-hinttitle">${esc(t('hint_cycle_again'))}</div><div>${esc(t('hint_cycle_again_body'))}</div></div>`;
}

let nowHook = (p) => popup(p);
/** (index.js sets this to put a popup in front of the others) */
export function setNowHook(f) { nowHook = f; }
const popupNow = (p) => nowHook(p);

/**
 * [Start over]: the window breaks into small pieces from where it was pressed (each piece carries its part of the
 * window), they shake, burst out, spin and fall, with a little dust; then the screen dims. About a second.
 */
export function shatter(wrap, at) {
    return new Promise((done) => {
        const box = wrap?.querySelector('.sblink-pop');
        if (!box || !motionOn() || typeof box.animate !== 'function') { done(); return; }
        const rect = box.getBoundingClientRect();
        const size = isPhone() ? 52 : 40; // about 90 pieces on a phone, 120–150 on a PC
        const cols = Math.max(3, Math.ceil(rect.width / size)), rows = Math.max(3, Math.ceil(rect.height / size));
        const ox = at?.x ?? rect.left + rect.width * 0.7, oy = at?.y ?? rect.bottom - 30;
        const layer = document.createElement('div');
        layer.className = 'sblink-shards';
        wrap.appendChild(layer);
        const far = Math.hypot(rect.width, rect.height);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const piece = box.cloneNode(true);
                piece.removeAttribute('id');
                piece.classList.add('sblink-shard');
                piece.setAttribute('aria-hidden', 'true');
                Object.assign(piece.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', maxWidth: 'none', maxHeight: 'none' });
                const l = x * size, tp = y * size;
                piece.style.clipPath = `inset(${tp}px ${Math.max(0, rect.width - l - size)}px ${Math.max(0, rect.height - tp - size)}px ${l}px)`;
                layer.appendChild(piece);
                const cx = rect.left + l + size / 2, cy = rect.top + tp + size / 2;
                const dist = Math.hypot(cx - ox, cy - oy);
                const ang = Math.atan2(cy - oy, cx - ox);
                const push = 40 + Math.random() * 90;
                const dx = Math.cos(ang) * push + (Math.random() - 0.5) * 40, dy = Math.sin(ang) * push * 0.6 + 220 + Math.random() * 260;
                const rot = (Math.random() - 0.5) * 540;
                const delay = (dist / far) * 380;
                piece.style.transformOrigin = `${l + size / 2}px ${tp + size / 2}px`;
                piece.animate([
                    { transform: 'translate(0,0) rotate(0)', opacity: 1 },
                    { transform: `translate(${(Math.random() - 0.5) * 3}px,${(Math.random() - 0.5) * 3}px)`, opacity: 1, offset: 0.12 },
                    { transform: `translate(${dx * 0.35}px,${dy * 0.12}px) rotate(${rot * 0.3}deg)`, opacity: 1, offset: 0.4 },
                    { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity: 0 },
                ], { duration: 820 + Math.random() * 260, delay, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
            }
        }
        const dust = isPhone() ? 110 : 150;
        for (let i = 0; i < dust; i++) {
            const s = document.createElement('i');
            s.className = 'sblink-dust';
            const sx = rect.left + Math.random() * rect.width, sy = rect.top + Math.random() * rect.height;
            Object.assign(s.style, { left: `${sx}px`, top: `${sy}px` });
            layer.appendChild(s);
            s.animate([{ transform: 'translate(0,0)', opacity: 0.9 }, { transform: `translate(${(Math.random() - 0.5) * 120}px,${80 + Math.random() * 200}px)`, opacity: 0 }],
                { duration: 700 + Math.random() * 500, delay: Math.random() * 400, easing: 'ease-out', fill: 'forwards' });
        }
        box.style.visibility = 'hidden';
        wrap.classList.add('sblink-broken');
        setTimeout(() => { layer.remove(); done(); }, 1250);
    });
}
