// System Blink — a game-like "System" for SillyTavern roleplay: popups, daily quests, a personal shop, a bag.
// Uses only SillyTavern's public paths (getContext, events, extension prompts). It never writes to
// character cards, chat files or chat metadata, and never changes message text; everything lives in
// extension settings (and the floating button's place in this device's localStorage).

import { t, setLanguage, lang } from './src/i18n.js';
import { ctx, settings, save, uiLang, room, currentChatId, chatName, onChatRenamed, onChatDeleted, onCharRenamed, copyFromParent, settleRoom, VERSION } from './src/store.js';
import { bus, storeCheck, bindUses, markDelivered, markTold, active, checkRealDay, setLangGetter, skipTutorial, rate, lastReply, chatView, nextStage, tidy, answerSudden, msgKey, penaltyFor, rewardSkill, warnFor, checkBig, spectate, toneOf, wantsWake, declineWake, giveGoal, switchOn, genreOn, veiled } from './src/engine.js';
import { runCheck } from './src/ai.js';
import { buildPrompt } from './src/prompt.js';
import { panelHtml, panelChange, runButton, setPrefsHooks, setScope } from './src/prefs.js';
import { hexMark } from './src/icons.js';
import { openWindow, closeWindow, isOpen, refreshWin, place as placeWin, setWinHooks } from './src/ui/win.js';
import { mountFab, unmountFab, setFabHidden, setFabCount, setFabHooks, syncFabChat, place as placeFab, endDrag } from './src/ui/fab.js';
import {
    popup, notice, hold, waiting, setPopHooks, placePops, renderStrip, placeStrip, foldStrip, stripShown, renderCards, renderCardsSoon, drawQuestLinesNow,
    removeCards, clearPopups, dropPopups, popupWaiting, popupFront, pausePops, placeToasts, questsPopup, suddenPopup, hiddenPopup, stagePopup, goalDonePopup, goalGivenPopup, failPopup, skillPopup, unlockPopup, bigPopup,
} from './src/ui/pop.js';
import { esc, isPhone } from './src/ui/util.js';
import { hasPlainSys } from './src/ui/qblock.js';
import { renderPanel, placePanel, setPanelHidden, setPanelHooks, foldPanel, unmountPanel, endPanelDrag } from './src/ui/panel.js';

export { VERSION };
const PROMPT_KEY = 'system_blink';
const RULES_KEY = 'system_blink_rules'; // 0.7.0: the lines that stay the same, near the top of the prompt (kept by the prompt cache)
let lastPrompt = '';
let sentNoteIds = [];
let sentTellIds = [];
let generating = false;
let checkingKey = null; // 0.7.0: the AI reply being checked now (its CLEAR windows show "checking")

// ---------- the lines for the AI ----------
function updatePrompt(genType = 'normal', live = false) {
    let text = '';
    let rules = '';
    let ids = [];
    let tells = [];
    try { ({ rules = '', text, noteIds: ids, tellIds: tells = [] } = buildPrompt(genType)); } catch (e) { console.error('[System Blink] prompt', e); }
    if (live) { sentNoteIds = ids; sentTellIds = tells; lastPrompt = rules ? `${rules}\n\n${text}` : text; }
    try {
        // 0 = in the prompt (after the story string), 1 = in the chat at depth 1; role 0 = system
        ctx().setExtensionPrompt(RULES_KEY, rules, 0, 0, false, 0);
        ctx().setExtensionPrompt(PROMPT_KEY, text, 1, 1, false, 0);
    } catch (e) { console.error('[System Blink] prompt', e); }
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
    try { renderPanel(); placeToasts(); } catch (e) { console.error('[System Blink] panel', e); }
    badge();
    mountWand();
    if (!generating) updatePrompt();
}

function badge() {
    syncFabChat();
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
    guideBack = -1; pausePops(false);
    closeWindow(); clearPopups(); unmountFab(); removeCards(); unmountPanel();
    document.getElementById('sblink-strip')?.remove();
    try { ctx().setExtensionPrompt(RULES_KEY, '', 0, 0, false, 0); ctx().setExtensionPrompt(PROMPT_KEY, '', 1, 1, false, 0); } catch { /* ignore */ }
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
        checkingKey = lastReply()?.key || null;
        renderCards();
        try { res = await runCheck({ force }); } catch (e) { console.error('[System Blink] check', e); }
        checkingKey = null;
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

// ---------- 0.7.0: genre mode — the story shows it, so the screen says it quietly ----------
/** In genre mode (unless set to the big popups): a small notice whose "See ›" opens the big popup. */
const quietAlerts = () => genreOn() && settings().genreAlert !== 'popup';
function alertOr(text, show, right = '') {
    if (quietAlerts()) notice(text, '', right, show);
    else show();
}
const questLines = (list) => list.map(q => ({ name: q.name, pts: q.kind === 'penalty' ? 0 : rate(q.reward), penalty: q.kind === 'penalty', conds: q.conds || null, diff: q.diff }));
function arrival(list) {
    if (!list.length) return;
    alertOr(t('toast_quests_in', { n: list.length }), () => questsPopup(questLines(list)));
}
function goalAlert(goal, stage) {
    alertOr(t('toast_goal_given', { title: goal.title }), () => goalGivenPopup(goal, stage, stage ? rate(stage.reward) : 0));
}
function stageClearAlert(q) { alertOr(t('toast_stage_clear', { name: q.name }), () => stagePopup(q, rate(q.reward)), `+${rate(q.reward)}P`); }
/** Quests the reply just brought into the story (genre mode): now their notices come. */
function revealed(list) {
    if (!list?.length) return;
    const r = room();
    arrival(list.filter(q => q.kind === 'daily' || q.kind === 'penalty'));
    for (const q of list) {
        if (q.kind === 'goal') {
            if (q.stage === 0 && r?.goal && q.goalId === r.goal.id) goalAlert(r.goal, q);
            else notice(t('toast_stage_new', { name: q.name }));
        }
        if (q.kind === 'hidden') alertOr(t('toast_hidden', { name: q.name }), () => hiddenPopup(q, rate(q.reward)));
    }
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
    for (const q of out.stages) { stageClearAlert(q); nextStage(chatId); }
    // genre mode: a found hidden quest waits for the reply that brings it in
    if (out.hidden && !veiled(room(chatId), out.hidden)) hiddenPopup(out.hidden, rate(out.hidden.reward));
    if (out.sudden) suddenPopup(out.sudden, rate(out.sudden.reward), (yes) => answered(out.sudden.id, yes));
}

// ---------- the awakening ----------
const tutSteps = () => `<div class="sblink-tutsteps">${[0, 1, 2, 3].map(i => `<div class="sblink-tutstep${i === 0 ? ' sblink-now' : ''}"><span class="sblink-dia">◆</span><span class="sblink-ell">${esc(t(`tut_${i}`))}</span>${i === 0 ? '<span class="sblink-code">NOW</span>' : ''}</div>`).join('')}</div>
       <div class="sblink-goldline">${esc(t('tut_reward'))}</div>`;

/** Woken by hand: the System is already awake; start or skip the tutorial. */
function awakenPopup() {
    const chatId = currentChatId();
    popup({
        kind: 'awaken', code: 'SYS.NOTICE // AWAKEN', title: t('pop_awaken'),
        lines: [esc(t('pop_awaken_2')), esc(t('pop_awaken_3'))],
        body: tutSteps(), top: t('wake_story'), second: t('skip'), ok: t('start'),
        onClose: (act) => {
            if (act === 'second') skipTutorial();
            else if (act === 'top') storyStart(chatId);
            else if (!genreOn()) openWindow('quests'); // genre mode: the story shows the System first
        },
    });
}

/**
 * 0.7.0 [Begin as a story]: the AI writes the scene where the System appears right away, without a message of
 * mine (like sending an empty message: one story reply). Whatever I had typed stays in the box.
 */
async function storyStart(chatId) {
    if (currentChatId() !== chatId || generating || !room(chatId)?.on) return;
    const c = ctx();
    const ta = document.getElementById('send_textarea');
    const keep = ta?.value || '';
    try {
        if (typeof c.generate === 'function') await c.generate('normal', { automatic_trigger: true });
        else if (typeof c.executeSlashCommandsWithOptions === 'function') await c.executeSlashCommandsWithOptions('/trigger');
    } catch (e) { console.warn('[System Blink] story start', e); }
    finally {
        if (keep && ta && !ta.value) { ta.value = keep; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }
}

/**
 * 0.6.4: a new chat with a character woken before. Nothing happens (no quests, no AI) until I answer:
 * start / skip the tutorial (or just wake, when the tutorial is off), or "don't wake this chat".
 */
function askWake(chatId) {
    const mine = (p) => p.wakeFor === chatId;
    if (popupWaiting(mine)) return;
    const tut = settings().tutorialAuto;
    const answer = async (act) => {
        if (currentChatId() !== chatId || !settings().enabled || room(chatId)?.on) return;
        if (act === 'link') { declineWake(chatId); mountPanel(); return; }
        if (!tut) { await switchOn('skip'); mountPanel(); if (act === 'top') storyStart(chatId); return; }
        await switchOn(act === 'second' ? 'skip' : 'start');
        mountPanel();
        if (act === 'top') storyStart(chatId);
        else if (act !== 'second' && !genreOn()) openWindow('quests'); // genre mode: the story shows the System first
    };
    // 0.7.0: someone new gets the settings guide first, then this question (then the tutorial)
    const s = settings();
    if (!s.guideSeen) { s.guideSeen = true; save(); guideHi(); }
    popup(tut ? {
        kind: 'awaken', code: 'SYS.NOTICE // AWAKEN', title: t('pop_awaken_ask'), wakeFor: chatId,
        lines: [esc(t('pop_awaken_2')), esc(t('pop_awaken_3'))],
        body: tutSteps(), top: t('wake_story'), second: t('skip'), ok: t('start'), link: t('wake_decline'), onClose: answer,
    } : {
        kind: 'awaken', code: 'SYS.NOTICE // AWAKEN', title: t('pop_wake_q'), wakeFor: chatId,
        lines: [esc(t('wake_q_body'))], top: t('wake_story'), ok: t('room_on'), link: t('wake_decline'), onClose: answer,
    });
}

// ---------- 0.6.5: "first time here?" — a short settings guide, once, before the first wake's popups ----------
const GUIDE = [
    { title: 'guide_1', body: 'guide_1_body', group: 'system', tones: true },
    { title: 'guide_world', body: 'guide_world_body', group: 'room' },
    { title: 'guide_genre', body: 'guide_genre_body', group: 'genre' },
    { title: 'guide_2', body: 'guide_2_body', group: 'spectators' },
    { title: 'guide_3', body: 'guide_3_body', group: 'button' },
    { title: 'guide_4', body: 'guide_4_body', group: 'make' },
];
let guideBack = -1; // the card to come back to when the window (opened by "Open this setting") closes

function guideHi() {
    popupFront({
        tag: 'GUIDE', code: 'SYS.NOTICE // WELCOME', title: t('guide_hi'), body: esc(t('guide_hi_body')),
        second: t('guide_no'), ok: t('guide_look'), onClose: (act) => { if (act === 'ok') guideCard(0); },
    });
}

function guideCard(i) {
    const c = GUIDE[i];
    if (!c) return;
    const last = i === GUIDE.length - 1;
    const dots = `<span class="sblink-guidedots">${GUIDE.map((_, j) => `<i class="${j <= i ? 'sblink-on' : ''}"></i>`).join('')}</span>`;
    const tones = c.tones ? `<div class="sblink-guidetones">${['game', 'star', 'threat'].map(x => `<span class="sblink-guidetone sblink-tn-${x}" style="color:var(--sb-acc);border-color:var(--sb-acc-dim)">● ${esc(t(`opt_tone_${x}`))}</span>`).join('')}</div>` : '';
    popupFront({
        tag: 'GUIDE', code: `SYS.NOTICE // 0${i + 1} / 0${GUIDE.length}`, title: t(c.title),
        body: `${tones}<div>${esc(t(c.body))}</div><div class="sblink-hint">${dots}</div>`,
        second: last ? '' : t('guide_stop'), ok: t(last ? 'guide_end' : 'guide_next'), link: t('guide_open'),
        onClose: (act) => {
            if (act === 'ok' && !last) guideCard(i + 1);
            else if (act === 'link') { guideBack = i; pausePops(true); openWindow('', { gear: c.group }); }
        },
    });
}

function guideAgain() { if (isOpen()) closeWindow(); guideBack = -1; pausePops(false); guideCard(0); }

function windowClosed() {
    if (guideBack < 0) return;
    const i = guideBack;
    guideBack = -1;
    guideCard(i);
    pausePops(false);
}

// ---------- bus: things the rules tell the screen ----------
function wireBus() {
    bus.on('change', redrawSoon);
    bus.on('checkNow', () => checkSoon(true));
    bus.on('checkFailed', () => notice(t('check_failed'), 'warn'));
    bus.on('cleared', (list) => { for (const c of list) { if (c.q.kind !== 'goal') clearedNotice(c); if (c.q.kind === 'hidden') rewardSkill(currentChatId(), 'hidden', c.q); } });
    bus.on('skillGained', ({ skill, from }) => alertOr(t('toast_skill', { name: skill.name }), () => skillPopup(skill, from)));
    bus.on('stageCleared', (q) => { stageClearAlert(q); nextStage(); });
    // 0.7.0 genre mode: what is still hidden comes with the reply that brings it in (see `revealed`)
    bus.on('stageArrived', (q) => { if (!veiled(room(), q)) notice(t('toast_stage_new', { name: q.name })); });
    bus.on('goalDone', (g) => goalDonePopup(g));
    bus.on('goalGiven', ({ goal, stage }) => { if (!stage || !veiled(room(), stage)) goalAlert(goal, stage); });
    bus.on('goalFailed', () => notice(t('goal_give_failed'), 'warn'));
    bus.on('questsArrived', (list) => { const r = room(); arrival(list.filter(q => !veiled(r, q))); });
    bus.on('sudden', ({ id, yes }) => answered(id, yes));
    bus.on('dayMoved', ({ days, failed, pen = [], debuff, lost, chatId }) => {
        notice(days === 1 ? t('toast_day') : t('toast_days', { n: days }));
        if (pen.length || debuff || lost) failPopup({ items: pen.map(x => ({ name: x.q.name, pts: x.pts, warn: x.warn, kind: 'daily' })), debuff, lost });
        else if (failed.length) notice(t('toast_failed', { n: failed.length }), 'warn');
        if (failed.length) cheer(chatId || currentChatId(), null, 'fail');
    });
    bus.on('bigEvent', () => bigPopup());
    bus.on('woke', () => { const s = settings(); if (!s.guideSeen) { s.guideSeen = true; save(); guideHi(); } });
    bus.on('awaken', () => { dropPopups(p => !!p.wakeFor); awakenPopup(); }); // woken by hand: an open "wake?" question is moot
    bus.on('tutorialStep', () => redrawSoon());
    bus.on('tutorialDone', () => alertOr(t('toast_tut_done'), () => popup({ tag: 'CLEAR', code: 'SYS.NOTICE // TUTORIAL', title: t('pop_tut_done'), lines: [`<span class="sblink-dia">◆</span><span class="sblink-ell">${esc(t('tut_reward'))}</span>`] })));
}

// ---------- settings panel & wand ----------
/** The extension menu is a SillyTavern drawer: close it the way its own icon does, so it does not sit over the window. */
function closeStDrawer(panel) {
    try {
        const drawer = panel.closest('.drawer-content.openDrawer');
        if (!drawer || drawer.classList.contains('pinnedOpen')) return; // pinned open by the user: leave it
        drawer.parentElement?.querySelector(':scope > .drawer-toggle')?.click();
    } catch (e) { console.warn('[System Blink] drawer', e); }
}
function mountPanel() {
    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!host) return;
    let panel = document.getElementById('sblink_settings');
    const wasOpen = panel?.querySelector('.inline-drawer-content')?.style.display === 'block';
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'sblink_settings';
        panel.className = 'sblink-panel';
        host.appendChild(panel);
        panel.addEventListener('click', (e) => {
            if (e.target.closest('[data-sblink-open]')) { closeStDrawer(panel); return openWindow(); }
            const sc = e.target.closest('[data-scope]');
            if (sc) { setScope('panel', sc.dataset.scope); mountPanel(); return; }
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

// ---------- 0.6.2: entering a chat ----------
// A brand-new chat with a character woken before wakes by itself; a chat without a main goal gets one.
// Waits a moment so the chat (and its greeting) is loaded before it is looked at.
let enterTimer = 0;
let openKey = null, prevOpen = null; // 0.6.11: the open chat, and the one before (to tell a rename of the open chat)
function enteredSoon() {
    clearTimeout(enterTimer);
    const chatId = currentChatId();
    enterTimer = setTimeout(async () => {
        if (!chatId || currentChatId() !== chatId || !settings().enabled || generating) return;
        try {
            if (wantsWake()) { askWake(chatId); return; } // waking gives the goal itself (after the tutorial)
            await giveGoal(chatId);
        } catch (e) { console.warn('[System Blink] enter', e); }
    }, 600);
}

// ---------- events ----------
function registerEvents() {
    const { eventSource } = ctx();
    const ev = ctx().eventTypes || ctx().event_types;
    // while switched off nothing runs, except keeping saved data with renamed / deleted chats
    const on = (name, fn, always = false) => { if (name) eventSource.on(name, (...a) => { try { if (always || settings().enabled) return fn(...a); } catch (e) { console.error('[System Blink]', e); } }); };

    on(ev.CHAT_CHANGED, () => { const id = currentChatId(); prevOpen = openKey; openKey = id; dropPopups(p => p.wakeFor && p.wakeFor !== id); settleRoom(msgKey); copyFromParent(msgKey); mountPanel(); if (!settings().enabled) return; generating = false; hold(false); checkRealDay(); redrawSoon(); enteredSoon(); }, true);
    for (const name of [ev.MESSAGE_DELETED, ev.MESSAGE_SWIPED, ev.MESSAGE_EDITED, ev.MESSAGE_UPDATED,
        ev.USER_MESSAGE_RENDERED, ev.CHARACTER_MESSAGE_RENDERED, ev.MORE_MESSAGES_LOADED, ev.CHAT_LOADED]) {
        on(name, () => { renderCardsSoon(); redrawSoon(); });
    }
    on(ev.MESSAGE_SENT, () => { bindUses(); foldStrip(); foldPanel(); redrawSoon(); });
    on(ev.GENERATION_STARTED, (type, _opts, dryRun) => {
        const kind = String(type || 'normal');
        if (!dryRun && kind !== 'quiet') { generating = true; hold(true); }
        updatePrompt(kind, !dryRun && kind !== 'quiet');
    });
    on(ev.MESSAGE_RECEIVED, (mesId) => {
        const view = chatView();
        const m = view.list[Number(mesId)];
        if (m && !m.is_user && sentNoteIds.length) { markDelivered(view.keys[Number(mesId)], sentNoteIds); sentNoteIds = []; }
        if (m && !m.is_user && sentTellIds.length) { revealed(markTold(view.keys[Number(mesId)], sentTellIds)); sentTellIds = []; }
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
    on(ev.CHAT_RENAMED, (data) => {
        // 0.6.11: whose chat it is comes with the event (card file or group); never moved over other data
        const owner = data?.groupId ? `g:${data.groupId}` : data?.avatarId ? `c:${data.avatarId}` : undefined;
        // SillyTavern has already opened the renamed chat (if it was the open one) under its real new name
        const was = owner ? `${owner}/${String(data?.oldFileName || '').replace(/\.jsonl$/i, '')}` : '';
        const open = currentChatId();
        const openName = was && prevOpen === was && open?.startsWith(`${owner}/`) ? chatName() : null;
        if (onChatRenamed(data?.oldFileName, data?.newFileName, owner, openName) === 'blocked') globalThis.toastr?.warning?.(t('rename_blocked'), 'System Blink');
        settleRoom(msgKey);
        redrawSoon();
    }, true);
    // 0.6.11: a renamed character gets a new card file: its chats' data follows
    on(ev.CHARACTER_RENAMED, (oldAvatar, newAvatar) => { onCharRenamed(oldAvatar, newAvatar); }, true);
    on(ev.CHAT_DELETED, (name) => { onChatDeleted(name, charStillHas).catch(e => console.warn('[System Blink] delete', e)); }, true);
    on(ev.GROUP_CHAT_DELETED, (name) => { onChatDeleted(name, groupStillHas).catch(e => console.warn('[System Blink] delete', e)); }, true);
    on(ev.APP_READY, () => { settleRoom(msgKey); mountWand(); if (!settings().enabled) return; mountFab(); checkRealDay(); redraw(); enteredSoon(); }, true);
}

// 0.6.11: SillyTavern before 1.13.0 ignores `simple` and leaves chats it could not read out of the list, so
// there a missing name proves nothing. Its version is asked once; unknown counts as old (data kept).
let newListServer = null;
async function listIsTrusty() {
    if (newListServer !== null) return newListServer;
    try {
        const res = await fetch('/version');
        const v = String((await res.json())?.pkgVersion || '').match(/^(\d+)\.(\d+)/);
        newListServer = !!v && (Number(v[1]) > 1 || (Number(v[1]) === 1 && Number(v[2]) >= 13));
    } catch { return false; } // try again next time
    return newListServer;
}

// 0.6.11: after a delete, does this owner still have a chat of that name? true / false / null (could not tell → data kept)
async function charStillHas(owner, name) {
    if (!owner.startsWith('c:')) return null;
    if (!(await listIsTrusty())) return null;
    const c = ctx();
    const res = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
        // simple: file names only (a chat that fails to read is not left out of the list)
        body: JSON.stringify({ avatar_url: owner.slice(2), simple: true }),
    });
    if (!res.ok) return null;
    const list = Object.values((await res.json()) || {});
    // a file-names-only list (a full one, with sizes and last messages, comes from a server that ignored `simple`)
    if (!list.every(x => x && typeof x.file_name === 'string' && Object.keys(x).every(k => k === 'file_name' || k === 'file_id'))) return null;
    return list.some(x => x.file_name.replace(/\.jsonl$/i, '') === name);
}
async function groupStillHas(owner, name) {
    if (!owner.startsWith('g:')) return null;
    const g = (ctx().groups || []).find(x => String(x.id) === owner.slice(2));
    return g && Array.isArray(g.chats) ? g.chats.includes(name) : null;
}

function watchScreen() {
    let tm = 0;
    const re = () => { cancelAnimationFrame(tm); tm = requestAnimationFrame(() => { placeWin(); placeFab(); placeStrip(); placePops(); placePanel(); placeToasts(); }); };
    window.addEventListener('resize', re);
    window.addEventListener('orientationchange', () => setTimeout(re, 250));
    window.visualViewport?.addEventListener('resize', re);
    window.visualViewport?.addEventListener('scroll', re);
    document.addEventListener('focusin', (e) => {
        // phone: typing a message closes the opened quest line, so it does not cover the chat
        if (isPhone() && /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '') && !e.target.closest?.('#sblink-win')) foldPanel();
        setTimeout(re, 350);
    });
    document.addEventListener('focusout', () => setTimeout(re, 450));
    // always let go of a drag
    window.addEventListener('blur', () => { endDrag(); endPanelDrag(); });
    window.addEventListener('pagehide', () => { endDrag(); endPanelDrag(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { endDrag(); endPanelDrag(); } });
    // the chat column changing width (side panels, chat width setting): the panel and notices follow it
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => { placePanel(); placeToasts(); });
        for (const id of ['sheld', 'form_sheld']) { const el = document.getElementById(id); if (el) ro.observe(el); }
    }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) closeWindow();
    });
    // SillyTavern redraws messages (swipe, edit, load more): put the cards back
    const chatEl = document.getElementById('chat');
    if (chatEl && 'MutationObserver' in window) {
        // 0.6.6: translation extensions put the translated text over a message's text (with or without
        // SillyTavern's redraw), which wipes the drawn quest lines. So the text inside messages is watched
        // too: a message whose text still holds a plain [SYS:QUEST] line gets drawn again. Our own changes
        // leave no plain line behind, so they do not set this off again. Waits a little so a reply that is
        // still coming in is drawn once, at the end.
        // 0.6.7: a MutationObserver runs before the screen is painted, so lines drawn here never show as
        // plain text first. Only while a reply is still coming in do we wait and draw once at the end.
        let textTimer = 0;
        new MutationObserver((list) => {
            const s = settings();
            if (!s.enabled) return;
            let msgs = false;
            const now = new Set();
            for (const m of list) {
                if (m.target === chatEl) {
                    msgs = true;
                    for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('mes')) now.add(n);
                    continue;
                }
                const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                if (!el || el.closest('.sblink-qblock, .sblink-card')) continue;
                if (el.closest('.sblink-qplain')) continue;
                const mt = el.closest('.mes_text');
                if (mt && hasPlainSys(mt)) { const mes = mt.closest('.mes'); if (mes) now.add(mes); }
            }
            if (now.size) {
                if (generating) { clearTimeout(textTimer); textTimer = setTimeout(renderCards, 300); }
                else drawQuestLinesNow([...now]);
            }
            if (msgs && s.logCards) renderCardsSoon();
        }).observe(chatEl, { childList: true, subtree: true, characterData: true });
    }
}

async function init() {
    settings();
    settleRoom(msgKey); // 0.6.11: a chat already open when the extension starts
    setLanguage(uiLang());
    setLangGetter(lang);
    wireBus();
    setPrefsHooks({ guide: guideAgain, redrawAll, turnedOff, turnedOn: redrawAll, lastPrompt: () => lastPrompt, langNow: uiLang, showText: showText });
    setWinHooks({ opened: () => { setFabHidden(true); setPanelHidden(true); renderStrip(); }, closed: () => { setFabHidden(false); setPanelHidden(false); renderStrip(); badge(); windowClosed(); } });
    setPanelHooks({
        open: (opts) => openWindow('quests', opts),
        off: () => { settings().questPanel = false; save(); notice(t('panel_off_toast')); redrawAll(); },
    });
    setFabHooks({ open: () => openWindow() });
    setPopHooks({ openTab: (tab) => openWindow(tab), openSkill: (id) => openWindow('status', { skill: id }), badge, checking: () => checkingKey });
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
