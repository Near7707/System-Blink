// A small stand-in for SillyTavern's getContext(), events and chat screen, for trying System Blink.
// Names here are made up for testing.
(function () {
    const params = new URLSearchParams(location.search);
    const listeners = {};
    const eventTypes = {
        APP_READY: 'app_ready', CHAT_CHANGED: 'chat_id_changed', CHAT_LOADED: 'chatLoaded',
        MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_DELETED: 'message_deleted',
        MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited', MESSAGE_UPDATED: 'message_updated',
        USER_MESSAGE_RENDERED: 'user_message_rendered', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        MORE_MESSAGES_LOADED: 'more_messages_loaded', GENERATION_STARTED: 'generation_started',
        GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
        CHAT_RENAMED: 'chat_renamed', CHAT_DELETED: 'chat_deleted', GROUP_CHAT_DELETED: 'group_chat_deleted',
    };
    const eventSource = {
        on(n, f) { (listeners[n] ||= []).push(f); },
        async emit(n, ...a) { for (const f of listeners[n] || []) await f(...a); },
    };
    const characters = [{ name: 'Mira', avatar: 'mira.png', description: 'A cheerful barista in a small seaside town.' }];
    const extensionSettings = { connectionManager: { profiles: [{ id: 'p1', name: 'Fast model' }] } };
    try { Object.assign(extensionSettings, JSON.parse(localStorage.getItem('sblink_test_settings') || '{}')); } catch { /* ignore */ }
    if (params.has('fresh')) { for (const k of Object.keys(extensionSettings)) if (k !== 'connectionManager') delete extensionSettings[k]; localStorage.removeItem('systemBlink.device'); }
    if (params.get('lang')) extensionSettings.systemBlink = { ...(extensionSettings.systemBlink || {}), lang: params.get('lang'), langChosen: true };

    const state = { characterId: params.has('nochat') ? undefined : 0, chatName: 'Mira - 2026-01-01', clock: Date.UTC(2026, 0, 1, 9) };
    const chats = {};
    const metas = {};
    const stamp = () => new Date(state.clock += 60_000).toISOString();
    function chat() {
        if (!chats[state.chatName]) {
            chats[state.chatName] = [{ is_user: false, is_system: false, name: 'Mira', mes: 'Morning! The café just opened. Want your usual?', send_date: stamp() }];
            // a long chat for speed checks: made-up lines only
            const n = Number(params.get('long') || 0);
            for (let i = 1; i < n; i++) chats[state.chatName].push(i % 2
                ? { is_user: true, is_system: false, name: 'Ari', mes: `Line ${i}. I walk a little further down the street.`, send_date: stamp() }
                : { is_user: false, is_system: false, name: 'Mira', mes: `Line ${i}. The street is quiet; a bell rings somewhere.`, send_date: stamp() });
        }
        return chats[state.chatName];
    }
    // like SillyTavern: only the newest messages are drawn on screen
    const SHOWN = 100;
    let lastPrompt = '';
    let sentPrompt = '';
    window.__calls = { check: 0, quests: 0, shop: 0 };
    // the dice: never by default (tests turn them on)
    window.__sblinkRandom = () => 0.99;
    // answer YES to the check lines that contain one of `subs`; `extra` adds lines (SUDDEN / HIDDEN)
    window.__yes = (subs = [], extra = '') => {
        window.__checkAnswer = (user) => {
            const out = [];
            for (const m of user.matchAll(/^Q(\d+): (.*)$/gm)) out.push(`Q${m[1]}: ${subs.some(x => m[2].includes(x)) ? 'YES - "it happened right there"' : 'NO'}`);
            for (const m of user.matchAll(/^SKILL(\d+): /gm)) out.push(`SKILL${m[1]}: ${window.__skillYes ? 'YES - "the cat led the way"' : 'NO'}`);
            return out.concat(['TIME: -', 'WEATHER: -', 'PLACE: -', 'DATE: -', 'DAYS: 0', 'NEXT: -']).join('\n') + (extra ? `\n${extra}` : '');
        };
    };
    async function fakeAI(sys, user) {
        await new Promise(r => setTimeout(r, window.__aiDelay ?? 150));
        const ko = /in Korean/.test(user);
        if (/careful referee/.test(sys)) {
            window.__calls.check++; window.__checkLast = user;
            if (typeof window.__checkAnswer === 'function') return window.__checkAnswer(user);
            if (window.__checkAnswer) return window.__checkAnswer;
            return 'TIME: -\nWEATHER: -\nPLACE: -\nDATE: -\nDAYS: 0\nNEXT: -';
        }
        if (/NEXT stage of the main goal/.test(sys)) {
            window.__calls.stage = (window.__calls.stage || 0) + 1;
            if (window.__stageFail) return 'nope';
            return ko ? '{"name":"주인에게 일 배우기","conds":["일을 돕겠다고 말하기","하루 동안 혼자 가게 보기"],"reward":200}'
                : '{"name":"Learn the work from the owner","conds":["Offer to help the owner","Watch the shop alone for a day"],"reward":200}';
        }
        if (/ONE main goal/.test(sys)) {
            window.__calls.goal = (window.__calls.goal || 0) + 1;
            return ko ? '{"title":"작은 찻집을 내 가게로 만들기","total":4,"stage":{"name":"찻집의 단골 되기","conds":[],"reward":100}}'
                : '{"title":"Make the little tea house my own","total":4,"stage":{"name":"Become a regular at the tea house","conds":[],"reward":100}}';
        }
        if (/daily quests/.test(sys)) {
            window.__calls.quests++;
            if (window.__questFail) return 'sorry';
            // 2-B: Hard / Hell ask for conditions, a debuff asks for a penalty quest
            if (/conditions in "conds"/.test(sys)) {
                window.__calls.hardQuests = (window.__calls.hardQuests || 0) + 1;
                const three = /2 or 3 conditions/.test(sys);
                const q = ko
                    ? [['단골 가게 두 곳 들르기', ['빵집에 들르기', '꽃집에 들르기', '서점에 들르기'], 10], ['비 오는 거리 걷기', ['우산 없이 나가기', '젖은 채로 돌아오기', '수건 빌리기'], 15], ['낯선 사람과 대화하기', ['말 걸기', '이름 묻기', '연락처 받기'], 20]]
                    : [['Visit two regular shops', ['Stop by the bakery', 'Stop by the flower shop', 'Stop by the bookshop'], 10], ['Walk the rainy street', ['Go out without an umbrella', 'Come back soaked', 'Borrow a towel'], 15], ['Talk to a stranger', ['Say hello', 'Ask their name', 'Get their number'], 20]];
                const out = { quests: q.map(([name, conds, reward]) => ({ name, conds: conds.slice(0, three ? 3 : 2), reward })) };
                if (/ONE penalty quest/.test(sys)) out.penalty = { name: ko ? '가게 앞 쓸기' : 'Sweep the shop front' };
                return JSON.stringify(out);
            }
            return ko ? '{"quests":[{"name":"누군가에게 음료 사 주기","reward":10},{"name":"밖에서 산책하기","reward":15},{"name":"고양이 쓰다듬기","reward":20}]}'
                : '<think>ok</think>{"quests":[{"name":"Buy someone a drink","reward":10},{"name":"Take a walk outside","reward":15},{"name":"Pet a cat","reward":20}]}';
        }
        if (/ONE skill for/.test(sys)) {
            window.__calls.skill = (window.__calls.skill || 0) + 1;
            if (window.__skillFail) return 'no';
            const n = window.__calls.skill;
            const low = /"hidden"/.test(sys);
            const sk = ko ? { name: `골목 지름길 감각 ${n}`, type: n % 2 ? 'active' : 'passive', effect: '쓰면 가장 빠른 골목길이 떠오른다.' } : { name: `Alley Shortcut Sense ${n}`, type: n % 2 ? 'active' : 'passive', effect: 'Used: the quickest alley comes to mind.' };
            if (low) sk.hidden = ko ? '그 길에서 꼭 만나야 할 사람과 마주친다.' : 'On that path you meet someone you needed to meet.';
            return JSON.stringify(sk);
        }
        if (/out of a gacha draw/.test(sys)) {
            window.__calls.drawItem = (window.__calls.drawItem || 0) + 1;
            return ko ? '{"name":"반쯤 녹은 양초","desc":"켜면 잃어버린 기억 하나가 떠오른다.","icon":"star"}' : '{"name":"Half-Melted Candle","desc":"Light it and one lost memory comes back.","icon":"star"}';
        }
        if (/personal shop/.test(sys)) {
            window.__calls.shop++;
            const n = Number(/Make exactly (\d+)/.exec(user)?.[1] || 4);
            const pool = ko
                ? [['호감 머리핀', '첫인상이 조금 좋아진다.', 'rare', 150, 'hairpin'], ['위로의 단팥빵', '나쁜 기분이 조금 풀린다.', 'common', 30, 'bread'], ['여유의 모래시계', '순간이 느려진다.', 'epic', 350, 'hourglass'], ['주머니 비구름', '나한테만 비가 온다.', 'rare', 140, 'cloud'], ['황금 만년필', '오늘 쓴 글은 기억된다.', 'legendary', 900, 'pen'], ['짝 맞는 양말', '다시는 짝을 안 잃는다.', 'common', 20, 'socks']]
                : [['Hairpin of Good Impressions', 'First impressions go a little better.', 'rare', 150, 'hairpin'], ['Sweet Bun of Comfort', 'A bad mood melts a little.', 'common', 30, 'bread'], ['Hourglass of a Spare Moment', 'A moment slows down.', 'epic', 350, 'hourglass'], ['Pocket Rain Cloud', 'It rains only on you.', 'rare', 140, 'cloud'], ['Golden Pen', 'What you write today is remembered.', 'legendary', 900, 'pen'], ['Socks That Always Match', 'Never lose a pair again.', 'common', 20, 'socks']];
            const out = { items: pool.slice(0, n).map(([name, desc, rarity, price, icon], i) => ({ name, desc, rarity, price, icon, limited: i === 3 })) };
            if (/ONE skill book/.test(sys)) out.book = ko ? { name: '빗소리 듣기', type: 'passive', effect: '빗소리에서 작은 소식을 듣는다.', hidden: '빗소리로 먼 곳의 대화를 듣는다.' } : { name: 'Rain Listening', type: 'passive', effect: 'You hear small news in the sound of rain.', hidden: 'The rain carries far-off talk to you.' };
            return JSON.stringify(out);
        }
        return '';
    }
    const ctx = {
        characters, extensionSettings, eventSource, eventTypes, event_types: eventTypes,
        get characterId() { return state.characterId; },
        groupId: null,
        name1: params.get('name') || 'Ari',
        getCurrentLocale: () => params.get('stlocale') || 'en',
        getCurrentChatId: () => (state.characterId === undefined ? undefined : state.chatName),
        get chat() { return state.characterId === undefined ? [] : chat(); },
        get chatMetadata() { return (metas[state.chatName] ||= {}); },
        saveSettingsDebounced: () => localStorage.setItem('sblink_test_settings', JSON.stringify(extensionSettings)),
        setExtensionPrompt: (key, value) => { lastPrompt = value; },
        POPUP_TYPE: { TEXT: 1, CONFIRM: 2 },
        callGenericPopup: async (html) => { window.__lastPopup = html; return window.__confirmAnswer ?? true; },
        ConnectionManagerRequestService: { sendRequest: async (_id, messages) => ({ content: await fakeAI(messages[0].content, messages[1].content) }) },
        generateRaw: async ({ systemPrompt, prompt }) => fakeAI(systemPrompt, prompt),
    };
    window.SillyTavern = { getContext: () => ctx };

    function render() {
        const box = document.getElementById('chat');
        box.innerHTML = '';
        const list = ctx.chat;
        list.forEach((m, i) => {
            if (i < list.length - SHOWN) return;
            const d = document.createElement('div');
            d.className = 'mes';
            d.setAttribute('mesid', String(i));
            d.innerHTML = `<div class="mes_block"><div class="ch_name"><b>#${i} ${m.is_user ? ctx.name1 : m.name}</b></div><div class="mes_text">${m.mes}</div></div>`;
            box.appendChild(d);
        });
        box.scrollTop = box.scrollHeight;
    }

    let replyNo = 0;
    window.__nextReply = null;
    async function generate(type = 'normal') {
        await eventSource.emit(eventTypes.GENERATION_STARTED, type, {}, false);
        sentPrompt = lastPrompt;
        const list = chat();
        const ch = characters[state.characterId];
        const text = window.__nextReply || `Reply ${++replyNo}.`;
        window.__nextReply = null;
        if (type === 'swipe') {
            const i = list.length - 1;
            list[i] = { ...list[i], mes: text, send_date: stamp() };
            render();
            await eventSource.emit(eventTypes.MESSAGE_RECEIVED, i, 'swipe');
            await eventSource.emit(eventTypes.MESSAGE_SWIPED, i);
        } else {
            list.push({ is_user: false, is_system: false, name: ch.name, mes: text, send_date: stamp() });
            render();
            await eventSource.emit(eventTypes.MESSAGE_RECEIVED, list.length - 1, type);
            await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, list.length - 1);
        }
        await eventSource.emit(eventTypes.GENERATION_ENDED, list.length);
    }

    async function send(text) {
        chat().push({ is_user: true, is_system: false, name: ctx.name1, mes: text || '(my message)', send_date: stamp() });
        await eventSource.emit(eventTypes.MESSAGE_SENT, chat().length - 1);
        render();
        await eventSource.emit(eventTypes.USER_MESSAGE_RENDERED, chat().length - 1);
        await generate('normal');
    }

    window.__fakeST = {
        ctx, chats, metas, state, render, generate, send,
        get prompt() { return sentPrompt; },
        get livePrompt() { return lastPrompt; },
        turn: (text, reply) => { if (reply) window.__nextReply = reply; return send(text); },
        swipe: () => generate('swipe'),
        async quiet() { await eventSource.emit(eventTypes.GENERATION_STARTED, 'quiet', {}, false); await eventSource.emit(eventTypes.GENERATION_ENDED, 0); },
        async deleteLast() { chat().pop(); render(); await eventSource.emit(eventTypes.MESSAGE_DELETED, chat().length); },
        async branch() {
            const from = state.chatName;
            state.chatName = `${from} Branch`;
            chats[state.chatName] = structuredClone(chats[from]);
            metas[state.chatName] = { main_chat: from };
            render();
            await eventSource.emit(eventTypes.CHAT_CHANGED, state.chatName);
        },
        async rename(to) {
            const from = state.chatName;
            chats[to] = chats[from]; delete chats[from]; state.chatName = to;
            await eventSource.emit(eventTypes.CHAT_RENAMED, { oldFileName: `${from}.jsonl`, newFileName: `${to}.jsonl` });
            await eventSource.emit(eventTypes.CHAT_CHANGED, to);
        },
        async openChat(name) { state.chatName = name; render(); await eventSource.emit(eventTypes.CHAT_CHANGED, name); },
    };

    window.__boot = () => {
        document.getElementById('btn_turn').onclick = () => { const ta = document.getElementById('send_textarea'); send(ta.value); ta.value = ''; };
        document.getElementById('btn_swipe').onclick = () => generate('swipe');
        document.getElementById('btn_del').onclick = () => window.__fakeST.deleteLast();
        document.getElementById('btn_branch').onclick = () => window.__fakeST.branch();
        render();
    };
})();
