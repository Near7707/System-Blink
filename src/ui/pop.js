// Big popups (one at a time, [OK] to close), small notices, the "next day?" strip above the
// input box, and the log cards under messages. Nothing here shows while a reply is being written.

import { t, lang } from '../i18n.js';
import { settings, room } from '../store.js';
import { active, chatView, suggestion, nextDay, dismissSuggestion, isAI, todays, questState, condsOf, penaltyFor, hiddenOpen, toneOf, warnFor, warnCount, WARN_MAX } from '../engine.js';
import { specNames, starWho } from '../data.js';
import { gradeBadge, gradeClass, isTop, tag } from './skills.js';
import { icon, hexMark } from '../icons.js';
import { esc, $id, typeIn, motionOn, inputTop, viewport, safeInsets } from './util.js';
import { drawQuestBlocks, undrawQuestBlocks, setQBlockHooks } from './qblock.js';

let hooks = { openTab: () => {}, openSkill: () => {}, badge: () => {} };
export function setPopHooks(h) { hooks = { ...hooks, ...h }; setQBlockHooks(hooks); }

/** The System's voice in this chat, as a class (2-D). */
export const toneClass = () => `sblink-tn-${active() ? toneOf() : 'game'}`;
const isThreat = () => active() && toneOf() === 'threat';

let held = false;   // a reply is being written
export function hold(on) { held = !!on; if (!held) { pump(); renderStrip(); renderCards(); } else hideStrip(); }
export const isHeld = () => held;

// ---------- keeping big popups inside the visible screen ----------
const POP_IDS = ['sblink-pop', 'sblink-gacha', 'sblink-off'];

/**
 * Big popups sit inside the part of the screen you can actually see (iPhone Safari's page area can be
 * taller than that), clear of the notch and the home bar. A popup taller than the room left scrolls
 * inside, and its buttons stay in sight at the bottom.
 */
export function placePops() {
    const vp = viewport();
    const ins = safeInsets();
    for (const id of POP_IDS) {
        const wrap = $id(id);
        if (!wrap) continue;
        Object.assign(wrap.style, {
            inset: 'auto', left: `${Math.round(vp.x)}px`, top: `${Math.round(vp.y)}px`, width: `${Math.round(vp.w)}px`, height: `${Math.round(vp.h)}px`,
            paddingTop: `${Math.round(Math.max(18, ins.top + 14))}px`, paddingBottom: `${Math.round(Math.max(18, ins.bottom + 10))}px`,
        });
    }
}

/** Put everything but the corner marks, the tag and the buttons into one part that can scroll. */
export function fitPop(wrap) {
    const box = wrap?.querySelector('.sblink-pop');
    if (!box || box.querySelector(':scope > .sblink-popscroll')) return;
    const scroll = document.createElement('div');
    scroll.className = 'sblink-popscroll';
    const btns = box.querySelector(':scope > .sblink-popbtns');
    for (const el of [...box.children]) {
        if (el.matches('.sblink-cn, .sblink-tag, .sblink-popbtns, .sblink-poplink')) continue; // buttons (and the quiet choice under them) always show
        scroll.appendChild(el);
    }
    box.insertBefore(scroll, btns || null);
    placePops();
}

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
    wrap.className = `sblink-popwrap ${toneClass()}${motionOn() ? ' sblink-moving' : ''}${p.variant ? ` sblink-v-${p.variant}` : ''}${p.shake ?? isThreat() ? ' sblink-shake' : ''}`;
    const more = queue.length;
    const dots = more ? `<span class="sblink-popdots">${'◆'.repeat(1)}${'◇'.repeat(Math.min(4, more))}</span>` : '';
    const head = p.kind === 'awaken'
        ? `<div class="sblink-hexspin">${hexMark()}</div><div class="sblink-tag">AWAKEN</div>`
        : `<div class="sblink-tag">${esc(p.tag || 'SYSTEM')}</div>`;
    wrap.innerHTML = `${p.flash ? `<div class="sblink-flash sblink-flash-${p.flash}"></div>` : ''}
      <div class="sblink-pop sblink-holo" role="alertdialog" aria-modal="true">
        <i class="sblink-cn sblink-cn-tl"></i><i class="sblink-cn sblink-cn-tr"></i><i class="sblink-cn sblink-cn-bl"></i><i class="sblink-cn sblink-cn-br"></i>
        ${head}
        <div class="sblink-pophead"><span class="sblink-code">${esc(p.code || 'SYS.NOTICE')}</span>${dots}</div>
        <div class="sblink-stripes"></div>
        <div class="sblink-poptitle"><span class="sblink-typed"></span><span class="sblink-cursor">▌</span></div>
        ${p.sub ? `<div class="sblink-popsub">${p.sub}</div>` : ''}
        ${p.stage || ''}
        ${p.lines?.length ? `<div class="sblink-poplines">${p.lines.map(l => `<div class="sblink-popline">${l}</div>`).join('')}</div>` : ''}
        ${p.body ? `<div class="sblink-popbody">${p.body}</div>` : ''}
        ${p.warn ? `<div class="sblink-popwarn">${esc(p.warn)}</div>` : ''}
        ${p.calm ? `<div class="sblink-popcalm">${esc(p.calm)}</div>` : ''}
        ${p.dust ? `<div class="sblink-dustbox">${Array.from({ length: 8 }, (_, i) => `<i style="left:${8 + i * 11}%;animation-delay:${(i * 0.37) % 2.6}s"></i>`).join('')}</div>` : ''}
        <div class="sblink-popbtns">
          ${p.second ? `<button type="button" class="sblink-btn" data-pop="second"><span class="sblink-ell">${esc(p.second)}</span></button>` : ''}
          <button type="button" class="sblink-btn sblink-btn-main" data-pop="ok"><span class="sblink-ell">${esc(p.ok || t('ok'))}</span></button>
        </div>
        ${p.link ? `<button type="button" class="sblink-poplink" data-pop="link"><span class="sblink-ell">${esc(p.link)}</span></button>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    fitPop(wrap);
    typeIn(wrap.querySelector('.sblink-typed'), p.title || '');
    const dec = wrap.querySelector('[data-decode]');
    if (dec) decode(dec, dec.dataset.decode);
    wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pop]');
        if (b) closePopup(b.dataset.pop);
    });
    setTimeout(() => wrap.querySelector('.sblink-btn-main')?.focus({ preventScroll: true }), 50);
}

/** 0.6.2+: drop popups that belong to another chat (an unanswered "wake?" question when the chat changes). */
export function dropPopups(test) {
    for (let i = queue.length - 1; i >= 0; i--) if (test(queue[i])) queue.splice(i, 1);
    if (showing && test(showing)) { const p = showing; showing = null; $id('sblink-pop')?.remove(); try { p.onDrop?.(); } catch { /* ignore */ } setTimeout(pump, 120); }
    hooks.badge();
}
export const popupWaiting = (test) => (showing && test(showing)) || queue.some(test);

export function clearPopups() { $id('sblink-gacha')?.remove(); queue.length = 0; if (showing) { showing = null; $id('sblink-pop')?.remove(); } hooks.badge(); }

// ---------- small notices ----------
export function notice(text, kind = '', right = '') {
    if (!settings().enabled) return;
    let box = $id('sblink-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'sblink-toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `sblink-toast sblink-holo ${toneClass()} ${kind ? `sblink-toast-${kind}` : ''}`;
    el.innerHTML = `${hexMark()}<span class="sblink-ell">${esc(text)}</span>${right ? `<b class="sblink-toastpts">${esc(right)}</b>` : ''}<i class="sblink-toastbar"></i>`;
    box.appendChild(el);
    const life = kind === 'spec' || kind === 'gold' ? 4200 : 2800;
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
        document.body.appendChild(el);
        el.addEventListener('click', onStripClick);
    }
    el.className = `sblink-strip sblink-holo ${toneClass()}`;
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
          ${open.some(q => penaltyFor(q)) ? `<div class="sblink-neg">◇ ${esc(t('settle_penalty'))}</div>` : ''}
          ${open.some(q => warnFor(q)) ? `<div class="sblink-neg">◇ ${esc(t('settle_warn'))}</div>` : ''}
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

/** Records grouped by message, made once per redraw (long chats: no search per message). */
function indexRecords(r, view) {
    const clears = new Map(), lives = new Map(), uses = new Map();
    const add = (map, k, v) => { if (k == null) return; const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); };
    for (const e of r.ledger) if (!e.undone && e.key) add(clears, e.key, e);
    for (const l of r.lifeLog || []) lives.set(l.key, l);
    for (const u of r.uses) add(uses, u.key, u);
    // 2-C: a hidden skill effect opened by this reply
    const unlocks = new Map();
    for (const k of r.skills || []) if (k.hidden?.key && view.index.has(k.hidden.key)) add(unlocks, k.hidden.key, k);
    // a sudden quest whose time ran out: under the reply that used its last turn
    const fails = new Map();
    for (const q of r.quests) {
        if (q.kind !== 'sudden' || q.state !== 'accepted' || !q.seen?.length) continue;
        if (questState(r, q, view).status !== 'failed') continue;
        const k = [...q.seen].reverse().find(x => view.index.has(x));
        add(fails, k, q);
    }
    // 2-D: spectator sponsorships tied to a reply
    const tips = new Map();
    for (const c of r.cheers || []) if (c.pts && c.key) add(tips, c.key, c);
    return { clears, lives, uses, fails, unlocks, tips, quests: new Map(r.quests.map(q => [q.id, q])) };
}

function cardFor(r, m, key, i, idx, view) {
    if (!r) return '';
    if (isAI(m)) {
        const list = (idx.clears.get(key) || []).map(e => ({ e, q: idx.quests.get(e.questId) })).filter(o => o.q);
        const l = idx.lives.get(key);
        const life = l ? Object.keys(l.life || {}).filter(k => ['time', 'weather', 'place', 'date'].includes(k)) : [];
        const fails = idx.fails.get(key) || [];
        const unl = idx.unlocks.get(key) || [];
        const tips = (idx.tips.get(key) || []).filter(c => c.pts);
        if (!list.length && !life.length && !fails.length && !unl.length && !tips.length) return '';
        const lines = list.map(({ q, e }) => {
            const conds = condsOf(q);
            const st = questState(r, q, view);
            const name = conds && e.cond != null ? `${q.name} · ${conds[e.cond]}` : q.name;
            const tag = st.status === 'done' ? '<span class="sblink-code sblink-clear">CLEAR</span>'
                : `<span class="sblink-code">${(st.condDone || []).filter(Boolean).length} / ${conds?.length || 1}</span>`;
            return `<div class="sblink-cardline"><span class="sblink-dia">◆</span>${tag}<span class="sblink-ell">${esc(name)}</span>${e.pts && st.status === 'done' ? `<b class="sblink-pts">+${e.pts}P</b>` : ''}</div>`;
        });
        for (const q of fails) {
            const pts = penaltyFor(q);
            const w = warnFor(q);
            lines.push(`<div class="sblink-cardline sblink-cardfail"><span class="sblink-dia">◆</span><span class="sblink-code sblink-failtag">FAILED</span><span class="sblink-ell">${esc(q.name)}</span>${pts ? `<b class="sblink-pts sblink-neg">−${pts}P</b>` : ''}${w ? `<b class="sblink-pts sblink-neg">${esc(t('warn_plus'))}</b>` : ''}</div>`);
        }
        for (const c of tips) lines.push(`<div class="sblink-cardline sblink-cardtip"><span class="sblink-dia">✦</span><span class="sblink-code">SPONSOR</span><span class="sblink-ell">${esc(t('card_tip', { name: c.name }))}</span><b class="sblink-pts sblink-goldtxt">+${c.pts}P</b></div>`);
        for (const k of unl) lines.push(`<div class="sblink-cardline sblink-cardunlock"><span class="sblink-dia">✦</span><span class="sblink-code sblink-goldtxt">UNLOCK</span><span class="sblink-ell">${esc(t('card_unlock', { name: k.name }))}</span></div>`);
        if (life.length) {
            const bits = life.map(k => `${esc(t(`life_${k}`))} ${l.lifeFrom?.[k] ? `${esc(l.lifeFrom[k])} ▸ ` : ''}${esc(l.life[k])}`).join(' · ');
            lines.push(`<div class="sblink-cardline sblink-cardlife"><span class="sblink-dia">◇</span><span class="sblink-ell">${bits}</span></div>`);
        }
        return `<div class="sblink-cardhead"><span class="sblink-code">SYS.LOG // #${i}</span><span class="sblink-sp"></span><span class="sblink-open">${esc(t('open'))} ▸</span></div>${lines.join('')}|quests`;
    }
    if (m?.is_user) {
        const us = idx.uses.get(key) || [];
        if (!us.length) return '';
        const sk = us.filter(u => u.kind === 'skill');
        const it = us.filter(u => u.kind !== 'skill');
        const head = sk.length && it.length ? 'ITEM · SKILL' : sk.length ? 'SKILL' : 'ITEM';
        const lines = [...it.map(u => `<div class="sblink-cardline">${icon(u.icon)}<span class="sblink-ell">${esc(t('used_x', { name: u.name }))}</span><b class="sblink-rar ${RARITY_CLASS[u.rarity] || ''}">${esc(t(`rarity_${u.rarity}`))}</b></div>`),
            ...sk.map(u => `<div class="sblink-cardline">${gradeBadge(u.grade)}<span class="sblink-ell">${esc(t('used_skill_x', { name: u.name }))}</span></div>`)];
        return `<div class="sblink-cardhead"><span class="sblink-code">SYS.LOG // ${head}</span></div>${lines.join('')}|${it.length ? 'bag' : 'status'}`;
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
    const idx = show ? indexRecords(r, view) : null;
    const tc = toneClass();
    const blocks = active(r);
    chatEl.querySelectorAll('.mes[mesid]').forEach(mes => {
        const i = Number(mes.getAttribute('mesid'));
        const m = view.list[i];
        const key = view.keys[i];
        // 0.6.0: [SYS:QUEST] lines in AI replies drawn as small System windows (screen only)
        const mt = mes.querySelector('.mes_text');
        if (mt) {
            if (blocks && m && isAI(m)) { try { drawQuestBlocks(mt, key); } catch (e) { console.warn('[System Blink] quest lines', e); } } else undrawQuestBlocks(mt);
        }
        let html = show && m ? cardFor(r, m, key, i, idx, view) : '';
        let tab = '';
        if (html) { const cut = html.lastIndexOf('|'); tab = html.slice(cut + 1); html = html.slice(0, cut); }
        const sig = html ? `${key}|${html.length}|${hashStr(html)}` : '';
        let card = mes.querySelector(':scope .sblink-card');
        if (!sig) { card?.remove(); return; }
        if (card && card.dataset.sig === sig && card.classList.contains(tc)) return;
        if (!card) {
            card = document.createElement('div');
            card.addEventListener('click', () => hooks.openTab(card.dataset.tab || 'quests'));
            const block = mes.querySelector('.mes_block') || mes;
            const text = block.querySelector(':scope > .mes_text') || block.querySelector('.mes_text');
            if (text && text.parentElement) text.parentElement.insertBefore(card, text.nextSibling);
            else block.appendChild(card);
        }
        card.dataset.sig = sig;
        card.dataset.tab = tab;
        card.className = `sblink-card sblink-holo ${tc}${m?.is_user ? ' sblink-card-mine' : ''}`;
        card.innerHTML = html;
    });
}

export function removeCards() { document.querySelectorAll('.sblink-card').forEach(el => el.remove()); undrawQuestBlocks(); }

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// popup builders used by index.js
const WARN = { normal: 'warn_normal', hard: 'warn_hard', hell: 'warn_hell' };

/** A reward as the voice says it: "+10P", or "Sponsor 10P" in the sponsor voice. */
export const ptsText = (pts) => (active() && toneOf() === 'star' ? t('pts_star', { pts }) : `+${pts}P`);

/** ◆◆◇ warnings now, out of 3 (threat voice). */
export const warnDias = (n) => `<span class="sblink-wdia">${Array.from({ length: WARN_MAX }, (_, i) => `<i class="${i < n ? 'sblink-on' : ''}"></i>`).join('')}</span>`;
export const warnMeter = () => { const n = Math.min(WARN_MAX, warnCount()); return `<div class="sblink-warnmeter">${warnDias(n)}<span>${esc(t('warn_meter', { n }))}</span></div>`; };

const TONE_DAILY = {
    game: { tag: 'QUEST', code: 'SYS.NOTICE // DAILY', title: 'pop_daily' },
    star: { tag: 'SCENARIO', code: 'SYS.STAR // DAILY', title: 'pop_daily_star' },
    threat: { tag: 'WARNING', code: 'SYS.ALERT // SURVIVAL', title: 'pop_daily_threat' },
};

export function questsPopup(list) {
    const diff = list.find(q => !q.penalty)?.diff || 'off';
    const tone = active() ? toneOf() : 'game';
    const v = TONE_DAILY[tone] || TONE_DAILY.game;
    const threatWarn = tone === 'threat' && WARN[diff];
    const p = {
        tag: v.tag, code: v.code, title: t(v.title),
        lines: list.map(q => (q.penalty
            ? `<span class="sblink-dia sblink-neg">◆</span><span class="sblink-code sblink-failtag">PENALTY</span><span class="sblink-ell">${esc(q.name)}</span><b class="sblink-pts sblink-dimpts">${esc(t('no_reward'))}</b>`
            : `<span class="sblink-dia">◆</span><span class="sblink-ell">${esc(q.name)}</span>${q.conds ? `<span class="sblink-code">×${q.conds.length}</span>` : ''}<b class="sblink-pts">${q.pts ? esc(ptsText(q.pts)) : ''}</b>`)),
        warn: threatWarn ? t(`warn_threat_${diff}`) : WARN[diff] ? t(WARN[diff]) : '', calm: WARN[diff] ? '' : t('no_penalty'),
        second: t(tone === 'star' ? 'view_show' : 'view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    };
    if (tone === 'star') p.calm = `${t('star_expect', { name: ((n) => starWho(n[Math.floor(Math.random() * n.length)], lang()))(specNames(lang(), 'star')) })}${p.calm ? ` · ${p.calm}` : ''}`;
    // the threat voice: only [OK], and the warnings so far
    if (tone === 'threat') { delete p.second; if (threatWarn) p.body = warnMeter(); }
    popup(p);
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
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(q.name)}</span><b class="sblink-pts">${esc(ptsText(pts))}</b>`,
            `<span class="sblink-code">${esc(t('limit_replies', { n: q.limit }))}</span>${diamonds(q.limit, q.limit)}`],
        ...(penaltyFor(q) ? { warn: t('penalty_line', { pts: penaltyFor(q) }) } : warnFor(q) ? { warn: t('warn_line'), body: warnMeter() } : { calm: t('decline_ok') }),
        second: t('decline'), ok: t('accept'),
        onClose: (act) => answer(act === 'ok'),
    });
}

/** ㉓ Quests failed with a penalty (from Normal up): points, a debuff and its penalty quest, a lost item. */
export function failPopup({ items = [], debuff = null, lost = null }) {
    const lines = items.map(x => `<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(x.name)}</span>${x.pts ? `<b class="sblink-pts sblink-neg">−${x.pts}P</b>` : ''}${x.warn ? `<b class="sblink-pts sblink-neg">${esc(t('warn_plus'))}</b>` : ''}`);
    const warned = items.some(x => x.warn);
    let body = warned ? warnMeter() : '';
    if (debuff) {
        body += `<div class="sblink-failrow"><span class="sblink-code sblink-failtag">DEBUFF</span><b>${esc(t('debuff_pricey'))}</b><span class="sblink-dimtxt">· ${esc(t('until_next_day'))}</span></div>
          <div class="sblink-failrow"><span class="sblink-code sblink-failtag">PENALTY QUEST</span><span>${esc(t('penalty_quest_line'))}</span></div>`;
    }
    if (lost) body += `<div class="sblink-failrow"><span class="sblink-code sblink-failtag">LOST</span><span>${esc(t('lost_item', { name: lost.name }))}</span></div>`;
    popup({
        variant: 'fail', tag: 'FAILED', code: 'SYS.NOTICE // PENALTY', title: t('pop_failed'),
        sub: esc(t(`fail_sub_${active() ? toneOf() : 'game'}`)),
        lines, body, calm: items.some(x => x.pts) ? t('floor_zero') : '', second: t('view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    });
}

/** ㉑ A hidden quest was found. */
export function hiddenPopup(q, pts) {
    popup({
        variant: 'hidden', tag: 'HIDDEN', code: 'SYS.NOTICE // HIDDEN', title: t('pop_hidden'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext" data-decode="${esc(q.name)}"></span><b class="sblink-pts">${esc(ptsText(pts))}</b>`],
        body: `${q.why ? `<div><span class="sblink-code">${esc(t('found_why'))}</span> · ${esc(q.why)}</div>` : ''}<div>${esc(t('hidden_free'))}</div>`,
        second: t('view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    });
}

/** A stage of the main goal was cleared. */
export function stagePopup(q, pts) {
    popup({
        tag: 'CLEAR', code: 'SYS.GOAL // MAIN', title: t('pop_stage'),
        lines: [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(q.name)}</span><b class="sblink-pts">${esc(ptsText(pts))}</b>`],
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

/** 0.6.2: the System set the main goal by itself. */
export function goalGivenPopup(g, stage, pts) {
    const lines = [`<span class="sblink-dia">◆</span><span class="sblink-qtext">${esc(g.title)}</span>`];
    if (stage) lines.push(`<span class="sblink-code">${esc(t('stage_now'))} ▸</span><span class="sblink-qtext">${esc(stage.name)}</span><b class="sblink-pts">${esc(ptsText(pts))}</b>`);
    popup({
        tag: 'MAIN', code: 'SYS.GOAL // MAIN', title: t('pop_goal_given'),
        lines, body: esc(t('goal_given_body')),
        second: t('view_quests'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openTab('quests'); },
    });
}

export function todayCount(r = room()) { return todays(r).length; }

/** Threat voice: three warnings set off a big event in the story. */
export function bigPopup() {
    popup({
        variant: 'big', tag: 'WARNING', code: 'SYS.ALERT // EVENT', title: t('pop_big'), shake: true,
        body: `<div class="sblink-bigdias">${warnDias(WARN_MAX)}</div><div class="sblink-centertxt">${esc(t('big_body'))}</div>`,
    });
}

// ---------- 2-C: skills ----------
const FROM_TITLE = { book: 'pop_skill_book', goal: 'pop_skill_goal', hidden: 'pop_skill_hidden', spectator: 'pop_skill_spectator' };

/** A skill was gained (skill book, main goal, hidden quest). */
export function skillPopup(k, from) {
    popup({
        variant: 'skill', tag: 'SKILL', code: 'SYS.SKILL // GAINED', title: t((k.star && 'pop_skill_star') || FROM_TITLE[from] || 'pop_skill_got'),
        flash: isTop(k.grade) ? (k.grade === 'SS' ? 'ss' : 's') : '',
        lines: [`${gradeBadge(k.grade)}<span class="sblink-qtext">[${esc(k.name)}]</span>${tag(t(`skill_${k.type}`), 'sblink-stag-acc')}`],
        body: esc(k.effect), second: t('skill_view'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openSkill(k.id); },
    });
}

/** ㉘-B The hidden effect of a low-grade skill opened: a gold flash, the badge cracks in two, ✦ and rays, the text decodes. */
export function unlockPopup(k) {
    const stage = `<div class="sblink-unlockstage" aria-hidden="true">
        <span class="sblink-rays"></span>
        <span class="sblink-half sblink-half-l">${gradeBadge(k.grade, true)}</span>
        <span class="sblink-half sblink-half-r">${gradeBadge(k.grade, true)}</span>
        <svg class="sblink-crack" viewBox="0 0 64 74"><path d="M32 4 L28 22 L36 34 L29 50 L33 70"/></svg>
        <span class="sblink-star"><b>✦</b><i>${esc(k.grade)} · ${esc(t('unlock_open'))}</i></span>
      </div>`;
    popup({
        variant: 'unlock', tag: 'UNLOCK', code: 'SYS.SKILL // HIDDEN · UNLOCKED', title: t('pop_unlock'), flash: 'gold', dust: true,
        sub: esc(t('unlock_sub', { name: k.name })), stage,
        body: `<div class="sblink-fxrow"><span class="sblink-dimtxt">${esc(t('unlock_base'))} · </span>${esc(k.effect)}</div>
          <div class="sblink-fxrow sblink-fxrow-gold"><b>${esc(t('skill_hidden'))} · </b><span data-decode="${esc(k.hidden?.effect || '')}"></span></div>
          <div class="sblink-dimtxt sblink-centertxt">${esc(t('unlock_note', { g: k.grade }))}</div>`,
        second: t('skill_view'), ok: t('ok'),
        onClose: (act) => { if (act === 'second') hooks.openSkill(k.id); },
    });
}

/**
 * ㉕ Open a gacha ticket. The seal shakes while the draw is made, then the grade's light, then the result.
 * S and SS flash the whole screen once. Returns { reveal(result) }.
 */
export function gachaShow(go = {}) {
    $id('sblink-gacha')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'sblink-gacha';
    wrap.className = `sblink-popwrap sblink-gachawrap ${toneClass()}${motionOn() ? ' sblink-moving' : ''}`;
    const steps = (n) => [t('gacha_seal'), t('gacha_light'), t('gacha_reveal')].map((x, i) => `<span class="${i === n ? 'sblink-on' : ''}">${esc(x)}</span>`).join('<span>▸</span>');
    wrap.innerHTML = `<div class="sblink-flash"></div>
      <div class="sblink-pop sblink-holo sblink-gacha sblink-gacha-seal" role="alertdialog" aria-modal="true">
        <i class="sblink-cn sblink-cn-tl"></i><i class="sblink-cn sblink-cn-tr"></i><i class="sblink-cn sblink-cn-bl"></i><i class="sblink-cn sblink-cn-br"></i>
        <div class="sblink-tag">GACHA</div>
        <div class="sblink-pophead"><span class="sblink-code">SYS.GACHA // TICKET</span></div>
        <div class="sblink-stripes"></div>
        <div class="sblink-poptitle"><span class="sblink-typed">${esc(t('gacha_opening'))}</span><span class="sblink-cursor">▌</span></div>
        <div class="sblink-gsteps sblink-code">${steps(0)}</div>
        <div class="sblink-gstage"><span class="sblink-seal">${icon('ticket')}</span></div>
        <div class="sblink-popbtns"></div>
      </div>`;
    document.body.appendChild(wrap);
    fitPop(wrap);
    hooks.badge();
    const box = wrap.querySelector('.sblink-gacha');
    const started = Date.now();
    const close = () => { wrap.remove(); hooks.badge(); };
    const reveal = (res) => {
        if (!wrap.isConnected) return;
        if (!res) { close(); notice(t('gacha_failed'), 'warn'); return; }
        const isSkill = res.kind === 'skill';
        const k = res.skill, it = res.item;
        const g = isSkill ? k.grade : '';
        const colour = isSkill ? gradeClass(g) : `sblink-r-${it.rarity}`;
        const wait = motionOn() ? Math.max(0, 1100 - (Date.now() - started)) : 0;
        setTimeout(() => {
            if (!wrap.isConnected) return;
            box.classList.remove('sblink-gacha-seal');
            box.classList.add('sblink-gacha-light', colour);
            wrap.querySelector('.sblink-gsteps').innerHTML = steps(1);
            setTimeout(() => {
                if (!wrap.isConnected) return;
                box.classList.remove('sblink-gacha-light');
                box.classList.add('sblink-gacha-open');
                if (isSkill && isTop(g)) wrap.querySelector('.sblink-flash').className = `sblink-flash sblink-flash-${g === 'SS' ? 'ss' : 's'}`;
                wrap.querySelector('.sblink-gsteps').innerHTML = steps(2);
                typeIn(wrap.querySelector('.sblink-typed'), t('gacha_result'));
                wrap.querySelector('.sblink-gstage').innerHTML = isSkill
                    ? `${gradeBadge(g, true)}<span class="sblink-gkind">SKILL · ${esc(t(`skill_${k.type}`))} · ${esc(g)}</span>
                       <span class="sblink-gname">「${esc(k.name)}」</span><span class="sblink-gdesc">${esc(k.effect)}</span>${k.hidden ? `<span class="sblink-gq">${esc(t('gacha_hidden_hint'))}</span>` : ''}`
                    : `<span class="sblink-gitem ${colour}">${icon(it.icon)}</span><span class="sblink-gkind">ITEM · ${esc(t(`rarity_${it.rarity}`))}</span>
                       <span class="sblink-gname">「${esc(it.name)}」</span><span class="sblink-gdesc">${esc(it.desc)}</span>`;
                wrap.querySelector('.sblink-popbtns').innerHTML = `<button type="button" class="sblink-btn" data-g="go"><span class="sblink-ell">${esc(isSkill ? t('skill_view') : t('bag_view'))}</span></button>
                    <button type="button" class="sblink-btn sblink-btn-main" data-g="ok"><span class="sblink-ell">${esc(t('ok'))}</span></button>`;
                setTimeout(() => wrap.querySelector('[data-g="ok"]')?.focus({ preventScroll: true }), 50);
            }, motionOn() ? 650 : 0);
        }, wait);
    };
    wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-g]');
        if (!b) return;
        close();
        if (b.dataset.g === 'go') { if (go.res?.kind === 'skill') go.skill?.(go.res.skill.id); else go.bag?.(); }
    });
    return { reveal: (res) => { go.res = res; reveal(res); }, close };
}
