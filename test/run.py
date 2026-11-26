"""Automatic checks on the fake SillyTavern page (needs Python Playwright + Chrome).

Usage:  python3 test/run.py            (starts its own server)
Screenshots go to test/_shots/ (not committed).
"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '_shots')
PORT = 8126
BASE = f'http://127.0.0.1:{PORT}/test/index.html'
os.makedirs(SHOTS, exist_ok=True)
fails = []


def check(cond, msg):
    print(('  ok  ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def open_page(browser, query='fresh', width=390, height=844):
    page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.goto(f'{BASE}?{query}')
    page.wait_for_function('window.__loaded === true')
    page.wait_for_timeout(200)
    return page, errors


def shot(page, name):
    page.wait_for_timeout(350)
    page.screenshot(path=os.path.join(SHOTS, f'{name}.png'))


def ev(page, js):
    return page.evaluate(js)


def turn(page, text='hello', reply=None, answer=None):
    if answer is not None:
        ev(page, f'window.__checkAnswer = {answer!r}')
    ev(page, f'window.__fakeST.turn({text!r}, {reply!r} || null)' if reply else f'window.__fakeST.turn({text!r})')
    page.wait_for_timeout(1300)


def close_pops(page, n=5):
    for _ in range(n):
        if not ev(page, "!!document.getElementById('sblink-pop')"):
            return
        page.click('#sblink-pop [data-pop="ok"]')
        page.wait_for_timeout(250)


def points(page):
    return ev(page, "(() => { const s = SillyTavern.getContext().extensionSettings.systemBlink; const r = s.chats[SillyTavern.getContext().getCurrentChatId()]; if (!r) return -1; const keys = new Set(SillyTavern.getContext().chat.map(m => 'd:' + m.send_date)); let e = 0; for (const l of r.ledger) if (!l.undone && (l.key == null || keys.has(l.key))) e += l.pts; return e - r.spend.reduce((a, x) => a + x.pts, 0); })()")


def main():
    srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'server.py'), str(PORT)])
    time.sleep(0.8)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            flow(browser, 'en')
            flow(browser, 'ko')
            quests2(browser, 'en')
            quests2(browser, 'ko')
            upgrade(browser)
            long_chat(browser)
            pc(browser)
            button(browser)
            browser.close()
    finally:
        srv.terminate()
    print(f'\n{len(fails)} failed' if fails else '\nall passed')
    sys.exit(1 if fails else 0)


def flow(browser, lang):
    print(f'--- phone flow ({lang})')
    page, errors = open_page(browser, f'fresh&lang={lang}')
    L = lambda n: f'{lang}_{n}'
    check(ev(page, "!!document.getElementById('sblink-fab')"), 'floating button is there')
    page.click('#sblink-fab')
    page.wait_for_timeout(200)
    check(ev(page, "!!document.getElementById('sblink-win')"), 'tap opens the window')
    check(ev(page, "document.getElementById('sblink-fab').hidden"), 'button hides while the window is open')
    shot(page, L('01_room_off'))
    page.click('[data-act="roomOn"]')
    page.wait_for_timeout(500)
    check(ev(page, "!!document.querySelector('#sblink-pop .sblink-hexspin')"), 'awakening popup')
    shot(page, L('02_awaken'))
    page.click('#sblink-pop [data-pop="ok"]')
    page.wait_for_timeout(600)
    check(ev(page, "!!document.querySelector('#sblink-pop .sblink-poplines')"), 'daily quests popup came next')
    shot(page, L('03_quests_popup'))
    close_pops(page)
    shot(page, L('04_quests_tab'))
    page.click('[data-tab="status"]')
    shot(page, L('05_status'))

    # an AI judgment clears a quest; a re-roll takes it back
    page.click('[data-act="close"]')
    turn(page, 'I buy Mira a coffee.', 'Mira smiles as Ari pays for her latte.', 'Q1: YES - "Ari pays for her latte"\nQ2: NO\nQ3: NO\nTIME: morning\nWEATHER: cloudy\nPLACE: café\nDATE: -\nDAYS: 0\nNEXT: -')
    check(points(page) == 10, f'AI clear gives points ({points(page)})')
    check(ev(page, "!!document.querySelector('.mes[mesid=\"2\"] .sblink-card')"), 'log card under the AI reply')
    check(ev(page, "document.querySelectorAll('.sblink-card').length") == 1, 'only one card')
    check('Buy someone a drink' not in ev(page, 'window.__fakeST.livePrompt') and 'Take a walk' in ev(page, 'window.__fakeST.livePrompt') if lang == 'en' else True, 'cleared quest leaves the AI lines')
    shot(page, L('06_card'))
    ev(page, "window.__checkAnswer = 'Q1: NO\\nQ2: NO\\nQ3: NO\\nTIME: -\\nWEATHER: -\\nPLACE: -\\nDATE: -\\nDAYS: 0\\nNEXT: -'")
    ev(page, 'window.__fakeST.swipe()')
    page.wait_for_timeout(1300)
    check(points(page) == 0, f're-roll takes the points back ({points(page)})')
    check(ev(page, "document.querySelectorAll('.sblink-card').length") == 0, 'card goes away with the re-roll')
    page.click('#sblink-fab')
    page.click('#sblink-win [data-tab="quests"]')
    check(ev(page, "!!document.querySelector('.sblink-rerolled')"), 'quest shows "re-rolled, taken back"')
    shot(page, L('07_rerolled'))

    # clear by hand, buy, use
    first = ev(page, "document.querySelector('.sblink-quest').dataset.quest")
    page.click(f'[data-quest="{first}"]')
    page.click(f'[data-clear="{first}"]')
    page.wait_for_timeout(200)
    check(points(page) == 10, 'clear by hand')
    page.click('[data-tab="shop"]')
    page.wait_for_timeout(600)
    shot(page, L('08_shop_daily'))
    page.click('[data-side="standing"]')
    page.click('.sblink-cell >> nth=1')  # energy drink 20P
    shot(page, L('09_shop_pick'))
    check(ev(page, "document.querySelector('[data-act=\"buy\"]').disabled"), 'buy locked when points are short')
    ev(page, "(() => { const r = SillyTavern.getContext().extensionSettings.systemBlink.chats[SillyTavern.getContext().getCurrentChatId()]; r.ledger.push({id:'t',questId:'x',pts:300,key:null}); })()")
    page.click('[data-side="daily"]'); page.click('[data-side="standing"]')
    page.click('.sblink-cell >> nth=1')
    page.click('[data-act="buy"]')
    shot(page, L('10_buy_confirm'))
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(200)
    check(points(page) == 290, f'bought for 20P ({points(page)})')
    page.click('[data-tab="bag"]')
    page.click('.sblink-cell:not(.sblink-cell-blank) >> nth=0')
    shot(page, L('11_bag'))
    page.click('[data-act="use"]')
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(500)
    check(ev(page, "!!document.getElementById('sblink-pop')"), 'use popup')
    close_pops(page)
    page.click('[data-act="close"]')
    turn(page, 'I drink it.', 'Ari feels wide awake.')
    prompt = ev(page, 'window.__fakeST.prompt')
    check(('used the System item' in prompt), 'the AI heard about the item')
    check(ev(page, "!!document.querySelector('.mes[mesid=\"3\"] .sblink-card-mine')"), 'item card under my message')
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1300)
    check('used the System item' in ev(page, 'window.__fakeST.prompt'), 'a re-roll hears about the item again')
    turn(page, 'Next.', 'Okay.')
    check('used the System item' not in ev(page, 'window.__fakeST.prompt'), 'the item note is not repeated later')

    # days: the strip above the input box
    turn(page, 'We sleep.', 'Two days later, Ari wakes up to rain.', 'Q1: NO\nQ2: NO\nTIME: morning\nWEATHER: rain\nPLACE: home\nDATE: -\nDAYS: 2 - "Two days later"\nNEXT: morning')
    check(ev(page, "!!document.getElementById('sblink-strip')"), 'next-day strip shows')
    check(ev(page, "document.querySelector('#sblink-fab .sblink-fabchip').textContent") == '1', 'button chip counts the strip')
    strip_bottom = ev(page, "document.getElementById('sblink-strip').getBoundingClientRect().bottom")
    input_top = ev(page, "document.getElementById('form_sheld').getBoundingClientRect().top")
    check(strip_bottom <= input_top, 'strip sits above the input box')
    shot(page, L('12_strip'))
    page.click('[data-strip="more"]')
    shot(page, L('13_strip_open'))
    page.click('[data-strip="go"]')
    page.wait_for_timeout(800)
    close_pops(page)
    day = ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.chats[SillyTavern.getContext().getCurrentChatId()].day")
    check(day == 3, f'two days on, settled once (day {day})')
    check('2 days have passed' in ev(page, 'window.__fakeST.livePrompt'), 'the AI is told days passed')
    check(not ev(page, "!!document.getElementById('sblink-strip')"), 'strip gone after answering')
    ev(page, 'window.__fakeST.quiet()'); page.wait_for_timeout(200)
    turn(page, 'Go on.', 'Fine.')
    check('2 days have passed' in ev(page, 'window.__fakeST.prompt'), 'a background request did not eat the note')
    turn(page, 'Again.', 'Sure.')
    check('days have passed' not in ev(page, 'window.__fakeST.prompt'), 'the day note is sent once')

    # branch & rename keep the system
    pts = points(page)
    ev(page, 'window.__fakeST.branch()'); page.wait_for_timeout(400)
    check(points(page) == pts, 'a branch copies points')
    check(not ev(page, "!!document.querySelector('#sblink-pop .sblink-hexspin')"), 'no new awakening in the branch')
    ev(page, "window.__fakeST.rename('Renamed chat')"); page.wait_for_timeout(400)
    check(points(page) == pts, 'a rename keeps the data')

    # settings
    page.click('#sblink-fab')
    page.click('[data-act="gear"]')
    shot(page, L('14_gear'))
    page.evaluate("document.querySelector('.sblink-body').scrollTop = 99999")
    shot(page, L('15_gear_bottom'))
    page.click('[data-fold="make"]')
    page.click('[data-text="world"]')
    shot(page, L('16_world_text'))
    page.click('[data-act="back"]')
    page.click('[data-act="back"]')
    check(ev(page, "!!document.querySelector('.sblink-tab-on')"), 'back returns to the tab')
    page.click('[data-tab="status"]')
    shot(page, L('17_status_day3'))
    # the button rows
    page.click('[data-act="gear"]')
    page.click('[data-set="btnShow"]')
    page.wait_for_timeout(200)
    check(ev(page, "document.querySelector('[data-set=\"btnSnap\"]').disabled"), 'button rows lock when the button is off')
    page.click('[data-set="btnShow"]')
    page.click('[data-act="close"]')
    check(ev(page, "!!document.getElementById('sblink-fab') && !document.getElementById('sblink-fab').hidden"), 'button back after closing')
    # long buttons stay one line
    tall = ev(page, "[...document.querySelectorAll('.sblink-btn, .sblink-chip, .sblink-tab')].filter(b => b.offsetHeight > 44).length")
    check(tall == 0, f'no button grows taller ({tall})')
    # extension panel
    page.click('#side_box summary')
    page.wait_for_timeout(200)
    page.locator('#extensions_settings2').screenshot(path=os.path.join(SHOTS, f'{L("18_panel")}.png'))
    # wand item & switching everything off
    if lang == 'en':
        ev(page, "document.querySelector('#sblink_settings [data-run=\"allOff\"]').click()")
    if lang == 'en':
        page.wait_for_timeout(200)
        check(not ev(page, "!!document.getElementById('sblink-fab')"), 'all off removes the button')
        check(ev(page, "document.querySelectorAll('.sblink-card').length") == 0, 'all off removes the cards')
        page.click('#sblink_wand')
        page.wait_for_timeout(200)
        check(ev(page, "!!document.getElementById('sblink-off')"), 'wand shows the offline box')
        shot(page, L('19_offline'))
        page.click('[data-off="on"]')
        page.wait_for_timeout(300)
        check(ev(page, "!!document.getElementById('sblink-fab')"), 'turned on again from the wand')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def room_js(expr):
    return "(() => { const r = SillyTavern.getContext().extensionSettings.systemBlink.chats[SillyTavern.getContext().getCurrentChatId()]; return " + expr + "; })()"


def quests2(browser, lang):
    print(f'--- stage 2-A quests ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&lang={lang}')
    L = lambda n: f'{lang}_2a_{n}'
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]')  # skip the tutorial
    page.wait_for_timeout(500)
    close_pops(page)
    page.click('#sblink-win [data-tab="quests"]')
    check(ev(page, "!!document.querySelector('.sblink-goalnone')"), 'no goal yet: a small line to set one')
    page.click('[data-act="close"]')

    # dice hit: a hidden quest and a sudden quest come with the same check (no extra request)
    sudden = '골목 끝에서 들려온 소리의 정체 확인하기' if ko else 'Find out what made the noise down the alley'
    hidden = '길고양이에게 이름 지어 주기' if ko else 'Give the stray cat a name'
    why = '같은 고양이 앞에서 세 번 멈춰 섰음' if ko else 'Stopped by the same cat three times'
    ev(page, 'window.__sblinkRandom = () => 0')
    ev(page, f"window.__yes([], {('SUDDEN: ' + sudden + ' | 50' + chr(10) + 'HIDDEN: ' + hidden + ' | 120 | ' + why)!r})")
    calls = ev(page, 'window.__calls.check')
    turn(page, 'I walk home.', 'A strange noise comes from the alley. A stray cat watches.')
    check(ev(page, 'window.__calls.check') == calls + 1, 'one check request only')
    check('Also write SUDDEN' in ev(page, 'window.__checkLast'), 'the check asked for a sudden quest')
    ev(page, 'window.__sblinkRandom = () => 0.99')
    check(ev(page, "!!document.querySelector('.sblink-v-hidden')"), 'hidden quest popup (purple)')
    page.wait_for_timeout(1500)
    shot(page, L('01_hidden_popup'))
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(400)
    check(ev(page, "!!document.querySelector('.sblink-v-sudden')"), 'sudden quest popup (orange)')
    shot(page, L('02_sudden_popup'))
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(300)  # accept
    check(ev(page, room_js("r.quests.find(q => q.kind === 'sudden').state")) == 'accepted', 'sudden quest accepted')
    check(('accepted a sudden quest (3 replies left)' in ev(page, 'window.__fakeST.livePrompt')), 'the AI is told about the sudden quest')

    # its time runs: a re-roll gives the reply back
    ev(page, "window.__yes([])")
    turn(page, 'I look around.', 'Nothing there yet.')
    left = lambda: ev(page, "document.querySelector('.sblink-k-sudden .sblink-left') ? document.querySelectorAll('.sblink-k-sudden .sblink-left i.sblink-on').length : -1")
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    check(left() == 2, f'2 replies left ({left()})')
    shot(page, L('03_quests_tab'))
    page.click('[data-act="close"]')
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1300)
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    check(left() == 2, f're-roll: still 2 left ({left()})')
    page.click('[data-act="close"]')
    # clear it on the next reply
    ev(page, f"window.__yes([{sudden[:8]!r}])")
    turn(page, 'I check the alley.', 'It was only a cat knocking a can.')
    st = ev(page, room_js("r.quests.find(q => q.kind === 'sudden').id"))
    check(points(page) == 50, f'sudden quest cleared +50P ({points(page)})')

    # the hidden quest
    ev(page, f"window.__yes([{hidden[:6]!r}])")
    turn(page, 'I call the cat Biscuit.', 'The cat seems to like the name.')
    check(points(page) == 170, f'hidden quest cleared +120P ({points(page)})')

    # a sudden offer whose reply is re-rolled before answering goes away
    ev(page, 'window.__sblinkRandom = () => 0')
    ev(page, f"window.__yes([], {('SUDDEN: ' + ('다시 나타난 그림자 쫓기' if ko else 'Follow the shadow') + ' | 40')!r})")
    ev(page, room_js('r.suddenRest = 0'))
    turn(page, 'Next.', 'A shadow moves.')
    ev(page, 'window.__sblinkRandom = () => 0.99')
    check(ev(page, "!!document.querySelector('.sblink-v-sudden')"), 'another sudden offer')
    ev(page, "window.__yes([])")
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1300)
    check(ev(page, room_js("r.quests.filter(q => q.kind === 'sudden' && q.state === 'offered').length")) == 0, 're-rolled offer is dropped')
    close_pops(page)

    # the main goal: the AI suggests it, I save it
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    page.click('.sblink-goalnone [data-act="goalNew"]'); page.wait_for_timeout(600)
    check(ev(page, "document.querySelector('[data-goal=\"title\"]').value") != '', 'the AI filled the goal')
    shot(page, L('04_goal_edit'))
    page.fill('[data-goal="title"]', ('작은 찻집 지키기' if ko else 'Keep the little tea house'))
    page.click('[data-gtotal="3"]')
    check(ev(page, "document.querySelector('[data-goal=\"title\"]').value") == ('작은 찻집 지키기' if ko else 'Keep the little tea house'), 'typed text kept after a redraw')
    page.click('[data-act="goalSave"]'); page.wait_for_timeout(300)
    check(ev(page, "!!document.querySelector('.sblink-goalbig')"), 'goal page')
    check(ev(page, room_js('r.goal.total')) == 3, '3 stages')
    shot(page, L('05_goal_page'))
    page.click('[data-act="back"]')
    shot(page, L('06_quests_goal'))
    page.click('[data-act="close"]')

    # stage 1 cleared → popup, the AI makes stage 2 (two conditions)
    ev(page, "window.__yes([" + ("'찻집의 단골'" if ko else "'Become a regular'") + "])")
    turn(page, 'I come again.', 'The owner greets you by name now.')
    check(points(page) == 270, f'stage 1 +100P ({points(page)})')
    check(ev(page, "!!document.querySelector('#sblink-pop')"), 'stage popup')
    close_pops(page)
    page.wait_for_timeout(500)
    check(ev(page, room_js("r.quests.filter(q => q.kind === 'goal').length")) == 2, 'stage 2 was made')
    # condition 1 only: no points yet
    c1 = '일을 돕겠다고' if ko else 'Offer to help'
    c2 = '혼자 가게' if ko else 'shop alone'
    ev(page, f"window.__yes([{c1!r}])")
    turn(page, 'Can I help?', 'Sure, says the owner.')
    check(points(page) == 270, f'one condition: no points yet ({points(page)})')
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]'); page.click('[data-act="goalOpen"]')
    check(ev(page, "document.querySelectorAll('.sblink-stage-now .sblink-cond-on').length") == 1, 'condition 1 ticked')
    shot(page, L('07_goal_conds'))
    page.click('[data-act="close"]')
    ev(page, f"window.__yes([{c2!r}])")
    turn(page, 'I watch the shop.', 'You watch the shop alone all day.')
    check(points(page) == 470, f'both conditions: +200P ({points(page)})')
    close_pops(page)
    # a re-roll of the first condition takes the stage back
    tall = 0
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    tall = ev(page, "[...document.querySelectorAll('.sblink-btn, .sblink-chip, .sblink-tab')].filter(b => b.offsetHeight > 44).length")
    check(tall == 0, f'no button grows taller ({tall})')
    page.click('[data-act="gear"]')
    page.evaluate("document.querySelector('.sblink-body').scrollTop = 600")
    shot(page, L('08_gear_quests'))
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def upgrade(browser):
    print('--- old data moves to the new format')
    page, errors = open_page(browser, 'fresh&lang=en')
    old = {'systemBlink': {'format': 1, 'enabled': True, 'lang': 'en', 'langChosen': True, 'chats': {'Mira - 2026-01-01': {
        'on': True, 'lifeMode': True, 'day': 2, 'quests': [{'id': 'q1', 'name': 'Old quest', 'reward': 10, 'day': 2, 'failed': False}],
        'ledger': [{'id': 'l1', 'questId': 'q1', 'pts': 10, 'key': None, 'reason': ''}], 'spend': [], 'bag': [], 'uses': [], 'notes': [], 'checks': [],
        'tutorial': {'state': 'done', 'done': [True, True, True, True], 'rewarded': True}}}}}
    ev(page, f"localStorage.setItem('sblink_test_settings', JSON.stringify({old!r})); localStorage.removeItem('systemBlink.backup.v1')".replace('True', 'true').replace('False', 'false').replace('None', 'null'))
    page.goto(f'{BASE}?x=1'); page.wait_for_function('window.__loaded === true'); page.wait_for_timeout(300)
    check(ev(page, 'SillyTavern.getContext().extensionSettings.systemBlink.format') == 2, 'format 2')
    check(ev(page, room_js('r.quests[0].kind')) == 'daily', 'old quests became daily quests')
    check(points(page) == 10, 'points kept')
    check(ev(page, "JSON.parse(localStorage.getItem('systemBlink.backup.v1')).settings.format") == 1, 'format-1 copy kept before moving')
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    check(ev(page, "!!document.querySelector('.sblink-quest')"), 'old quest shows')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def long_chat(browser):
    print('--- long chat (3000 messages) and the System log')
    page, errors = open_page(browser, 'fresh&lang=en&long=3000')
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(400)
    close_pops(page)
    page.click('[data-act="close"]')
    # lots of records: 1500 clears, 1000 daily-life changes, 600 item uses, on old and new messages
    ev(page, """(() => {
        const c = SillyTavern.getContext(); const r = c.extensionSettings.systemBlink.chats[c.getCurrentChatId()];
        const keys = c.chat.map(m => 'd:' + m.send_date);
        const q = r.quests[0];
        for (let i = 0; i < 1500; i++) r.ledger.push({ id: 'L' + i, questId: q.id, cond: null, pts: 0, key: keys[(i * 2) % 3000], reason: 'old line ' + i, at: i });
        for (let i = 0; i < 1000; i++) r.lifeLog.push({ key: keys[(i * 2 + 2) % 3000], t: i, life: { place: 'street ' + i }, lifeFrom: {} });
        for (let i = 0; i < 600; i++) r.uses.push({ id: 'U' + i, name: 'Warm Tea', rarity: 'common', icon: 'tea', kind: 'item', at: i, key: keys[(i * 2 + 1) % 3000] });
    })()""")
    t_cards = ev(page, """(async () => { const m = await import('/src/ui/pop.js'); const t0 = performance.now(); for (let i = 0; i < 5; i++) m.renderCards(); return (performance.now() - t0) / 5; })()""")
    check(t_cards < 60, f'cards for 100 shown messages: {t_cards:.1f} ms')
    t_pts = ev(page, """(async () => { const m = await import('/src/engine.js'); const t0 = performance.now(); for (let i = 0; i < 5; i++) m.points(); return (performance.now() - t0) / 5; })()""")
    check(t_pts < 60, f'points over 3000 messages: {t_pts:.1f} ms')
    check(ev(page, "document.querySelectorAll('.sblink-card').length") > 30, 'old records still show as cards (more than the last 12)')
    t0 = ev(page, 'performance.now()')
    turn(page, 'Go on.', 'Okay.')
    shot(page, 'long_01_cards')
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="quests"]')
    t_open = ev(page, f'performance.now()') - t0
    check(t_open < 3500, f'a reply + opening the window stays quick ({t_open:.0f} ms incl. waits)')
    # the System log export
    page.click('[data-act="gear"]')
    page.click('[data-fold="data"]')
    with page.expect_download() as d:
        page.click('#sblink-win [data-run="logTxt"]')
    txt = open(d.value.path(), encoding='utf-8').read()
    check('#2999 ' in txt and '[SYS] CLEAR' in txt and 'Used · Warm Tea' in txt, 'text log has messages and System lines')
    check(txt.index('#0 ') < txt.index('[SYS]'), 'System lines sit under their message')
    open(os.path.join(SHOTS, 'long_log.txt'), 'w', encoding='utf-8').write(txt)
    with page.expect_download() as d:
        page.click('#sblink-win [data-run="logJson"]')
    import json
    j = json.load(open(d.value.path(), encoding='utf-8'))
    check(len(j['messages']) == 3002 and any(m['system'] for m in j['messages']), f'json log ({len(j["messages"])} messages)')
    check(not ev(page, "!!document.querySelector('#sblink-win [data-run=\"oldBackup\"]')"), 'a new install keeps no old-data copy')
    shot(page, 'long_02_data')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def pc(browser):
    print('--- PC width')
    page, errors = open_page(browser, 'fresh&lang=en', 1280, 800)
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(400)
    close_pops(page)
    shot(page, 'pc_01_window')
    w = ev(page, "document.getElementById('sblink-win').offsetWidth")
    check(w <= 462, f'PC window keeps its width ({w})')
    sizes = set()
    for tab in ['status', 'shop', 'bag', 'quests']:
        page.click(f'[data-tab="{tab}"]'); page.wait_for_timeout(300)
        sizes.add(ev(page, "document.getElementById('sblink-win').offsetHeight"))
    check(len(sizes) == 1, f'same size on every tab {sizes}')
    page.click('[data-tab="shop"]'); page.wait_for_timeout(500)
    shot(page, 'pc_02_shop')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def button(browser):
    print('--- floating button')
    page, errors = open_page(browser, 'fresh&lang=en')
    box = page.locator('#sblink-fab').bounding_box()
    page.mouse.move(box['x'] + 30, box['y'] + 30)
    page.mouse.down()
    page.mouse.move(box['x'] + 25, box['y'] + 28)  # tiny move: not a drag yet
    page.mouse.move(box['x'] - 150, box['y'] - 200, steps=8)
    check(ev(page, "!!document.getElementById('sblink-fabghost')"), 'ghost left at the old place while dragging')
    shot(page, 'btn_01_dragging')
    page.mouse.up()
    page.wait_for_timeout(200)
    check(not ev(page, "!!document.getElementById('sblink-win')"), 'a drag does not open the window')
    x = page.locator('#sblink-fab').bounding_box()['x']
    check(x < 40 or x > 300, f'sticks to an edge ({x:.0f})')
    y = page.locator('#sblink-fab').bounding_box()
    input_top = ev(page, "document.getElementById('form_sheld').getBoundingClientRect().top")
    check(y['y'] + y['height'] <= input_top, 'stays above the input box')
    # far down → kept above the input box
    box = page.locator('#sblink-fab').bounding_box()
    page.mouse.move(box['x'] + 20, box['y'] + 20); page.mouse.down()
    page.mouse.move(box['x'] + 30, box['y'] + 900, steps=8); page.mouse.up()
    page.wait_for_timeout(200)
    b2 = page.locator('#sblink-fab').bounding_box()
    check(b2['y'] + b2['height'] <= input_top + 1, 'cannot go under the input box')
    # reload: same place
    page.goto(f'{BASE}?lang=en'); page.wait_for_function('window.__loaded === true'); page.wait_for_timeout(200)
    b3 = page.locator('#sblink-fab').bounding_box()
    check(abs(b3['y'] - b2['y']) < 3, f'place kept per device ({b2["y"]:.0f} vs {b3["y"]:.0f})')
    # keyboard: a smaller visual viewport moves it up
    ev(page, """(() => { const ta = document.getElementById('send_textarea'); ta.focus();
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: innerWidth, height: 450, offsetTop: 0, offsetLeft: 0, addEventListener(){} } });
        window.dispatchEvent(new Event('resize')); })()""")
    page.wait_for_timeout(300)
    b4 = page.locator('#sblink-fab').bounding_box()
    check(b4['y'] + b4['height'] <= 450, f'moves above the keyboard ({b4["y"] + b4["height"]:.0f})')
    shot(page, 'btn_02_keyboard')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


if __name__ == '__main__':
    main()
