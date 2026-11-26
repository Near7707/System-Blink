// Big popups (one at a time, [OK] to close), small notices, the "next day?" strip above the
// input box, and the log cards under messages. Nothing here shows while a reply is being written.

import { t } from '../i18n.js';
import { settings, room } from '../store.js';
import { active, chatView, suggestion, nextDay, dismissSuggestion, checkFor, isAI, todays, questState, condsOf } from '../engine.js';
import { icon, hexMark } from '../icons.js';
import { esc, $id, typeIn, motionOn, inputTop, viewport } from './util.js';

let hooks = { openTab: () => {}, badge: () => {} };
export function setPopHooks(h) { hooks = { ...hooks, ...h }; }

let held = false;   // a reply is being written
export function hold(on) { held = !!on; if (!held) { pump(); renderStrip(); renderCards(); } else hideStrip(); }
export const isHeld = () => held;

// ---------- big popups ----------
const queue = [];
let showing = null;

export function popup(p) {
    if (!settings().enabled) return;
    queue.push(p);
    hooks.badge();
    pump();
}
export const waiting = () => queue.length + (showing ? 1 : 0);

function pump() {
    if (held || showing || !queue.length) return;
    showing = queue.shift();
    draw(showing);
    hooks.badge();
}

function closePopup(act) {
    const p = showing;
    showing = null;
    $id('sblink-pop')?.remove();
    hooks.badge();
    try { p?.onClose?.(act); } catch (e) { console.error('[System Blink]', e); }
    setTimeout(pump, 120);
}

function draw(p) {
    $id('sblink-pop')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'sblink-pop';
    wrap.className = `sblink-popwrap${motionOn() ? ' sblink-moving' : ''}${p.variant ? ` sblink-v-${p.variant}` : ''}`;
    const more = queue.length;
    const dots = more ? `<span class="sblink-popdots">${'◆'.repeat(1)}${'◇'.repeat(Math.min(4, more))}</span>` : '';
    const head = p.kind === 'awaken'
        ? `<div class="sblink-hexspin">${hexMark()}</div><div class="sblink-tag">AWAKEN</div>`
        : `<div class="sblink-tag">${esc(p.tag || 'SYSTEM')}</div>`;
    wrap.innerHTML = `
      <div class="sblink-pop sblink-holo" role="alertdialog" aria-modal="true">
        <i class="sblink-cn sblink-cn-tl"></i><i class="sblink-cn sblink-cn-tr"></i><i class="sblink-cn sblink-cn-bl"></i><i class="sblink-cn sblink-cn-br"></i>
        ${head}
        <div class="sblink-pophead"><span class="sblink-code">${esc(p.code || 'SYS.NOTICE')}</span>${dots}</div>
        <div class="sblink-stripes"></div>
        <div class="sblink-poptitle"><span class="sblink-typed"></span><span class="sblink-cursor">▌</span></div>
        ${p.lines?.length ? `<div class="sblink-poplines">${p.lines.map(l => `<div class="sblink-popline">${l}</div>`).join('')}</div>` : ''}
        ${p.body ? `<div class="sblink-popbody">${p.body}</div>` : ''}
        ${p.warn ? `<div class="sblink-popwarn">${esc(p.warn)}</div>` : ''}
        ${p.calm ? `<div class="sblink-popcalm">${esc(p.calm)}</div>` : ''}
        <div class="sblink-popbtns">
          ${p.second ? `<button type="button" class="sblink-btn" data-pop="second"><span class="sblink-ell">${esc(p.second)}</span></button>` : ''}
          <button type="button" class="sblink-btn sblink-btn-main" data-pop="ok"><span class="sblink-ell">${esc(p.ok || t('ok'))}</span></button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    typeIn(wrap.querySelector('.sblink-typed'), p.title || '');
    const dec = wrap.querySelector('[data-decode]');
    if (dec) decode(dec, dec.dataset.decode);
    wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pop]');
        if (b) closePopup(b.dataset.pop);
    });
    setTimeout(() => wrap.querySelector('.sblink-btn-main')?.focus({ preventScroll: true }), 50);
}

export function clearPopups() { queue.length = 0; if (showing) { showing = null; $id('sblink-pop')?.remove(); } hooks.badge(); }

// ---------- small notices ----------
export function notice(text, kind = '') {
    if (!settings().enabled) return;
    let box = $id('sblink-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'sblink-toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `sblink-toast sblink-holo ${kind ? `sblink-toast-${kind}` : ''}`;
    el.innerHTML = `${hexMark()}<span class="sblink-ell">${esc(text)}</span><i class="sblink-toastbar"></i>`;
    box.appendChild(el);
    const life = 2800;
    if (motionOn()) el.querySelector('.sblink-toastbar').style.animationDuration = `${life}ms`;
    setTimeout(() => { el.classList.add('sblink-gone'); setTimeout(() => el.remove(), 300); }, life);
    while (box.children.length > 3) box.firstChild.remove();
}

// ---------- the "next day?" strip ----------
let stripOpen = false;
let stripFolded = false;
let stripKey = '';

export function foldStrip() { stripFolded = true; stripOpen = false; renderStrip(); }

function hideStrip() { const el = $id('sblink-strip'); if (el) el.hidden = true; }

export function renderStrip() {
    const sug = !held && active() ? suggestion() : null;
    const winOpen = !!$id('sblink-win');
    let el = $id('sblink-strip');
    if (!sug) { if (el) el.remove(); stripKey = ''; hooks.badge(); return; }
    if (sug.key !== stripKey) { stripKey = sug.key; stripOpen = false; stripFolded = false; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'sblink-strip';
        el.className = 'sblink-strip sblink-holo';
        document.body.appendChild(el);
        el.addEventListener('click', onStripClick);
    }
    el.hidden = winOpen;
    el.classList.toggle('sblink-strip-open', stripOpen);
    el.classList.toggle('sblink-strip-folded', stripFolded && !stripOpen);
    const one = sug.days === 1;
    const timeBit = (v) => (v ? ` · ${esc(v)}` : '');
    const open = sug.open || [];
    el.innerHTML = `
      <div class="sblink-striphead">
        <span class="sblink-dia">◆</span><span class="sblink-code">SYS.SUGGEST // DAY</span>
        <span class="sblink-sp"></span>
        <button type="button" class="sblink-link" data-strip="more">${stripOpen ? esc(t('fold')) + ' ▴' : esc(t('details')) + ' ▾'}</button>
        <button type="button" class="sblink-x" data-strip="x" aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
      <div class="sblink-striptitle">${esc(one ? t('sug_one') : t('sug_many'))}</div>
      ${stripOpen ? `
      <div class="sblink-stripbody">
        <div class="sblink-nowbox"><span class="sblink-code">NOW</span> ${esc(t('day_n', { n: sug.fromDay }))}${timeBit(sug.fromTime)} <span class="sblink-arrow">▸</span> <span class="sblink-code">NEXT</span> ${esc(t('day_n', { n: sug.toDay }))}${timeBit(sug.nextTime)}</div>
        ${sug.reason ? `<div class="sblink-why"><span class="sblink-code">${esc(t('evidence'))}</span> “${esc(sug.reason)}”</div>` : ''}
        <div class="sblink-settle"><div class="sblink-code">${esc(t('settle_once'))}</div>
          ${open.length ? `<div>◇ ${esc(t('settle_failed', { list: open.map(q => `「${q.name}」`).join(' ') }))}</div>` : ''}
          <div>◇ ${esc(t('settle_new'))}</div>
          <div>◇ ${esc(t('settle_shop'))}</div>
          <div>◇ ${esc(t(one ? 'settle_ai_one' : 'settle_ai_many'))}</div>
        </div>
      </div>` : `<div class="sblink-stripline">${esc(t('day_n', { n: sug.fromDay }))} ▸ ${esc(t('day_n', { n: sug.toDay }))} · ${esc(t('settle_once_short'))}</div>`}
      <div class="sblink-stripbtns">
        <button type="button" class="sblink-btn" data-strip="later"><span class="sblink-ell">${esc(t('later'))}</span></button>
        <button type="button" class="sblink-btn sblink-btn-main" data-strip="go"><span class="sblink-ell">${esc(t('next_day'))}</span></button>
      </div>`;
    placeStrip();
    hooks.badge();
}

function onStripClick(e) {
    const b = e.target.closest('[data-strip]');
    if (!b) return;
    const sug = suggestion();
    const act = b.dataset.strip;
    if (act === 'more') { stripOpen = !stripOpen; stripFolded = false; renderStrip(); return; }
    if (!sug) return renderStrip();
    if (act === 'x' || act === 'later') { dismissSuggestion(sug.key); renderStrip(); return; }
    if (act === 'go') { nextDay(sug.days, sug.nextTime); renderStrip(); }
}

export function placeStrip() {
    const el = $id('sblink-strip');
    if (!el || el.hidden) return;
    const vp = viewport();
    const top = Math.min(inputTop(), vp.y + vp.h);
    el.style.bottom = `${Math.max(0, window.innerHeight - top + 6)}px`;
    el.style.maxHeight = `${Math.max(120, top - vp.y - 60)}px`;
}

export const stripShown = () => !!$id('sblink-strip');

// ---------- log cards under messages ----------
const RARITY_CLASS = { common: 'sblink-r-common', rare: 'sblink-r-rare', epic: 'sblink-r-epic', legendary: 'sblink-r-legendary' };

function cardFor(r, m, key, i) {
    if (!r) return '';
    if (isAI(m)) {
        const c = checkFor(r, key);
        if (!c) return '';
        const view = chatView();
        const qs = c.quests.map(x => ({ x, q: r.quests.find(q => q.id === x.questId) }))
            .map(o => ({ ...o, e: o.q && r.ledger.find(l => l.key === key && l.questId === o.q.id && (l.cond ?? null) === (o.x.cond ?? null) && !l.undone) }))
            .filter(o => o.q && o.e);
        const life = Object.keys(c.life || {}).filter(k => ['time', 'weather', 'place', 'date'].includes(k));
        if (!qs.length && !life.length) return '';
        const lines = qs.map(({ q, x, e }) => {
            const conds = condsOf(q);
            const st = questState(r, q, view);
            const name = conds && x.cond != null ? `${q.name} · ${conds[x.cond]}` : q.name;
            const tag = st.status === 'done' ? '<span class="sblink-code sblink-clear">CLEAR</span>'
                : `<span class="sblink-code">${(st.condDone || []).filter(Boolean).length} / ${conds?.length || 1}</span>`;
            return `<div class="sblink-cardline"><span class="sblink-dia">◆</span>${tag}<span class="sblink-ell">${esc(name)}</span>${e.pts && st.status === 'done' ? `<b class="sblink-pts">+${e.pts}P</b>` : ''}</div>`;
        });
        if (life.length) {
            const bits = life.map(k => `${esc(t(`life_${k}`))} ${c.lifeFrom?.[k] ? `${esc(c.lifeFrom[k])} ▸ ` : ''}${esc(c.life[k])}`).join(' · ');
            lines.push(`<div class="sblink-cardline sblink-cardlife"><span class="sblink-dia">◇</span><span class="sblink-ell">${bits}</span></div>`);
        }
        return `<div class="sblink-cardhead"><span class="sblink-code">SYS.LOG // #${i}</span><span class="sblink-sp"></span><span class="sblink-open">${esc(t('open'))} ▸</span></div>${lines.join('')}|quests`;
    }
    if (m?.is_user) {
        const us = r.uses.filter(u => u.key === key);
        if (!us.length) return '';
        return `<div class="sblink-cardhead"><span class="sblink-code">SYS.LOG // ITEM</span></div>${us.map(u => `<div class="sblink-cardline">${icon(u.icon)}<span class="sblink-ell">${esc(t('used_x', { name: u.name }))}</span><b class="sblink-rar ${RARITY_CLASS[u.rarity] || ''}">${esc(t(`rarity_${u.rarity}`))}</b></div>`).join('')}|bag`;
    }
    return '';
}

let cardTimer = 0;
export function renderCardsSoon() { clearTimeout(cardTimer); cardTimer = setTimeout(renderCards, 80); }

/** Put the cards back after SillyTavern redraws messages. Never touches the message text itself. */
export function renderCards() {
    const chatEl = $id('chat');
    if (!chatEl) return;
    const s = settings();
    const r = room();
    const show = !held && s.logCards && active(r);
    const view = chatView();
    chatEl.querySelectorAll('.mes[mesid]').forEach(mes => {
        const i = Number(mes.getAttribute('mesid'));
        const m = view.list[i];
        const key = view.keys[i];
        let html = show && m ? cardFor(r, m, key, i) : '';
        let tab = '';
        if (html) { const cut = html.lastIndexOf('|'); tab = html.slice(cut + 1); html = html.slice(0, cut); }
        const sig = html ? `${key}|${html.length}|${hashStr(html)}` : '';
        let card = mes.querySelector(':scope .sblink-card');
        if (!sig) { card?.remove(); return; }
        if (card && card.dataset.sig === sig) return;
        if (!card) {
            card = document.createElement('div');
            card.className = 'sblink-card sblink-holo';
            card.addEventListener('click', () => hooks.openTab(card.dataset.tab || 'quests'));
            const block = mes.querySelector('.mes_block') || mes;
            const text = block.querySelector(':scope > .mes_text') || block.querySelector('.mes_text');
            if (text && text.parentElement) text.parentElement.insertBefore(card, text.nextSibling);
            else block.appendChild(card);
        }
        card.dataset.sig = sig;
        card.dataset.tab = tab;
        card.classList.toggle('sblink-card-mine', !!m?.is_user);
        card.innerHTML = html;
    });
}

export function removeCards() { document.querySelectorAll('.sblink-card').forEach(el => el.remove()); }

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// popup builders used by index.js
export function questsPopup(list) {
    popup({
        tag: 'QUEST', code: 'SYS.NOTICE // DAILY', title: t('pop_daily'),
        lines: list.map(q => `<span class="sblink-dia">◆</span><span class="sblink-ell">${esc(q.name)}</span><b class="sblink-pts">${q.pts ? `+${q.pts}P` : ''}</b>`),
        warn: t('penalty_warn'), second: t('view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    });
}

/** Broken letters that settle into the real text one by one. */
function decode(el, text) {
    if (!motionOn()) { el.textContent = text; return; }
    const chars = Array.from(text);
    let done = 0;
    const step = () => {
        if (!el.isConnected) return;
        done += 1;
        el.textContent = chars.map((c, i) => (i < done || c === ' ' ? c : '▒')).join('');
        if (done < chars.length) setTimeout(step, 45);
    };
    el.textContent = chars.map(c => (c === ' ' ? ' ' : '▒')).join('');
    setTimeout(step, 500);
}

const diamonds = (left, all) => `<span class="sblink-left">${Array.from({ length: all }, (_, i) => `<i class="${i < left ? 'sblink-on' : ''}"></i>`).join('')}</span>`;
export { diamonds };

/** ⑱ A sudden quest: [Decline] / [Accept]. */
export function suddenPopup(q, pts, answer) {
    popup({
        variant: 'sudden', tag: 'SUDDEN', code: 'SYS.NOTICE // SUDDEN', title: t('pop_sudden'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(q.name)}</span><b class="sblink-pts">+${pts}P</b>`,
            `<span class="sblink-code">${esc(t('limit_replies', { n: q.limit }))}</span>${diamonds(q.limit, q.limit)}`],
        calm: t('decline_ok'), second: t('decline'), ok: t('accept'),
        onClose: (act) => answer(act === 'ok'),
    });
}

/** ㉑ A hidden quest was found. */
export function hiddenPopup(q, pts) {
    popup({
        variant: 'hidden', tag: 'HIDDEN', code: 'SYS.NOTICE // HIDDEN', title: t('pop_hidden'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext" data-decode="${esc(q.name)}"></span><b class="sblink-pts">+${pts}P</b>`],
        body: `${q.why ? `<div><span class="sblink-code">${esc(t('found_why'))}</span> · ${esc(q.why)}</div>` : ''}<div>${esc(t('hidden_free'))}</div>`,
        second: t('view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    });
}

/** A stage of the main goal was cleared. */
export function stagePopup(q, pts) {
    popup({
        tag: 'CLEAR', code: 'SYS.GOAL // MAIN', title: t('pop_stage'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(q.name)}</span><b class="sblink-pts">+${pts}P</b>`],
        body: esc(t('stage_next')),
    });
}

export function goalDonePopup(g) {
    popup({
        tag: 'CLEAR', code: 'SYS.GOAL // COMPLETE', title: t('pop_goal_done'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(g.title)}</span>`],
        body: esc(t('goal_done_body')),
    });
}

export function todayCount(r = room()) { return todays(r).length; }
