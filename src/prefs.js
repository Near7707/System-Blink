// Every setting, in one list. The ⚙ page in the window and the SillyTavern extension panel are
// both drawn from it and share the same saved values.

import { t, setLanguage, lang } from './i18n.js';
import { settings, conf, save, room, currentChatId, device, saveDevice, exportData, importData, settleRoom, oldBackup, VERSION, TONES, ROOM_KEYS, setRoomOwn, setRoomSetting } from './store.js';
import { switchOn, switchOff, bus, skipOldTold, charKey, giveGoal, msgKey } from './engine.js';
import { getProfiles, sentLog } from './ai.js';
import { buildLog, logFileName } from './export.js';
import { esc } from './ui/util.js';
import { resetPos } from './ui/fab.js';
import { resetPanelPos } from './ui/panel.js';

export { VERSION };

// kinds: toggle | choice | text (long, edited on its own page) | select | button
export const SCHEMA = [
    { group: 'room', rows: [
        { k: 'roomOn', kind: 'toggle', scope: 'room' },
        { k: 'autoWake', kind: 'toggle', scope: 'room', when: () => !!charKey() },
        { k: 'lifeToAI', kind: 'toggle', scope: 'room' },   // 0.6.9: each chat its own (daily-life mode is always on)
        { k: 'world', kind: 'text', scope: 'room' },
    ] },
    { group: 'system', rows: [
        { k: 'tone', kind: 'choice', opts: ['game', 'star', 'threat'], scope: 'room', dots: true },
        { k: 'difficulty', kind: 'radio', opts: ['off', 'easy', 'normal', 'hard', 'hell'], scope: 'room' },
        { k: 'pointRate', kind: 'choice', opts: [0.5, 1, 2] },
        { k: 'dayBasis', kind: 'choice', opts: ['story', 'real'] },
        { k: 'judgeEvery', kind: 'choice', opts: ['every', 'three', 'manual'] },
        { k: 'tutorialAuto', kind: 'toggle', common: true },
        { k: 'visibility', kind: 'choice', opts: ['me', 'all'] },
        { k: 'questChance', kind: 'choice', opts: ['off', 'some', 'more'] },
    ] },
    { group: 'quests', rows: [
        { k: 'suddenFreq', kind: 'choice', opts: ['off', 'rare', 'normal', 'often'] },
        { k: 'suddenRest', kind: 'choice', opts: [3, 5, 10], needs: 'suddenFreq' },
        { k: 'hiddenOn', kind: 'toggle' },
        { k: 'storyQuest', kind: 'toggle' },
        { k: 'goalAuto', kind: 'toggle' },
    ] },
    { group: 'spectators', rows: [
        { k: 'specOn', kind: 'toggle' },
        { k: 'specMode', kind: 'choice', opts: ['light', 'rich'], needs: 'specOn' },
        { k: 'specGift', kind: 'toggle', needs: 'specOn' },
    ] },
    { group: 'screen', common: true, rows: [
        { k: 'lang', kind: 'choice', opts: ['en', 'ko'] },
        { k: 'motion', kind: 'toggle' },
        { k: 'logCards', kind: 'toggle' },
        { k: 'toastPos', kind: 'choice', opts: ['column', 'input', 'screen'] },
        { k: 'questPanel', kind: 'toggle' },
    ] },
    { group: 'button', common: true, rows: [
        { k: 'btnShow', kind: 'toggle' },
        { k: 'btnOnlyOn', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnSize', kind: 'choice', opts: ['small', 'normal'], scope: 'device', needs: 'btnShow' },
        { k: 'btnShape', kind: 'choice', opts: ['hex', 'hexb', 'tab', 'badge'], scope: 'device', needs: 'btnShow', shapes: true },
        { k: 'btnRing', kind: 'choice', opts: ['dotted', 'solid'], scope: 'device', needs: 'btnShow', preview: true, when: () => device().shape === 'hex' },
        { k: 'btnTuck', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnDim', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnReset', kind: 'button', needs: 'btnShow' },
    ] },
    { group: 'make', folded: true, rows: [
        { k: 'useDefaults', kind: 'toggle' },
        { k: 'oddities', kind: 'toggle' },
        { k: 'customShop', kind: 'text', common: true },
        { k: 'profileId', kind: 'select' },
    ] },
    { group: 'data', folded: true, rows: [
        { k: 'logTxt', kind: 'button', pair: true },
        { k: 'logJson', kind: 'button' },
        { k: 'export', kind: 'button', pair: true },
        { k: 'import', kind: 'button' },
        { k: 'sent', kind: 'button' },
        { k: 'oldBackup', kind: 'button', when: () => !!oldBackup() },
        { k: 'allOff', kind: 'button', danger: true },
    ] },
];

// 0.6.9: "this chat only" sits at the very top of the settings, outside the groups
const OWN_ROW = { k: 'roomOwn', kind: 'toggle', scope: 'room' };
export const ROWS = Object.fromEntries([...SCHEMA.flatMap(g => g.rows), OWN_ROW].map(r => [r.k, r]));

// ---------- 0.6.8 "this chat only": a [This chat] [Shared] tab in the ⚙ page and in the extension panel ----------
// The tab only shows in a chat that keeps its own settings. [This chat] holds what a chat can keep for itself;
// [Shared] holds the shared values and the settings that are always shared (screen, button, language…).
const scopeNow = { gear: 'room', panel: 'room' };
let panelChat = null;
/** The open chat keeps its own settings. */
export const ownOn = () => !!room()?.own;
export function setScope(where, v) { scopeNow[where] = v === 'common' ? 'common' : 'room'; }
export function scopeOf(where) { return ownOn() ? scopeNow[where] : 'common'; }
const useOwn = (k, where) => ownOn() && scopeNow[where] === 'room' && ROOM_KEYS.includes(k);

/** The rows a group shows on this tab (null = the group is not on this tab). */
function rowsFor(g, where) {
    let rows = g.rows.filter(r => !r.when || r.when());
    if (!ownOn()) return rows;
    if (scopeNow[where] === 'room') {
        if (g.common) return null;
        rows = rows.filter(r => !r.common);
    } else {
        if (g.group === 'room') return null;
        rows = rows.filter(r => r.scope !== 'room');
    }
    return rows.length ? rows : null;
}

export function getValue(k, where = 'gear') {
    const s = settings();
    const r = room();
    if (useOwn(k, where)) return conf()[k];
    switch (k) {
        case 'roomOn': return !!r?.on;
        case 'roomOwn': return !!r?.own;
        case 'autoWake': { const ck = charKey(); return !!ck && s.autoWake[ck] === true; }
        case 'lifeToAI': return r ? r.lifeToAI !== false : true;
        case 'world': return r?.world || '';
        case 'difficulty': return r?.difficulty || 'off';
        case 'tone': return r?.tone || 'game';
        case 'lang': return lang();
        case 'btnSize': return device().size;
        case 'btnRing': return device().ring;
        case 'btnShape': return device().shape;
        default: return s[k];
    }
}

const isDisabled = (row, where = 'gear') => {
    if (row.scope === 'room' && !currentChatId()) return true;
    if (['lifeToAI', 'world', 'difficulty', 'tone', 'roomOwn'].includes(row.k)) return !room()?.on;
    if (row.needs) { const n = getValue(row.needs, where); if (!n || n === 'off') return true; }
    return false;
};

let hooks = { guide: () => {}, redrawAll: () => {}, turnedOff: () => {}, turnedOn: () => {}, lastPrompt: () => '', openText: () => {}, showText: () => {}, langNow: () => 'en' };
export function setPrefsHooks(h) { hooks = { ...hooks, ...h }; }

export async function setValue(k, v, where = 'gear') {
    const s = settings();
    if (useOwn(k, where)) {
        const id = currentChatId();
        if (k === 'pointRate' || k === 'suddenRest') v = Number(v);
        if (k === 'storyQuest' && v && !conf().storyQuest) skipOldTold(id);
        setRoomSetting(id, k, ['hiddenOn', 'storyQuest', 'goalAuto', 'specOn', 'specGift', 'useDefaults', 'oddities'].includes(k) ? !!v : v);
        if (k === 'goalAuto' && v) giveGoal();
        bus.emit('change');
        hooks.redrawAll();
        return;
    }
    switch (k) {
        case 'roomOwn': {
            const id = currentChatId();
            if (!id || !room()?.on) break;
            if (v) { setRoomOwn(id, true); scopeNow.gear = 'room'; scopeNow.panel = 'room'; break; }
            // off: this chat's values go, after asking
            hooks.redrawAll();
            if (await confirmBox(t('own_off_q'))) {
                const before = !!conf(id).storyQuest;
                setRoomOwn(id, false);
                if (!before && conf(id).storyQuest) skipOldTold(id);
            }
            break;
        }
        case 'roomOn':
            if (v) { await switchOn(); break; }
            switchOff();
            // 0.6.2: new chats with this character wake by themselves — ask whether that should stop too
            {
                const ck = charKey();
                if (ck && s.autoWake[ck] === true) {
                    bus.emit('change'); hooks.redrawAll();
                    if (await confirmBox(t('autowake_off_q'))) { s.autoWake[ck] = false; save(); }
                }
            }
            break;
        case 'autoWake': { const ck = charKey(); if (ck) { s.autoWake[ck] = !!v; save(); } break; }
        case 'goalAuto': s.goalAuto = !!v; save(); if (v) giveGoal(); break;
        case 'lifeToAI': { const r = room(); if (r) { r.lifeToAI = !!v; save(); } break; }
        case 'difficulty': { const r = room(); if (r && ['off', 'easy', 'normal', 'hard', 'hell'].includes(v)) { r.difficulty = v; save(); } break; }
        case 'tone': { const r = room(); if (r && TONES.includes(v)) { r.tone = v; save(); } break; }
        case 'world': { const r = room(currentChatId(), true); if (r) { r.world = String(v || '').slice(0, 2000); save(); } break; }
        case 'lang': s.lang = v === 'ko' ? 'ko' : 'en'; s.langChosen = true; setLanguage(s.lang); save(); break;
        case 'btnSize': case 'btnRing': { const d = device(); d[k === 'btnSize' ? 'size' : 'ring'] = v; if (k === 'btnSize') d.sizePicked = true; saveDevice(d); break; }
        case 'btnShape': { const d = device(); if (['hex', 'hexb', 'tab', 'badge'].includes(v)) { d.shape = v; saveDevice(d); } break; }
        case 'pointRate': s.pointRate = Number(v); save(); break;
        case 'suddenRest': s.suddenRest = Number(v); save(); break;
        case 'storyQuest': if (v && !s.storyQuest) skipOldTold(); s.storyQuest = !!v; save(); break;
        default: s[k] = v; save();
    }
    bus.emit('change');
    hooks.redrawAll();
}

export async function runButton(k) {
    if (k === 'guideAgain') return hooks.guide();
    if (k === 'btnReset') { resetPos(); resetPanelPos(); globalThis.toastr?.info?.(t('btn_reset_done'), t('ext_name')); return; }
    if (k === 'export') return doExport();
    if (k === 'logTxt' || k === 'logJson') {
        if (!currentChatId()) { globalThis.toastr?.info?.(t('no_chat'), t('ext_name')); return; }
        const f = k === 'logJson' ? 'json' : 'txt';
        return saveText(buildLog(f), logFileName(f), f === 'json' ? 'application/json' : 'text/plain');
    }
    if (k === 'oldBackup') return download(oldBackup(), 'system-blink-before-0.2.json');
    if (k === 'import') return doImport();
    if (k === 'sent') return hooks.showText(sentText());
    if (k === 'allOn') { settings().enabled = true; save(); hooks.turnedOn(); return; }
    if (k === 'allOff') {
        settings().enabled = false; save();
        hooks.turnedOff();
        globalThis.toastr?.info?.(t('off_where'), t('ext_name'));
    }
}

function doExport() {
    const d = new Date();
    download(exportData(), `system-blink-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`);
}

function download(obj, name) {
    if (!obj) return;
    saveText(JSON.stringify(obj, null, 1), name, 'application/json');
}

function saveText(text, name, type) {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function doImport() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
            const obj = JSON.parse(await f.text());
            const ok = await confirmBox(t('import_confirm'));
            if (!ok) return;
            importData(obj);
            settleRoom(msgKey); // 0.6.11: an old backup's data for the open chat finds its owner now, before anything new is made
            setLanguage(settings().langChosen ? settings().lang : hooks.langNow());
            bus.emit('change'); hooks.redrawAll();
            globalThis.toastr?.success?.(t('import_done'), t('ext_name'));
        } catch (e) { globalThis.toastr?.error?.(t('import_bad'), t('ext_name')); console.warn('[System Blink] import', e); }
    };
    inp.click();
}

export async function confirmBox(text) {
    const c = globalThis.SillyTavern?.getContext?.();
    if (typeof c?.callGenericPopup === 'function' && c.POPUP_TYPE) return !!(await c.callGenericPopup(esc(text), c.POPUP_TYPE.CONFIRM));
    return window.confirm(text);
}

function sentText() {
    const out = [];
    const prompt = hooks.lastPrompt?.() || '';
    out.push(`### ${t('sent_prompt')}\n${prompt || t('sent_none')}`);
    for (const [k, v] of Object.entries(sentLog)) {
        out.push(`### ${t(`sent_${k}`)}\n${v ? `${new Date(v.at).toLocaleString()}\n\n${v.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n')}\n\n[answer]\n${v.answer || '…'}` : t('sent_none')}`);
    }
    return out.join('\n\n');
}

// ---------- the ⚙ page in the window ----------
const label = (row) => t(`set_${row.k}`);
const hint = (row) => t(`set_${row.k}_hint`);
const optLabel = (row, o) => (row.k === 'lang' ? (o === 'ko' ? '한국어' : 'English') : row.k === 'pointRate' ? `${o}×` : row.k === 'suddenRest' ? t('opt_suddenRest', { n: o }) : t(`opt_${row.k}_${o}`));

let openGroups = new Set();
export function toggleGroup(g) { if (openGroups.has(g)) openGroups.delete(g); else openGroups.add(g); }
export function openGroup(g) { openGroups.add(g); }

export function gearHtml() {
    const s = settings();
    const out = [];
    for (const g of SCHEMA) {
        const rows = rowsFor(g, 'gear');
        if (!rows) continue;
        const isOpen = !g.folded || openGroups.has(g.group);
        out.push(`<div class="sblink-sec${g.folded ? ' sblink-fold' : ''}" data-group="${g.group}">
          ${g.folded
            ? `<div class="sblink-sechead sblink-foldbar" data-fold="${g.group}" role="button" tabindex="0" aria-expanded="${isOpen}"><span class="sblink-dia">◆</span><span class="sblink-foldtitle"><span>${esc(t(`grp_${g.group}`))}</span><span class="sblink-foldsub">${esc(t(`fold_sub_${g.group}`))}</span></span><span class="sblink-foldmark">${esc(t(isOpen ? 'fold_close' : 'fold_open'))}</span></div>`
            : `<div class="sblink-sechead"><span class="sblink-dia">◆</span><span>${esc(t(`grp_${g.group}`))}</span><i class="sblink-secline"></i></div>`}
          ${isOpen ? rows.map(gearRow).join('') : ''}
        </div>`);
    }
    // 0.6.5: the first-time guide, again
    out.unshift(`<div class="sblink-row"><button type="button" class="sblink-btn sblink-btn-wide sblink-guidebtn" data-run="guideAgain"><span class="sblink-dia">◆</span><span class="sblink-ell">${esc(t('guide_again'))}</span><span class="sblink-guidego">›</span></button></div>`);
    if (currentChatId()) out.unshift(`<div class="sblink-ownrow">${gearRow(OWN_ROW)}</div>`);
    if (!s.enabled) out.unshift(`<div class="sblink-note">${esc(t('off_where'))}</div>`);
    if (ownOn()) {
        const tab = scopeNow.gear;
        out.unshift(`<div class="sblink-scopetabs" role="tablist">${['room', 'common'].map(x => `<button type="button" class="sblink-scopetab${x === tab ? ' sblink-scopetab-on' : ''}" data-scope="${x}" role="tab" aria-selected="${x === tab}"><span class="sblink-ell">${esc(t(`scope_${x}`))}</span></button>`).join('')}</div>`
            + (tab === 'room' ? `<div class="sblink-scopenote">${esc(t('scope_room_note'))}</div>` : `<div class="sblink-scopewarn">${esc(t('scope_common_note'))}</div>`));
    }
    out.push(`<div class="sblink-gearfoot">${esc(t('full_settings'))}<span class="sblink-code">v${VERSION}</span></div>`);
    return out.join('');
}

function gearRow(row) {
    const v = getValue(row.k);
    const dis = isDisabled(row);
    const d = dis ? ' sblink-dis' : '';
    const h = hint(row);
    const hintHtml = h && h !== `set_${row.k}_hint` ? `<div class="sblink-hint">${esc(h)}</div>` : '';
    if (row.kind === 'toggle') {
        return `<div class="sblink-row${d}"><div class="sblink-rowmain"><span class="sblink-rowlabel">${esc(label(row))}</span>
          <button type="button" class="sblink-tog${v ? ' sblink-on' : ''}" data-set="${row.k}" data-val="${v ? '0' : '1'}" role="switch" aria-checked="${v ? 'true' : 'false'}"${dis ? ' disabled' : ''}><i></i></button></div>${hintHtml}</div>`;
    }
    if (row.kind === 'choice') {
        const chips = row.opts.map(o => `<button type="button" class="sblink-chip${String(o) === String(v) ? ' sblink-chip-on' : ''}" data-set="${row.k}" data-val="${o}"${dis ? ' disabled' : ''}>${row.preview ? `<i class="sblink-ringprev sblink-ring-${o}"></i>` : ''}${row.shapes ? `<i class="sblink-shapeprev sblink-shapeprev-${o}"></i>` : ''}${row.dots ? `<i class="sblink-tonedot sblink-tonedot-${o}"></i>` : ''}<span class="sblink-ell">${esc(optLabel(row, o))}</span></button>`).join('');
        return `<div class="sblink-row${d}"><div class="sblink-rowlabel">${esc(label(row))}</div><div class="sblink-chips">${chips}</div>${hintHtml}</div>`;
    }
    if (row.kind === 'radio') {
        const opts = row.opts.map(o => `<button type="button" class="sblink-radio${String(o) === String(v) ? ' sblink-radio-on' : ''}${o === 'hell' ? ' sblink-radio-hell' : ''}" data-set="${row.k}" data-val="${o}" role="radio" aria-checked="${String(o) === String(v)}"${dis ? ' disabled' : ''}>
            <i class="sblink-radiodot"></i><span class="sblink-radiotext"><b class="sblink-radioname">${esc(optLabel(row, o))}</b><span class="sblink-radiodesc sblink-ell">${esc(t(`opt_${row.k}_${o}_d`))}</span></span></button>`).join('');
        return `<div class="sblink-row${d}"><div class="sblink-rowlabel">${esc(label(row))}</div><div class="sblink-radios" role="radiogroup">${opts}</div>${hintHtml}</div>`;
    }
    if (row.kind === 'text') {
        const text = String(v || '');
        return `<div class="sblink-row${d}"><div class="sblink-rowmain"><span class="sblink-rowlabel">${esc(label(row))}</span>
          <button type="button" class="sblink-btn sblink-btn-sm" data-text="${row.k}"${dis ? ' disabled' : ''}><span class="sblink-ell">${esc(text ? t('edit') : t('write'))}</span></button></div>
          <div class="sblink-textpeek sblink-ell">${esc(text ? text.split('\n')[0] : t('empty'))}</div>${hintHtml}</div>`;
    }
    if (row.kind === 'select') {
        const profiles = getProfiles();
        const opts = [`<option value="">${esc(t('profile_current'))}</option>`, ...profiles.map(p => `<option value="${esc(p.id)}"${p.id === v ? ' selected' : ''}>${esc(p.name || p.id)}</option>`)].join('');
        return `<div class="sblink-row${d}"><div class="sblink-rowlabel">${esc(label(row))}</div><div class="sblink-selwrap"><select class="sblink-sel" data-sel="${row.k}"${dis ? ' disabled' : ''}>${opts}</select></div>${hintHtml}</div>`;
    }
    if (row.kind === 'button') {
        return `<div class="sblink-row${d}"><button type="button" class="sblink-btn sblink-btn-wide${row.danger ? ' sblink-btn-danger' : ''}${row.k === 'allOff' ? ' sblink-btn-off' : ''}" data-run="${row.k}"${dis ? ' disabled' : ''}><span class="sblink-ell">${esc(label(row))}</span></button>${hintHtml}</div>`;
    }
    return '';
}

// ---------- the SillyTavern extension panel (SillyTavern's own look and sizes) ----------
export function panelHtml() {
    const s = settings();
    const out = [];
    if (!s.enabled) out.push(`<div class="sblink-phint"><b>${esc(t('off_short'))}</b> <button type="button" class="menu_button sblink-pbtn" data-run="allOn">${esc(t('turn_on'))}</button></div>`);
    else out.push(`<div class="sblink-pbtns"><button type="button" class="menu_button sblink-pbtn" data-run="guideAgain">${esc(t('guide_again'))}</button></div>`);
    // a new chat starts on its [This chat] tab
    const chatNow = currentChatId();
    if (chatNow !== panelChat) { panelChat = chatNow; scopeNow.panel = 'room'; }
    if (chatNow) out.push(panelRow(OWN_ROW));
    if (ownOn()) {
        const tab = scopeNow.panel;
        out.push(`<div class="sblink-pbtns sblink-pscope">${['room', 'common'].map(x => `<button type="button" class="menu_button sblink-pbtn${x === tab ? ' sblink-pscope-on' : ''}" data-scope="${x}" aria-pressed="${x === tab}">${esc(t(`scope_${x}`))}</button>`).join('')}</div>`);
        out.push(`<small class="sblink-phint">${esc(t(tab === 'room' ? 'scope_room_note' : 'scope_common_note'))}</small>`);
    }
    for (const g of SCHEMA) {
        const rows = rowsFor(g, 'panel');
        if (!rows) continue;
        out.push(`<h4 class="sblink-ph">${esc(t(`grp_${g.group}`))}</h4>`);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const next = rows[i + 1];
            // two buttons that belong together sit side by side (export .txt | .json, backup | restore)
            if (row.pair && row.kind === 'button' && next?.kind === 'button') {
                out.push(`<div class="sblink-pbtns">${panelBtn(row)}${panelBtn(next)}</div>${panelHint(row)}${panelHint(next)}`);
                i++;
            } else out.push(panelRow(row));
        }
    }
    out.push(`<div class="sblink-phint sblink-pver">v${VERSION}</div>`);
    return out.join('');
}

const panelBtn = (row) => `<button type="button" class="menu_button sblink-pbtn" data-run="${row.k}"${isDisabled(row, 'panel') ? ' disabled' : ''}>${esc(label(row))}</button>`;
function panelHint(row) {
    const h = hint(row);
    return h && h !== `set_${row.k}_hint` ? `<small class="sblink-phint">${esc(h)}</small>` : '';
}

function panelRow(row) {
    const v = getValue(row.k, 'panel');
    const dis = isDisabled(row, 'panel') ? ' disabled' : '';
    const h = hint(row);
    const hintHtml = h && h !== `set_${row.k}_hint` ? `<small class="sblink-phint">${esc(h)}</small>` : '';
    if (row.kind === 'toggle') return `<label class="checkbox_label"><input type="checkbox" data-pset="${row.k}"${v ? ' checked' : ''}${dis}><span>${esc(label(row))}</span></label>${hintHtml}`;
    if (row.kind === 'radio') {
        return `<label class="sblink-plabel">${esc(label(row))}</label><select class="text_pole" data-pset="${row.k}"${dis}>${row.opts.map(o => `<option value="${o}"${String(o) === String(v) ? ' selected' : ''}>${esc(`${optLabel(row, o)} — ${t(`opt_${row.k}_${o}_d`)}`)}</option>`).join('')}</select>${hintHtml}`;
    }
    if (row.kind === 'choice') {
        return `<label class="sblink-plabel">${esc(label(row))}</label><select class="text_pole" data-pset="${row.k}"${dis}>${row.opts.map(o => `<option value="${o}"${String(o) === String(v) ? ' selected' : ''}>${esc(optLabel(row, o))}</option>`).join('')}</select>${hintHtml}`;
    }
    if (row.kind === 'text') return `<label class="sblink-plabel">${esc(label(row))}</label><textarea class="text_pole sblink-pta" rows="${row.k === 'world' ? 5 : 3}" data-pset="${row.k}" placeholder="${esc(t(`set_${row.k}_ph`))}"${dis}>${esc(v || '')}</textarea>${hintHtml}`;
    if (row.kind === 'select') {
        const profiles = getProfiles();
        return `<label class="sblink-plabel">${esc(label(row))}</label><select class="text_pole" data-pset="${row.k}"${dis}><option value="">${esc(t('profile_current'))}</option>${profiles.map(p => `<option value="${esc(p.id)}"${p.id === v ? ' selected' : ''}>${esc(p.name || p.id)}</option>`).join('')}</select>${hintHtml}`;
    }
    if (row.kind === 'button') return `<div class="sblink-pbtns">${panelBtn(row)}</div>${hintHtml}`;
    return '';
}

/** Change events from the extension panel. */
export function panelChange(e) {
    const el = e.target.closest('[data-pset]');
    if (!el) return;
    const k = el.dataset.pset;
    const row = ROWS[k];
    let v;
    if (row.kind === 'toggle') v = el.checked;
    else if (row.k === 'pointRate' || row.k === 'suddenRest') v = Number(el.value);
    else v = el.value;
    setValue(k, v, 'panel');
}
