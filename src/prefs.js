// Every setting, in one list. The ⚙ page in the window and the SillyTavern extension panel are
// both drawn from it and share the same saved values.

import { t, setLanguage, lang } from './i18n.js';
import { settings, save, room, currentChatId, device, saveDevice, exportData, importData, oldBackup, VERSION, TONES } from './store.js';
import { switchOn, switchOff, bus } from './engine.js';
import { getProfiles, sentLog } from './ai.js';
import { buildLog, logFileName } from './export.js';
import { esc } from './ui/util.js';
import { resetPos } from './ui/fab.js';

export { VERSION };

// kinds: toggle | choice | text (long, edited on its own page) | select | button
export const SCHEMA = [
    { group: 'room', rows: [
        { k: 'roomOn', kind: 'toggle', scope: 'room' },
        { k: 'lifeMode', kind: 'toggle', scope: 'room' },
        { k: 'world', kind: 'text', scope: 'room' },
    ] },
    { group: 'system', rows: [
        { k: 'tone', kind: 'choice', opts: ['game', 'star', 'threat'], scope: 'room', dots: true },
        { k: 'difficulty', kind: 'radio', opts: ['off', 'easy', 'normal', 'hard', 'hell'], scope: 'room' },
        { k: 'pointRate', kind: 'choice', opts: [0.5, 1, 2] },
        { k: 'dayBasis', kind: 'choice', opts: ['story', 'real'] },
        { k: 'judgeEvery', kind: 'choice', opts: ['every', 'three', 'manual'] },
        { k: 'tutorialAuto', kind: 'toggle' },
        { k: 'visibility', kind: 'choice', opts: ['me', 'all'] },
        { k: 'lifeToAI', kind: 'toggle' },
        { k: 'questChance', kind: 'choice', opts: ['off', 'some', 'more'] },
    ] },
    { group: 'quests', rows: [
        { k: 'suddenFreq', kind: 'choice', opts: ['off', 'rare', 'normal', 'often'] },
        { k: 'suddenRest', kind: 'choice', opts: [3, 5, 10], needs: 'suddenFreq' },
        { k: 'hiddenOn', kind: 'toggle' },
        { k: 'goalSuggest', kind: 'choice', opts: ['auto', 'manual', 'off'] },
    ] },
    { group: 'spectators', rows: [
        { k: 'specOn', kind: 'toggle' },
        { k: 'specMode', kind: 'choice', opts: ['light', 'rich'], needs: 'specOn' },
        { k: 'specGift', kind: 'toggle', needs: 'specOn' },
    ] },
    { group: 'screen', rows: [
        { k: 'lang', kind: 'choice', opts: ['en', 'ko'] },
        { k: 'motion', kind: 'toggle' },
        { k: 'logCards', kind: 'toggle' },
    ] },
    { group: 'button', rows: [
        { k: 'btnShow', kind: 'toggle' },
        { k: 'btnOnlyOn', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnSize', kind: 'choice', opts: ['small', 'normal'], scope: 'device', needs: 'btnShow' },
        { k: 'btnRing', kind: 'choice', opts: ['dotted', 'solid'], scope: 'device', needs: 'btnShow', preview: true },
        { k: 'btnTuck', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnDim', kind: 'toggle', needs: 'btnShow' },
        { k: 'btnReset', kind: 'button', needs: 'btnShow' },
    ] },
    { group: 'make', folded: true, rows: [
        { k: 'useDefaults', kind: 'toggle' },
        { k: 'oddities', kind: 'toggle' },
        { k: 'customShop', kind: 'text' },
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

export const ROWS = Object.fromEntries(SCHEMA.flatMap(g => g.rows).map(r => [r.k, r]));

export function getValue(k) {
    const s = settings();
    const r = room();
    switch (k) {
        case 'roomOn': return !!r?.on;
        case 'lifeMode': return r ? !!r.lifeMode : true;
        case 'world': return r?.world || '';
        case 'difficulty': return r?.difficulty || 'off';
        case 'tone': return r?.tone || 'game';
        case 'lang': return lang();
        case 'btnSize': return device().size;
        case 'btnRing': return device().ring;
        default: return s[k];
    }
}

const isDisabled = (row) => {
    if (row.scope === 'room' && !currentChatId()) return true;
    if (['lifeMode', 'world', 'difficulty', 'tone'].includes(row.k)) return !room()?.on;
    if (row.needs && (!settings()[row.needs] || settings()[row.needs] === 'off')) return true;
    return false;
};

let hooks = { redrawAll: () => {}, turnedOff: () => {}, turnedOn: () => {}, lastPrompt: () => '', openText: () => {}, showText: () => {}, langNow: () => 'en' };
export function setPrefsHooks(h) { hooks = { ...hooks, ...h }; }

export async function setValue(k, v) {
    const s = settings();
    switch (k) {
        case 'roomOn': if (v) await switchOn(); else switchOff(); break;
        case 'lifeMode': { const r = room(); if (r) { r.lifeMode = !!v; save(); } break; }
        case 'difficulty': { const r = room(); if (r && ['off', 'easy', 'normal', 'hard', 'hell'].includes(v)) { r.difficulty = v; save(); } break; }
        case 'tone': { const r = room(); if (r && TONES.includes(v)) { r.tone = v; save(); } break; }
        case 'world': { const r = room(currentChatId(), true); if (r) { r.world = String(v || '').slice(0, 2000); save(); } break; }
        case 'lang': s.lang = v === 'ko' ? 'ko' : 'en'; s.langChosen = true; setLanguage(s.lang); save(); break;
        case 'btnSize': case 'btnRing': { const d = device(); d[k === 'btnSize' ? 'size' : 'ring'] = v; if (k === 'btnSize') d.sizePicked = true; saveDevice(d); break; }
        case 'pointRate': s.pointRate = Number(v); save(); break;
        case 'suddenRest': s.suddenRest = Number(v); save(); break;
        default: s[k] = v; save();
    }
    bus.emit('change');
    hooks.redrawAll();
}

export async function runButton(k) {
    if (k === 'btnReset') { resetPos(); globalThis.toastr?.info?.(t('btn_reset_done'), t('ext_name')); return; }
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

export function gearHtml() {
    const s = settings();
    const out = [];
    for (const g of SCHEMA) {
        const isOpen = !g.folded || openGroups.has(g.group);
        out.push(`<div class="sblink-sec${g.folded ? ' sblink-fold' : ''}">
          ${g.folded
            ? `<div class="sblink-sechead sblink-foldbar" data-fold="${g.group}" role="button" tabindex="0" aria-expanded="${isOpen}"><span class="sblink-dia">◆</span><span class="sblink-foldtitle"><span>${esc(t(`grp_${g.group}`))}</span><span class="sblink-foldsub">${esc(t(`fold_sub_${g.group}`))}</span></span><span class="sblink-foldmark">${esc(t(isOpen ? 'fold_close' : 'fold_open'))}</span></div>`
            : `<div class="sblink-sechead"><span class="sblink-dia">◆</span><span>${esc(t(`grp_${g.group}`))}</span><i class="sblink-secline"></i></div>`}
          ${isOpen ? g.rows.filter(r => !r.when || r.when()).map(gearRow).join('') : ''}
        </div>`);
    }
    if (!s.enabled) out.unshift(`<div class="sblink-note">${esc(t('off_where'))}</div>`);
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
        const chips = row.opts.map(o => `<button type="button" class="sblink-chip${String(o) === String(v) ? ' sblink-chip-on' : ''}" data-set="${row.k}" data-val="${o}"${dis ? ' disabled' : ''}>${row.preview ? `<i class="sblink-ringprev sblink-ring-${o}"></i>` : ''}${row.dots ? `<i class="sblink-tonedot sblink-tonedot-${o}"></i>` : ''}<span class="sblink-ell">${esc(optLabel(row, o))}</span></button>`).join('');
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
        return `<div class="sblink-row${d}"><button type="button" class="sblink-btn sblink-btn-wide${row.danger ? ' sblink-btn-danger' : ''}" data-run="${row.k}"${dis ? ' disabled' : ''}><span class="sblink-ell">${esc(label(row))}</span></button>${hintHtml}</div>`;
    }
    return '';
}

// ---------- the SillyTavern extension panel (SillyTavern's own look and sizes) ----------
export function panelHtml() {
    const s = settings();
    const out = [];
    if (!s.enabled) out.push(`<div class="sblink-phint"><b>${esc(t('off_short'))}</b> <button type="button" class="menu_button sblink-pbtn" data-run="allOn">${esc(t('turn_on'))}</button></div>`);
    for (const g of SCHEMA) {
        out.push(`<h4 class="sblink-ph">${esc(t(`grp_${g.group}`))}</h4>`);
        const rows = g.rows.filter(row => !row.when || row.when());
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

const panelBtn = (row) => `<button type="button" class="menu_button sblink-pbtn" data-run="${row.k}"${isDisabled(row) ? ' disabled' : ''}>${esc(label(row))}</button>`;
function panelHint(row) {
    const h = hint(row);
    return h && h !== `set_${row.k}_hint` ? `<small class="sblink-phint">${esc(h)}</small>` : '';
}

function panelRow(row) {
    const v = getValue(row.k);
    const dis = isDisabled(row) ? ' disabled' : '';
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
    setValue(k, v);
}
