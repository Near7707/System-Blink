// System Blink — a game-like "System" for SillyTavern roleplay: popups, daily quests, a personal shop, a bag.
// Uses only SillyTavern's public paths (getContext, events, extension prompts). It never writes to
// character cards, chat files or chat metadata, and never changes message text; everything lives in
// extension settings (and the floating button's place in this device's localStorage).

import { t, setLanguage, lang } from './src/i18n.js';
import { ctx, settings, save, uiLang, room, currentChatId, onChatRenamed, onChatDeleted, copyFromParent, VERSION } from './src/store.js';
import { bus, storeCheck, bindUses, markDelivered, active, checkRealDay, setLangGetter, skipTutorial, rate, lastReply, chatView, nextStage, tidy, answerSudden, penaltyFor, rewardSkill, warnFor, checkBig, spectate, toneOf } from './src/engine.js';
import { runCheck } from './src/ai.js';
import { buildPrompt } from './src/prompt.js';
import { panelHtml, panelChange, runButton, setPrefsHooks } from './src/prefs.js';
import { hexMark } from './src/icons.js';
import { openWindow, closeWindow, isOpen, refreshWin, place as placeWin, setWinHooks } from './src/ui/win.js';
import { mountFab, unmountFab, setFabHidden, setFabCount, setFabHooks, place as placeFab, endDrag } from './src/ui/fab.js';
import {
    popup, notice, hold, waiting, setPopHooks, renderStrip, placeStrip, foldStrip, stripShown, renderCards, renderCardsSoon,
    removeCards, clearPopups, questsPopup, suddenPopup, hiddenPopup, stagePopup, goalDonePopup, failPopup, skillPopup, unlockPopup, bigPopup,
} from './src/ui/pop.js';
import { esc } from './src/ui/util.js';

export { VERSION };
const PROMPT_KEY = 'system_blink';
let lastPrompt = '';
let sentNoteIds = [];
let generating = false;

// ---------- the lines for the AI ----------
function updatePrompt(genType = 'normal', live = false) {
    let text = '';
    let ids = [];
    try { ({ text, noteIds: ids } = buildPrompt(genType)); } catch (e) { console.error('[System Blink] prompt', e); }
    if (live) { sentNoteIds = ids; lastPrompt = text; }
    try { ctx().setExtensionPrompt(PROMPT_KEY, text, 1, 1, false, 0); } catch (e) { console.error('[System Blink] prompt', e); }
}

// ---------- redraw ----------
let redrawTimer = 0;
function redrawSoon() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => { try { redraw(); } catch (e) { console.error('[System Blink]', e); } }, 50);
}
function redraw() {
    try { tidy(); } catch (e) { console.error('[System Blink]', e); }
    refreshWin();
    renderStrip();
    renderCards();
    badge();
    mountWand();
    if (!generating) updatePrompt();
}

function badge() {
    setFabCount(waiting() + (stripShown() ? 1 : 0));
    // the floating button wears this chat's voice too
    const fab = document.getElementById('sblink-fab');
    if (fab) { const tone = active() ? toneOf() : 'game'; for (const x of ['game', 'star', 'threat']) fab.classList.toggle(`sblink-tn-${x}`, x === tone); }
}

function redrawAll() {
    setLanguage(lang());
    mountPanel();
    mountWand();
    if (settings().enabled) mountFab(); else unmountFab();
    redraw();
}

function turnedOff() {
    closeWindow(); clearPopups(); unmountFab(); removeCards();
    document.getElementById('sblink-strip')?.remove();
    try { ctx().setExtensionPrompt(PROMPT_KEY, '', 1, 1, false, 0); } catch { /* ignore */ }
    mountPanel(); mountWand();
}

// ---------- the check after an AI reply ----------
let checkTimer = 0;
function checkSoon(force = false) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
        if (generating) return;
        const chatId = currentChatId();
        let res = null;
        try { res = await runCheck({ force }); } catch (e) { console.error('[System Blink] check', e); }
        if (!res || currentChatId() !== chatId) {
            redrawSoon();
            // no check this time: the spectators may still react to the reply
            if (currentChatId() === chatId && !force) cheer(chatId, lastReply()?.key, 'reply');
            return;
        }
        const out = storeCheck(chatId, res.key, res);
        afterCheck(out, chatId);
        redraw();
        cheer(chatId, res.key, out.cleared.length ? 'clear' : out.failed.length ? 'fail' : 'reply');
    }, force ? 0 : 700);
}

/** 2-D: a spectator may react (a small notice; a sponsorship is gold). */
async function cheer(chatId, key, ev) {
    if (!key && ev !== 'fail') return;
    let c = null;
    try { c = await spectate(chatId, key, ev); } catch (e) { console.warn('[System Blink] spectator', e); }
    if (!c || currentChatId() !== chatId || generating) return;
    if (c.pts) notice(c.text, 'gold', `+${c.pts}P`);
    else notice(c.text, 'spec');
}

const clearedNotice = (c) => notice(c.q.kind === 'penalty' ? t('toast_lifted', { name: c.q.name }) : t('toast_cleared', { pts: c.pts, name: c.q.name }));

function answered(id, yes) {
    const pts = answerSudden(id, yes);
    if (yes) { notice(t('toast_accepted')); return; }
    const q = room()?.quests.find(x => x.id === id);
    if (pts) notice(t('toast_declined', { pts }), 'warn');
    else if (warnFor(q)) { notice(t('toast_declined_warn'), 'warn'); checkBig(); }
}

/** What a story check found, shown to me. */
function afterCheck(out, chatId) {
    for (const c of out.cleared) if (c.q.kind !== 'goal') clearedNotice(c);
    for (const c of out.cleared) if (c.q.kind === 'hidden') rewardSkill(chatId, 'hidden', c.q);
    for (const sk of out.unlocked || []) unlockPopup(sk);
    for (const q of out.failed) {
        const pts = penaltyFor(q);
        const warn = warnFor(q);
        // Off / Easy: a small notice; from Normal up the failure costs points (or a warning in the threat voice) and gets the big popup
        if (pts || warn) failPopup({ items: [{ name: q.name, pts, warn, kind: 'sudden' }] });
        else notice(t('toast_sudden_failed', { name: q.name }), 'warn');
    }
    if (out.failed.some(q => warnFor(q))) checkBig(chatId);
    for (const q of out.stages) { stagePopup(q, rate(q.reward)); nextStage(chatId); }
    if (out.hidden) hiddenPopup(out.hidden, rate(out.hidden.reward));
    if (out.sudden) suddenPopup(out.sudden, rate(out.sudden.reward), (yes) => answered(out.sudden.id, yes));
}

// ---------- bus: things the rules tell the screen ----------
function wireBus() {
    bus.on('change', redrawSoon);
    bus.on('checkNow', () => checkSoon(true));
    bus.on('checkFailed', () => notice(t('check_failed'), 'warn'));
    bus.on('cleared', (list) => { for (const c of list) { if (c.q.kind !== 'goal') clearedNotice(c); if (c.q.kind === 'hidden') rewardSkill(currentChatId(), 'hidden', c.q); } });
    bus.on('skillGained', ({ skill, from }) => skillPopup(skill, from));
    bus.on('stageCleared', (q) => { stagePopup(q, rate(q.reward)); nextStage(); });
    bus.on('stageArrived', (q) => notice(t('toast_stage_new', { name: q.name })));
    bus.on('goalDone', (g) => goalDonePopup(g));
    bus.on('questsArrived', (list) => questsPopup(list.map(q => ({ name: q.name, pts: q.kind === 'penalty' ? 0 : rate(q.reward), penalty: q.kind === 'penalty', conds: q.conds || null, diff: q.diff }))));
    bus.on('sudden', ({ id, yes }) => answered(id, yes));
    bus.on('dayMoved', ({ days, failed, pen = [], debuff, lost, chatId }) => {
        notice(days === 1 ? t('toast_day') : t('toast_days', { n: days }));
        if (pen.length || debuff || lost) failPopup({ items: pen.map(x => ({ name: x.q.name, pts: x.pts, warn: x.warn, kind: 'daily' })), debuff, lost });
        else if (failed.length) notice(t('toast_failed', { n: failed.length }), 'warn');
        if (failed.length) cheer(chatId || currentChatId(), null, 'fail');
    });
    bus.on('bigEvent', () => bigPopup());
    bus.on('awaken', () => {
        popup({
            kind: 'awaken', code: 'SYS.NOTICE // AWAKEN', title: t('pop_awaken'),
            lines: [esc(t('pop_awaken_2')), esc(t('pop_awaken_3'))],
            body: `<div class="sblink-tutsteps">${[0, 1, 2, 3].map(i => `<div class="sblink-tutstep${i === 0 ? ' sblink-now' : ''}"><span class="sblink-dia">◆</span><span class="sblink-ell">${esc(t(`tut_${i}`))}</span>${i === 0 ? '<span class="sblink-code">NOW</span>' : ''}</div>`).join('')}</div>
                   <div class="sblink-goldline">${esc(t('tut_reward'))}</div>`,
            second: t('skip'), ok: t('start'),
            onClose: (act) => { if (act === 'second') skipTutorial(); else openWindow('quests'); },
        });
    });
    bus.on('tutorialStep', () => redrawSoon());
    bus.on('tutorialDone', () => popup({ tag: 'CLEAR', code: 'SYS.NOTICE // TUTORIAL', title: t('pop_tut_done'), lines: [`<span class="sblink-dia">◆</span><span class="sblink-ell">${esc(t('tut_reward'))}</span>`] }));
}

// ---------- settings panel & wand ----------
function mountPanel() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    let panel = document.getElementById('sblink_settings');
    const wasOpen = panel?.querySelector('.inline-drawer-content')?.style.display === 'block';
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'sblink_settings';
        panel.className = 'sblink-panel';
        host.appendChild(panel);
        panel.addEventListener('click', (e) => {
            if (e.target.closest('[data-sblink-open]')) return openWindow();
            const b = e.target.closest('[data-run]');
            if (b && !b.disabled) runButton(b.dataset.run);
        });
        panel.addEventListener('change', panelChange);
    }
    panel.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>${esc(t('ext_name'))}</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <button type="button" class="menu_button sblink-pbtn" data-sblink-open>${esc(t('open_window'))}</button>
          ${panelHtml()}
        </div>
      </div>`;
    if (wasOpen) {
        panel.querySelector('.inline-drawer-content').style.display = 'block';
        panel.querySelector('.inline-drawer-icon')?.classList.replace('down', 'up');
    }
}

function mountWand() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    let item = document.getElementById('sblink_wand');
    if (!item) {
        item = document.createElement('div');
        item.id = 'sblink_wand';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = `<div class="extensionsMenuExtensionButton sblink-wandico">${hexMark()}</div><span class="sblink-wandname">System Blink</span><span class="sblink-wandstate"></span>`;
        item.addEventListener('click', () => { if (isOpen()) closeWindow(); else openWindow(); });
        menu.appendChild(item);
    }
    const st = item.querySelector('.sblink-wandstate');
    const on = settings().enabled;
    const txt = on ? t('state_on') : t('state_off');
    if (st.textContent !== txt) st.textContent = txt;
    st.classList.toggle('sblink-wandoff', !on);
    return true;
}

// ---------- events ----------
function registerEvents() {
    const { eventSource } = ctx();
    const ev = ctx().eventTypes || ctx().event_types;
    // while switched off nothing runs, except keeping saved data with renamed / deleted chats
    const on = (name, fn, always = false) => { if (name) eventSource.on(name, (...a) => { try { if (always || settings().enabled) return fn(...a); } catch (e) { console.error('[System Blink]', e); } }); };

    on(ev.CHAT_CHANGED, () => { copyFromParent(); if (!settings().enabled) return; generating = false; hold(false); checkRealDay(); redrawSoon(); }, true);
    for (const name of [ev.MESSAGE_DELETED, ev.MESSAGE_SWIPED, ev.MESSAGE_EDITED, ev.MESSAGE_UPDATED,
        ev.USER_MESSAGE_RENDERED, ev.CHARACTER_MESSAGE_RENDERED, ev.MORE_MESSAGES_LOADED, ev.CHAT_LOADED]) {
        on(name, () => { renderCardsSoon(); redrawSoon(); });
    }
    on(ev.MESSAGE_SENT, () => { bindUses(); foldStrip(); redrawSoon(); });
    on(ev.GENERATION_STARTED, (type, _opts, dryRun) => {
        const kind = String(type || 'normal');
        if (!dryRun && kind !== 'quiet') { generating = true; hold(true); }
        updatePrompt(kind, !dryRun && kind !== 'quiet');
    });
    on(ev.MESSAGE_RECEIVED, (mesId) => {
        const view = chatView();
        const m = view.list[Number(mesId)];
        if (m && !m.is_user && sentNoteIds.length) { markDelivered(view.keys[Number(mesId)], sentNoteIds); sentNoteIds = []; }
    });
    for (const name of [ev.GENERATION_ENDED, ev.GENERATION_STOPPED]) {
        on(name, () => {
            if (!generating) return;
            generating = false;
            hold(false);
            redrawSoon();
            if (active() && lastReply()) checkSoon();
        });
    }
    on(ev.CHAT_RENAMED, (data) => { onChatRenamed(data?.oldFileName, data?.newFileName); redrawSoon(); }, true);
    on(ev.CHAT_DELETED, (name) => onChatDeleted(name), true);
    on(ev.GROUP_CHAT_DELETED, (name) => onChatDeleted(name), true);
    on(ev.APP_READY, () => { mountWand(); if (!settings().enabled) return; mountFab(); checkRealDay(); redraw(); }, true);
}

function watchScreen() {
    let tm = 0;
    const re = () => { cancelAnimationFrame(tm); tm = requestAnimationFrame(() => { placeWin(); placeFab(); placeStrip(); }); };
    window.addEventListener('resize', re);
    window.addEventListener('orientationchange', () => setTimeout(re, 250));
    window.visualViewport?.addEventListener('resize', re);
    window.visualViewport?.addEventListener('scroll', re);
    document.addEventListener('focusin', () => setTimeout(re, 350));
    document.addEventListener('focusout', () => setTimeout(re, 450));
    // always let go of a drag
    window.addEventListener('blur', endDrag);
    window.addEventListener('pagehide', endDrag);
    document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(); });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) closeWindow();
    });
    // SillyTavern redraws messages (swipe, edit, load more): put the cards back
    const chatEl = document.getElementById('chat');
    if (chatEl && 'MutationObserver' in window) {
        new MutationObserver(() => { if (settings().enabled && settings().logCards) renderCardsSoon(); }).observe(chatEl, { childList: true });
    }
}

async function init() {
    settings();
    setLanguage(uiLang());
    setLangGetter(lang);
    wireBus();
    setPrefsHooks({ redrawAll, turnedOff, turnedOn: redrawAll, lastPrompt: () => lastPrompt, langNow: uiLang, showText: showText });
    setWinHooks({ opened: () => { setFabHidden(true); renderStrip(); }, closed: () => { setFabHidden(false); renderStrip(); badge(); } });
    setFabHooks({ open: () => openWindow() });
    setPopHooks({ openTab: (tab) => openWindow(tab), openSkill: (id) => openWindow('status', { skill: id }), badge });
    mountPanel();
    if (!mountWand()) { let n = 0; const w = setInterval(() => { if (mountWand() || ++n > 30) clearInterval(w); }, 1000); }
    if (settings().enabled) mountFab();
    registerEvents();
    watchScreen();
    redraw();
}

async function showText(text) {
    const c = ctx();
    const html = `<pre class="sblink-pre">${esc(text)}</pre>`;
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) return c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', { wide: true, large: true });
    window.alert(text);
}

if (globalThis.jQuery) globalThis.jQuery(() => { init().catch(e => console.error('[System Blink] init', e)); });
else init().catch(e => console.error('[System Blink] init', e));
