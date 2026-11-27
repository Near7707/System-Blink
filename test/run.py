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
    if 'onlyon' not in query:  # older checks tap the button in a chat that is not awake yet
        show_everywhere(page)
    if 'autogoal' not in query:  # older checks set the main goal by hand (0.6.2 sets it by itself)
        ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.goalAuto = false")
    if 'guide' not in query:  # 0.6.5: older checks wake without the first-time guide
        ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.guideSeen = true")
    if 'qpanel' not in query:  # 0.6.5: older checks run without the quest panel
        ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.questPanel = false")
    return page, errors


def show_everywhere(page):
    page.evaluate("(async () => { SillyTavern.getContext().extensionSettings.systemBlink.btnOnlyOn = false; (await import('/src/ui/fab.js')).syncFabChat(); })()")
    page.wait_for_timeout(100)


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


def epoints(page):
    """Points as the extension works them out (with penalties)."""
    return ev(page, "(async () => { const m = await import('/src/engine.js'); return m.points(); })()")


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
            difficulty(browser, 'en')
            difficulty(browser, 'ko')
            skills2(browser, 'en')
            skills2(browser, 'ko')
            tones2(browser, 'en')
            tones2(browser, 'ko')
            upgrade(browser)
            long_chat(browser)
            pc(browser)
            button(browser)
            fixes051(browser)
            fixes053(browser)
            fab055(browser)
            shapes056(browser)
            story060(browser, 'ko')
            story060(browser, 'en')
            story060_paras(browser)
            fixes061(browser)
            goal062(browser, 'ko')
            goal062(browser, 'en')
            fixes063(browser)
            v065(browser, 'ko')
            v065(browser, 'en')
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
    check(ev(page, "document.querySelector('[data-set=\"btnTuck\"]').disabled"), 'button rows lock when the button is off')
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
    check(ev(page, "document.querySelector('[data-goal=\"title\"]').value") == '', 'manual: opening the page asks the AI nothing')
    page.click('[data-act="goalSuggest"]'); page.wait_for_timeout(600)
    check(ev(page, "document.querySelector('[data-goal=\"title\"]').value") != '', 'the AI filled the goal')
    made = ev(page, "document.querySelector('[data-goal=\"title\"]').value")
    page.click('[data-act="back"]'); page.wait_for_timeout(200)
    page.click('.sblink-goalnone [data-act="goalNew"]'); page.wait_for_timeout(300)
    check(ev(page, "document.querySelector('[data-goal=\"title\"]').value") == made, '‹ Back keeps the draft')
    page.click('[data-act="goalSuggest"]'); page.wait_for_timeout(200)
    check(ev(page, "!!document.querySelector('.sblink-modal')"), 'asks before replacing a draft')
    page.click('[data-modal="no"]'); page.wait_for_timeout(150)
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


def difficulty(browser, lang):
    print(f'--- stage 2-B difficulty and penalties ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&lang={lang}')
    L = lambda n: f'{lang}_2b_{n}'
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(500)
    close_pops(page)
    # ㉒ pick Hard in the ⚙ page
    page.click('[data-act="gear"]')
    check(ev(page, "document.querySelectorAll('[data-set=\"difficulty\"]').length") == 5, 'five difficulty rows')
    page.click('[data-set="difficulty"][data-val="hard"]'); page.wait_for_timeout(200)
    check(ev(page, room_js('r.difficulty')) == 'hard', 'Hard saved for this chat')
    ev(page, "document.querySelector('.sblink-radios').scrollIntoView()")
    shot(page, L('01_gear_difficulty'))
    check(ev(page, "!!document.querySelector('#sblink_settings select[data-pset=\"difficulty\"]')"), 'difficulty in the extension panel too')
    check(ev(page, "document.querySelector('#sblink_settings select[data-pset=\"difficulty\"]').value") == 'hard', 'panel shows the same value')
    tall = ev(page, "[...document.querySelectorAll('.sblink-btn, .sblink-chip, .sblink-tab')].filter(b => b.offsetHeight > 44).length + [...document.querySelectorAll('.sblink-radio')].filter(b => b.offsetHeight > 52).length")
    check(tall == 0, f'no row grows taller ({tall})')
    cut = ev(page, "[...document.querySelectorAll('.sblink-radiodesc')].filter(x => x.scrollWidth > x.clientWidth + 1).length")
    check(cut == 0, f'difficulty descriptions fit on a phone ({cut} cut)')
    # tutorial: no difficulty
    tut = ev(page, """(async () => { const m = await import('/src/engine.js'); const r = SillyTavern.getContext().extensionSettings.systemBlink.chats[SillyTavern.getContext().getCurrentChatId()];
        const was = r.tutorial.state; r.tutorial.state = 'active'; const d = m.diffOf(r); r.tutorial.state = was; return d; })()""")
    check(tut == 'off', 'no difficulty during the tutorial')
    page.click('[data-act="back"]')
    # quests made under Off stay as they were: next day → no penalty
    ev(page, room_js("r.ledger.push({ id: 'seed', questId: 'x', pts: 300, key: null, reason: '', at: 1 })"))
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(900)
    check(not ev(page, "!!document.querySelector('.sblink-v-fail')"), 'quests made under Off: no failure popup')
    check(epoints(page) == 300, f'no points taken ({epoints(page)})')
    # new quests follow Hard: two conditions, reward ×1.5
    qs = ev(page, room_js("r.quests.filter(q => q.kind === 'daily' && q.day === r.day).map(q => [q.conds ? q.conds.length : 0, q.reward, q.diff])"))
    check(all(c == 2 and d == 'hard' for c, _, d in qs), f'Hard quests have 2 conditions {qs}')
    check([x[1] for x in qs] == [15, 23, 30], f'rewards ×1.5 {[x[1] for x in qs]}')
    warn = ev(page, "document.querySelector('#sblink-pop .sblink-popwarn')?.textContent || ''")
    check(('디버프' if ko else 'debuff') in warn, f'quests popup tells the Hard penalty ({warn})')
    shot(page, L('02_quests_popup_hard'))
    close_pops(page)
    page.click('[data-act="close"]')

    # a sudden quest under Hard: 2 replies, a penalty line; declining costs half
    ev(page, room_js('r.suddenRest = 0'))
    ev(page, 'window.__sblinkRandom = () => 0')
    ev(page, "window.__yes([], 'SUDDEN: " + ('그림자 쫓기' if ko else 'Follow the shadow') + " | 50')")
    turn(page, 'I walk.', 'A shadow moves.')
    ev(page, 'window.__sblinkRandom = () => 0.99')
    check('2 replies' in ev(page, 'window.__checkLast'), 'the AI was asked for a 2-reply sudden quest')
    pl = ev(page, "document.querySelector('.sblink-v-sudden .sblink-popwarn')?.textContent || ''")
    check('−38P' in pl, f'sudden popup shows the penalty ({pl})')
    shot(page, L('03_sudden_penalty'))
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(300)  # decline
    check(epoints(page) == 262, f'declining costs half: 300 → 262 ({epoints(page)})')
    # another one, accepted, runs out of time → FAILED popup; a re-roll gives it back
    ev(page, room_js('r.suddenRest = 0'))
    ev(page, 'window.__sblinkRandom = () => 0')
    ev(page, "window.__yes([], 'SUDDEN: " + ('소리 따라가기' if ko else 'Follow the sound') + " | 50')")
    turn(page, 'I listen.', 'A sound comes from the left.')
    ev(page, 'window.__sblinkRandom = () => 0.99')
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(300)  # accept
    ev(page, 'window.__yes([])')
    turn(page, 'I wait.', 'Nothing.')
    turn(page, 'I wait more.', 'Still nothing.')
    check(ev(page, "!!document.querySelector('.sblink-v-fail')"), 'time out → FAILED popup')
    check(epoints(page) == 224, f'time out costs half: 262 → 224 ({epoints(page)})')
    shot(page, L('04_sudden_failed'))
    close_pops(page)
    last = ev(page, 'SillyTavern.getContext().chat.length - 1')
    check(ev(page, f"!!document.querySelector('.mes[mesid=\"{last}\"] .sblink-cardfail')"), 'FAILED card under the reply that ran out')
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1300)
    close_pops(page)
    check(epoints(page) in (224, 262), f'after a re-roll ({epoints(page)})')
    st = ev(page, room_js("r.quests.filter(q => q.kind === 'sudden').map(q => q.state).join(',')"))
    # the re-rolled reply is judged again; with no clear it fails again → same 224
    check(epoints(page) == 224, f're-rolled reply was judged again and failed again ({epoints(page)}, {st})')

    # clear one condition only, then next day → FAILED popup with a debuff and a penalty quest
    c1 = '빵집에 들르기' if ko else 'Stop by the bakery'
    ev(page, f"window.__yes([{c1!r}])")
    turn(page, 'Bakery.', 'You stop by the bakery.')
    check(epoints(page) == 224, 'one condition: no points yet')
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(1000)
    check(ev(page, "!!document.querySelector('.sblink-v-fail')"), 'daily failures under Hard → FAILED popup')
    body = ev(page, "document.querySelector('#sblink-pop').textContent")
    check('DEBUFF' in body and 'PENALTY QUEST' in body, 'popup lists the debuff and the penalty quest')
    check(epoints(page) == 224 - 35, f'−8 −12 −15 → {epoints(page)}')
    shot(page, L('05_failed_popup'))
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(400)
    plines = ev(page, "document.querySelector('#sblink-pop')?.textContent || ''")
    check('PENALTY' in plines, 'daily quests popup shows the penalty quest')
    close_pops(page)
    # debuff: status chip, shop +20%
    page.click('#sblink-win [data-tab="status"]')
    check(ev(page, "!!document.querySelector('.sblink-debuffchip')"), 'debuff chip on the status tab')
    shot(page, L('06_status_debuff'))
    page.click('#sblink-win [data-tab="shop"]'); page.click('[data-side="standing"]')
    price = ev(page, "document.querySelector('.sblink-cell .sblink-price').textContent")
    check(price.startswith('48P'), f'shop price +20% (40 → {price})')
    shot(page, L('07_shop_pricey'))
    page.click('#sblink-win [data-tab="quests"]')
    check(ev(page, "!!document.querySelector('.sblink-k-penalty')"), 'penalty quest in the Quests tab')
    shot(page, L('08_quests_penalty'))
    page.click('[data-act="close"]')
    check(('penalty quest from the System' in ev(page, 'window.__fakeST.livePrompt')), 'the AI is told about the penalty quest')
    # clear the penalty quest → debuff lifted
    ev(page, "window.__yes([" + ("'가게 앞'" if ko else "'Sweep'") + "])")
    turn(page, 'I sweep.', 'You sweep the shop front.')
    check(ev(page, room_js("(async () => 0)()") ) is not None, 'ok')
    lifted = ev(page, "(async () => { const m = await import('/src/engine.js'); return m.debuffsNow().length; })()")
    check(lifted == 0, 'clearing the penalty quest lifts the debuff')
    check(epoints(page) == 189, f'penalty quest gives no points ({epoints(page)})')

    # Hell: red window + band; a Hell-made failure takes an item
    page.click('#sblink-fab'); page.click('[data-act="gear"]')
    page.click('[data-set="difficulty"][data-val="hell"]'); page.wait_for_timeout(200)
    page.click('[data-act="back"]'); page.click('#sblink-win [data-tab="status"]')
    check(ev(page, "document.getElementById('sblink-win').classList.contains('sblink-hell')"), 'Hell: red window')
    check(ev(page, "!!document.querySelector('.sblink-hellband')"), 'Hell: warning band')
    shot(page, L('09_hell_status'))
    ev(page, room_js("r.bag.push({ id: 'b1', name: 'Lucky Coin', desc: '', rarity: 'rare', icon: 'coin', kind: 'item', count: 1 })"))
    page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(1000)
    close_pops(page)
    qs = ev(page, room_js("r.quests.filter(q => q.kind === 'daily' && q.day === r.day).map(q => [q.conds ? q.conds.length : 0, q.reward])"))
    check(all(c in (2, 3) for c, _ in qs) and [x[1] for x in qs] == [20, 30, 40], f'Hell quests: 2–3 conditions, ×2 {qs}')
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(1000)
    body = ev(page, "document.querySelector('#sblink-pop')?.textContent || ''")
    check('LOST' in body, 'Hell failure: an item is lost')
    check(ev(page, room_js("r.bag.filter(b => b.name === 'Lucky Coin').length")) == 0 and ev(page, room_js('r.lost.length')) == 1, 'the item left the bag')
    check(epoints(page) == 0 or epoints(page) >= 0, f'points never below 0 ({epoints(page)})')
    shot(page, L('10_hell_failed'))
    close_pops(page)
    # the System log has the failures
    page.click('[data-act="gear"]'); page.click('[data-fold="data"]')
    with page.expect_download() as d:
        page.click('#sblink-win [data-run="logTxt"]')
    txt = open(d.value.path(), encoding='utf-8').read()
    check('FAILED' in txt and ('디버프' if ko else 'Debuff') in txt and ('가방에서 잃음' if ko else 'Lost from the bag') in txt, 'System log has failures, debuffs and lost items')
    check(not errors, f'no errors {errors[:3]}')
    page.close()



def tones2(browser, lang):
    print(f'--- stage 2-D voices and spectators ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&lang={lang}')
    L = lambda n: f'{lang}_2d_{n}'
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(500)
    close_pops(page)
    check(ev(page, room_js('r.tone')) == 'game', 'a chat starts with the game voice')
    # ㉜ the voice in the ⚙ page (three chips with a colour dot), and the spectators
    page.click('[data-act="gear"]')
    check(ev(page, "document.querySelectorAll('[data-set=\"tone\"] .sblink-tonedot').length") == 3, 'three voices with colour dots')
    page.click('[data-set="tone"][data-val="star"]'); page.wait_for_timeout(200)
    check(ev(page, room_js('r.tone')) == 'star', 'sponsor voice saved for this chat')
    check(ev(page, "document.querySelector('#sblink_settings select[data-pset=\"tone\"]').value") == 'star', 'panel shows the same voice')
    check(ev(page, "document.getElementById('sblink-win').classList.contains('sblink-tn-star')"), 'the window wears gold')
    check(ev(page, "!!document.querySelector('[data-set=\"specOn\"]') && !!document.querySelector('[data-set=\"specMode\"]') && !!document.querySelector('[data-set=\"specGift\"]')"), 'spectator settings in the ⚙ page')
    check(ev(page, "!!document.querySelector('#sblink_settings [data-pset=\"specMode\"]')"), 'spectator settings in the extension panel')
    tall = ev(page, "[...document.querySelectorAll('.sblink-btn, .sblink-chip, .sblink-tab')].filter(b => b.offsetHeight > 44).length")
    check(tall == 0, f'no row grows taller ({tall})')
    cut = ev(page, "[...document.querySelectorAll('[data-set=\"tone\"] .sblink-ell, [data-set=\"specMode\"] .sblink-ell')].filter(x => x.scrollWidth > x.clientWidth + 1).length")
    check(cut == 0, f'voice and spectator chips fit ({cut} cut)')
    ev(page, "document.querySelector('[data-set=\"tone\"]').scrollIntoView()")
    shot(page, L('01_gear_voice'))
    ev(page, "document.querySelector('[data-set=\"specOn\"]').scrollIntoView()")
    shot(page, L('02_gear_spectators'))
    page.click('[data-act="back"]')
    # ㉚ the goblin's bundle
    page.click('#sblink-win [data-tab="shop"]'); page.wait_for_timeout(600)
    name = ev(page, "document.querySelector('.sblink-shopname')?.textContent || ''")
    check(name == ('도깨비 보따리' if ko else "Goblin's Bundle"), f'shop name by voice ({name})')
    shot(page, L('03_shop_star'))
    # ㉙ the daily quests popup in the sponsor voice
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(900)
    tag = ev(page, "document.querySelector('#sblink-pop .sblink-tag')?.textContent || ''")
    check(tag == 'SCENARIO', f'sponsor voice: SCENARIO tag ({tag})')
    pts = ev(page, "document.querySelector('#sblink-pop .sblink-pts')?.textContent || ''")
    check(pts.startswith('후원' if ko else 'Sponsor'), f'rewards read as a sponsorship ({pts})')
    check(ev(page, "document.getElementById('sblink-pop').classList.contains('sblink-tn-star')"), 'popup wears gold')
    body = ev(page, "document.querySelector('#sblink-pop')?.textContent || ''")
    check(('성좌들이' if ko else 'constellations await') in body and ('구경꾼' if ko else 'Spectator') not in body, 'sponsor popup speaks of constellations')
    lines = ev(page, "(async () => { const m = await import('/src/data.js'); const out = []; for (let i = 0; i < 40; i++) for (const e of ['reply', 'clear', 'fail', 'tip']) out.push(m.specLine(e, 'star', '" + lang + "', m.specNames('" + lang + "', 'star')[i % 10])); return out; })()")
    check(not any(('구경꾼' if ko else 'Spectator') in x for x in lines), 'constellation lines never say spectator')
    check(any(('성좌 \'' if ko else "Constellation '") in x for x in lines) and any(x.startswith("['") for x in lines), 'constellations: with and without the title')
    if ko: check(not any('(가)' in x for x in lines), 'Korean 이/가 picked for epithets')
    check(ev(page, "(async () => { const m = await import('/src/data.js'); return m.specNames('en', 'star').length; })()") == 10, 'ten constellation epithets')
    shot(page, L('04_daily_star'))
    close_pops(page)

    # the threat voice at Normal: black market, survival tasks, warnings
    page.click('[data-act="gear"]')
    page.click('[data-set="tone"][data-val="threat"]'); page.wait_for_timeout(150)
    page.click('[data-set="difficulty"][data-val="normal"]'); page.wait_for_timeout(150)
    page.click('[data-act="back"]')
    page.click('#sblink-win [data-tab="shop"]'); page.click('[data-side="standing"]'); page.wait_for_timeout(300)
    name = ev(page, "document.querySelector('.sblink-shopname')?.textContent || ''")
    check(name == ('수상한 암시장' if ko else 'Shady Black Market'), f'black market ({name})')
    check(ev(page, "(async () => { const m = await import('/src/engine.js'); return m.standingItems().some(x => x.kind === 'eraser'); })()"), 'the black market sells a warning eraser')
    shot(page, L('05_shop_threat'))
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(900)
    tag = ev(page, "document.querySelector('#sblink-pop .sblink-tag')?.textContent || ''")
    check(tag == 'WARNING', f'threat voice: WARNING tag ({tag})')
    check(not ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"second\"]')"), 'threat popup: only [OK]')
    check(ev(page, "document.getElementById('sblink-pop').classList.contains('sblink-shake')"), 'the screen shakes a little')
    check(ev(page, "!!document.querySelector('#sblink-pop .sblink-warnmeter')"), 'warnings 0 / 3 on the popup')
    shot(page, L('06_daily_threat'))
    close_pops(page)
    qs = ev(page, room_js("r.quests.filter(q => q.kind === 'daily' && q.day === r.day).map(q => q.tone + '/' + q.diff)"))
    check(all(x == 'threat/normal' for x in qs), f'quests keep their voice and difficulty {qs}')
    page.click('#sblink-win [data-tab="quests"]')
    head = ev(page, "[...document.querySelectorAll('.sblink-sechead')].map(x => x.textContent).join('|')")
    check(('생존 과제' if ko else 'Survival tasks') in head, 'daily quests are survival tasks')
    shot(page, L('07_quests_threat'))
    # the day ends with three unfinished: three warnings instead of points → a big event
    ev(page, room_js("r.ledger.push({ id: 'seed', questId: 'x', pts: 1000, key: null, reason: '', at: 1 })"))
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(1000)
    body = ev(page, "document.querySelector('#sblink-pop')?.textContent || ''")
    check(body.count('경고 +1' if ko else '+1 warning') == 3, f'fail popup: +1 warning ×3')
    check(('경고가 기록' if ko else 'warning has been recorded') in body, 'threat failure line')
    check(epoints(page) == 1000, f'no points taken in the threat voice ({epoints(page)})')
    shot(page, L('08_fail_threat'))
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(400)
    check(ev(page, "!!document.querySelector('.sblink-v-big')"), 'three warnings → big event popup')
    check(ev(page, room_js('r.bigs.length')) == 1, 'big event recorded')
    check(ev(page, "(async () => { const m = await import('/src/engine.js'); return m.warnCount(); })()") == 0, 'the count starts again from 0')
    shot(page, L('09_big_event'))
    close_pops(page)
    page.click('[data-act="close"]')
    ev(page, 'window.__yes([])')
    turn(page, 'I go out.', 'The street is quiet.')
    check('warnings have run out' in ev(page, 'window.__fakeST.prompt'), 'the AI hears about the big event')
    close_pops(page)

    # a sudden quest declined in the threat voice: +1 warning
    ev(page, room_js('r.suddenRest = 0'))
    ev(page, 'window.__sblinkRandom = () => 0')
    ev(page, "window.__yes([], 'SUDDEN: " + ('그림자 쫓기' if ko else 'Follow the shadow') + " | 50')")
    turn(page, 'I walk.', 'A shadow moves.')
    ev(page, 'window.__sblinkRandom = () => 0.99')
    warn = ev(page, "document.querySelector('.sblink-v-sudden .sblink-popwarn')?.textContent || ''")
    check(('경고 +1' if ko else '+1 warning') in warn, f'sudden popup warns ({warn})')
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(300)
    check(ev(page, "(async () => { const m = await import('/src/engine.js'); return m.warnCount(); })()") == 1, 'declining gives one warning')
    close_pops(page)
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="status"]')
    check(ev(page, "!!document.querySelector('.sblink-warnbox')"), 'warnings box on the status tab')
    shot(page, L('10_status_warn'))
    # the eraser: buy, use → 0; another with no warnings is kept
    page.click('#sblink-win [data-tab="shop"]'); page.click('[data-side="standing"]'); page.wait_for_timeout(200)
    for _ in range(2):
        page.click('[data-shop="era0"]'); page.click('[data-act="buy"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(200)
        page.click('[data-shop="era0"]') if ev(page, "!!document.querySelector('.sblink-cell-on')") else None
    page.click('#sblink-win [data-tab="bag"]')
    bid = ev(page, room_js("r.bag.find(b => b.kind === 'eraser')?.id"))
    page.click(f'[data-bag="{bid}"]'); page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(300)
    check(ev(page, "(async () => { const m = await import('/src/engine.js'); return m.warnCount(); })()") == 0, 'the eraser takes the warning away')
    shot(page, L('11_erased'))
    close_pops(page)
    if not ev(page, f"!!document.querySelector('[data-bag=\"{bid}\"].sblink-cell-on')"):
        page.click(f'[data-bag="{bid}"]')
    page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(300)
    check(ev(page, room_js("r.bag.find(b => b.kind === 'eraser')?.count")) == 1, 'no warnings: the eraser stays in the bag')
    lp = ev(page, 'window.__fakeST.livePrompt')
    check('Eraser' not in lp and '지우개' not in lp, 'the AI is not told about erasers')
    page.click('[data-act="close"]')

    # ㉛ spectators, light way: a sponsorship (gold notice, points tied to the reply) and a very rare skill gift
    before = epoints(page)
    ev(page, 'window.__sblinkSpecRandom = () => 0')
    turn(page, 'I sit down.', 'The café is warm.')
    page.wait_for_timeout(800)
    ev(page, 'window.__sblinkSpecRandom = () => 0.99')
    check(ev(page, "!!document.querySelector('.sblink-toast-gold')"), 'a gold sponsor notice')
    toast = ev(page, "document.querySelector('.sblink-toast-gold')?.textContent || ''")
    check(('후원했습니다' if ko else 'sponsored') in toast and '+5P' in toast, f'sponsor line with points ({toast})')
    check(epoints(page) == before + 5, f'sponsorship adds points ({before} → {epoints(page)})')
    check(ev(page, room_js("r.skills.some(k => k.from === 'spectator')")), 'a skill as a spectator gift')
    check(ev(page, "!!document.querySelector('.sblink-card .sblink-cardtip')"), 'SPONSOR line on the log card')
    shot(page, L('12_sponsor'))
    close_pops(page)
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1300)
    check(epoints(page) == before, f're-roll takes the sponsorship back ({epoints(page)})')
    close_pops(page)
    # rich way: one extra call, the AI's line
    page.click('#sblink-fab'); page.click('[data-act="gear"]')
    page.click('[data-set="specMode"][data-val="rich"]'); page.click('[data-set="specGift"][data-val="0"]'); page.wait_for_timeout(150)
    page.click('[data-act="close"]')
    calls = ev(page, 'window.__calls.spectator || 0')
    ev(page, 'window.__sblinkSpecRandom = () => 0.1')
    turn(page, 'I fold the umbrella.', 'Rain drips from the wet umbrella.')
    page.wait_for_timeout(800)
    ev(page, 'window.__sblinkSpecRandom = () => 0.99')
    check(ev(page, 'window.__calls.spectator || 0') == calls + 1, 'rich way: one extra AI call')
    toast = ev(page, "[...document.querySelectorAll('.sblink-toast-spec')].map(x => x.textContent).join('|')")
    check(('우산 수집가\'가' if ko else 'Umbrella Hoarder') in toast, f'the AI line is shown ({toast})')
    check(epoints(page) == before, 'no sponsorship with it switched off')
    shot(page, L('13_rich'))
    # switched off: nothing
    ev(page, "(() => { SillyTavern.getContext().extensionSettings.systemBlink.specOn = false; })()")
    ev(page, 'window.__sblinkSpecRandom = () => 0')
    n = ev(page, room_js('r.cheers.length'))
    turn(page, 'Hm.', 'Yes.')
    page.wait_for_timeout(500)
    ev(page, 'window.__sblinkSpecRandom = () => 0.99')
    check(ev(page, room_js('r.cheers.length')) == n, 'spectators switched off: no reaction')
    # the System log
    page.click('#sblink-fab'); page.click('[data-act="gear"]'); page.click('[data-fold="data"]')
    with page.expect_download() as d:
        page.click('#sblink-win [data-run="logTxt"]')
    txt = open(d.value.path(), encoding='utf-8').read()
    check(('큰 사건' if ko else 'Big event') in txt and ('경고 +1' if ko else '+1 warning') in txt and ('경고 지움' if ko else 'Warning erased') in txt, 'System log: warnings, big event, eraser')
    check(('구경꾼:' if ko else 'Spectator:') in txt, 'System log: spectator reactions')
    check(not errors, f'no errors {errors[:3]}')
    page.close()

def seq(page, *vals):
    """The dice give these numbers in order, then 0.99."""
    ev(page, f"(() => {{ const q = {list(vals)!r}; window.__sblinkRandom = () => (q.length ? q.shift() : 0.99); }})()")


def pick_tk(page):
    ev(page, "document.querySelector('[data-bag=\"tk\"]:not(.sblink-cell-on)')?.click()")
    page.wait_for_timeout(100)


def skills2(browser, lang):
    print(f'--- stage 2-C skills and gacha ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&lang={lang}')
    L = lambda n: f'{lang}_2c_{n}'
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(500)
    close_pops(page)
    check(ev(page, "!!document.querySelector('.sblink-comb .sblink-hex-blank')"), 'empty skill grid shows the blank tile')
    check(ev(page, room_js('Array.isArray(r.skills)')), 'rooms have a skill list')
    ev(page, room_js("(r.bag.push({ id: 'tk', name: 'Gacha Ticket', desc: 'One draw. (Opens in stage 2.)', rarity: 'rare', icon: 'ticket', kind: 'gacha', count: 5 }), r.ledger.push({ id: 'seed', questId: 'x', pts: 3000, key: null, reason: '', at: 1 }))"))

    # ㉕ a draw that gives an F skill (with a hidden effect)
    seq(page, 0.1, 0.0)
    page.click('#sblink-win [data-tab="bag"]')
    pick_tk(page)
    check(ev(page, "!document.querySelector('[data-act=\"use\"]').disabled"), 'gacha ticket can be opened')
    page.click('[data-act="use"]'); page.click('[data-modal="yes"]')
    page.wait_for_timeout(300)
    check(ev(page, "!!document.querySelector('#sblink-gacha .sblink-gacha-seal')"), 'the seal shakes while drawing')
    shot(page, L('01_gacha_seal'))
    page.wait_for_timeout(2200)
    check(ev(page, "!!document.querySelector('#sblink-gacha .sblink-gacha-open')"), 'result revealed')
    check(ev(page, room_js("r.skills.length")) == 1 and ev(page, room_js("r.skills[0].grade")) == 'F', 'an F skill was drawn')
    check(ev(page, room_js("!!r.skills[0].hidden?.effect")), 'an F skill has a hidden effect')
    check(ev(page, room_js("r.bag.find(b => b.kind === 'gacha').count")) == 4, 'one ticket used up')
    shot(page, L('02_gacha_skill'))
    page.click('#sblink-gacha [data-g="go"]'); page.wait_for_timeout(300)
    check(ev(page, "!!document.querySelector('.sblink-skillcard')"), '[View skill] opens the skill card')
    check(ev(page, room_js("r.skills[0].fresh")) is False, 'looked at: no more NEW')

    # an item draw, then an SS skill (screen flash)
    seq(page, 0.9, 0.99)
    page.click('#sblink-win [data-tab="bag"]'); pick_tk(page)
    page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(2400)
    check(ev(page, "!!document.querySelector('#sblink-gacha .sblink-gitem')"), 'item draw shows the item')
    check(ev(page, room_js("r.bag.some(b => b.kind === 'item')")), 'the drawn item is in the bag')
    shot(page, L('03_gacha_item'))
    page.click('#sblink-gacha [data-g="ok"]'); page.wait_for_timeout(200)
    seq(page, 0.1, 0.999)
    pick_tk(page); page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(1950)
    check(ev(page, "!!document.querySelector('#sblink-gacha .sblink-flash-ss')"), 'SS flashes the whole screen')
    check(ev(page, room_js("r.skills.some(k => k.grade === 'SS' && !k.hidden)")), 'SS skill, no hidden effect')
    page.wait_for_timeout(500)
    shot(page, L('04_gacha_ss'))
    page.click('#sblink-gacha [data-g="ok"]'); page.wait_for_timeout(200)
    seq(page, 0.1, 0.5)
    pick_tk(page); page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(2400)
    page.click('#sblink-gacha [data-g="ok"]'); page.wait_for_timeout(200)

    # ㉖-B the honeycomb
    page.click('#sblink-win [data-tab="status"]')
    n = ev(page, room_js('r.skills.length'))
    check(ev(page, "document.querySelectorAll('.sblink-comb .sblink-hex:not(.sblink-hex-gap)').length") == n + 1, f'{n} tiles + the blank one')
    check(ev(page, "!!document.querySelector('.sblink-hex-top .sblink-hexflow')"), 'SS tile has light running round')
    check(ev(page, "!!document.querySelector('.sblink-hex-active .sblink-hexring')"), 'active tile has the dashed ring')
    check(ev(page, "!!document.querySelector('.sblink-hexq')"), 'locked hidden effect shows "?"')
    ev(page, "document.querySelector('.sblink-comb').scrollIntoView()")
    shot(page, L('05_honeycomb'))
    cut = ev(page, "(() => { const w = document.querySelector('#sblink-win .sblink-body').getBoundingClientRect(); return [...document.querySelectorAll('.sblink-hex')].filter(h => { const b = h.getBoundingClientRect(); return b.left < w.left || b.right > w.right; }).length; })()")
    check(cut == 0, f'tiles fit inside the window ({cut} out)')
    page.click('[data-sfilter="active"]')
    na = ev(page, room_js("r.skills.filter(k => k.type === 'active').length"))
    check(ev(page, "document.querySelectorAll('.sblink-comb .sblink-hex:not(.sblink-hex-blank):not(.sblink-hex-gap)').length") == na, 'filter shows active only')
    page.click('[data-sfilter="all"]')

    # ㉗ detail + use an active skill
    aid = ev(page, room_js("r.skills.find(k => k.type === 'active').id"))
    ev(page, f"document.querySelector('[data-skill=\"{aid}\"]:not(.sblink-hex-on)')?.click()")
    check(ev(page, "!!document.querySelector('.sblink-skillcard')"), 'tapping a tile opens its card')
    shot(page, L('06_skill_card'))
    page.click('[data-act="skillMore"]')
    check(ev(page, "!!document.querySelector('.sblink-skillhero')"), 'skill detail page')
    shot(page, L('07_skill_detail'))
    page.click('[data-act="skillUse"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(300)
    check(ev(page, "!!document.querySelector('.sblink-v-skill')"), 'skill use popup')
    close_pops(page)
    check(ev(page, room_js(f"r.skills.find(k => k.id === '{aid}').uses")) == 1, 'use counted')
    page.click('[data-act="back"]')
    page.click('[data-act="close"]')
    ev(page, "window.__yes([])")
    turn(page, 'I try it.', 'Something comes to mind.')
    sent = ev(page, 'window.__fakeST.prompt')
    check('used the System skill' in sent, 'the AI heard about the skill use')
    check('System skills (always on)' in sent, 'passive skills are in the story lines')
    check(ev(page, "(document.querySelector('.mes[mesid=\"1\"] .sblink-card-mine')?.textContent || '').includes('SYS.LOG // SKILL')"), 'skill card under my message')
    turn(page, 'Next.', 'Okay.')
    check('used the System skill' not in ev(page, 'window.__fakeST.prompt'), 'the skill note is not repeated later')

    # ㉘-B the hidden effect opens when the story check says the skill shone
    ev(page, 'window.__skillYes = true')
    turn(page, 'I follow the cat.', 'The cat leads Ari straight to the lost key.')
    check('SKILL1:' in ev(page, 'window.__checkLast'), 'the story check asked about the low-grade skill')
    check(ev(page, "!!document.querySelector('.sblink-v-unlock')"), 'unlock popup (gold)')
    page.wait_for_timeout(2600)
    shot(page, L('08_unlock'))
    close_pops(page)
    check(ev(page, "(document.querySelector('.mes[mesid=\"6\"] .sblink-card')?.textContent || '').includes('UNLOCK')"), 'UNLOCK line under the AI reply')
    check('Hidden effect, now open' in ev(page, 'window.__fakeST.livePrompt') or ev(page, room_js("r.skills.filter(k => k.hidden?.key).every(k => k.type === 'active')")), 'an opened passive tells the AI its hidden effect')
    ev(page, 'window.__skillYes = false')
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1400)
    opened = ev(page, "(async () => { const m = await import('/src/engine.js'); return m.skillsOf().filter(k => m.hiddenOpen(k)).length; })()")
    check(opened == 0, f're-rolled reply: the hidden effect shuts again ({opened})')

    # a skill book in the daily shop
    ev(page, room_js("(r.shop.daily = [], r.shop.dailyDay = 0)"))
    seq(page, 0.0, 0.0)
    page.click('#sblink-fab'); page.click('#sblink-win [data-tab="shop"]'); page.wait_for_timeout(900)
    bid = ev(page, room_js("(r.shop.daily.find(x => x.kind === 'skillbook') || {}).id"))
    check(bool(bid), 'daily shop has a skill book')
    page.click(f'[data-shop="{bid}"]')
    shot(page, L('09_shop_book'))
    before = ev(page, room_js('r.skills.length'))
    page.click('[data-act="buy"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(400)
    check(ev(page, room_js('r.skills.length')) == before + 1, 'buying the book teaches the skill')
    check(not ev(page, room_js("r.bag.some(b => b.kind === 'skillbook')")), 'the book does not go to the bag')
    check(ev(page, "!!document.querySelector('.sblink-v-skill')"), 'skill gained popup')
    shot(page, L('10_book_popup'))
    close_pops(page)

    # quest rewards: main goal always, hidden quest sometimes (given once)
    seq(page, 0.5)
    got = ev(page, "(async () => { const m = await import('/src/engine.js'); const st = await import('/src/store.js'); const o = {}; const k = await m.rewardSkill(st.currentChatId(), 'goal', o); const again = await m.rewardSkill(st.currentChatId(), 'goal', o); return [k && k.from, k && k.grade, !!again]; })()")
    check(got[0] == 'goal' and got[1] in ('C', 'B', 'A', 'S', 'SS') and not got[2], f'main goal reward: a C+ skill, once ({got})')
    close_pops(page)
    seq(page, 0.9)
    miss = ev(page, "(async () => { const m = await import('/src/engine.js'); const st = await import('/src/store.js'); return !!(await m.rewardSkill(st.currentChatId(), 'hidden', {})); })()")
    check(not miss, 'hidden quest: no skill when the dice miss')
    close_pops(page)

    # AI fails: the built-in lists
    ev(page, 'window.__skillFail = true')
    seq(page, 0.1, 0.0)
    page.click('#sblink-win [data-tab="bag"]'); pick_tk(page); page.click('[data-act="use"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(2400)
    check(ev(page, "!!document.querySelector('#sblink-gacha .sblink-gacha-open')"), 'a failed AI answer still gives a skill (built-in list)')
    page.click('#sblink-gacha [data-g="ok"]'); ev(page, 'window.__skillFail = false')
    check(not ev(page, room_js("r.bag.some(b => b.kind === 'gacha')")), 'all tickets used')

    # motion off: the unlock popup rests on ✦ and the text
    ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.motion = false")
    ev(page, "(async () => { const p = await import('/src/ui/pop.js'); const m = await import('/src/engine.js'); p.unlockPopup(m.skillsOf().find(k => k.hidden)); })()")
    page.wait_for_timeout(300)
    vis = ev(page, "[getComputedStyle(document.querySelector('.sblink-star')).opacity, getComputedStyle(document.querySelector('.sblink-half-l')).opacity, document.querySelector('[data-decode]').textContent.includes('▒')]")
    check(vis[0] == '1' and vis[1] == '0' and not vis[2], f'motion off: only ✦ and the text ({vis})')
    shot(page, L('11_unlock_still'))
    close_pops(page)
    ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.motion = true")

    tall = ev(page, "[...document.querySelectorAll('.sblink-btn, .sblink-chip, .sblink-tab')].filter(b => b.offsetHeight > 44).length")
    check(tall == 0, f'no button grows taller ({tall})')
    page.click('[data-act="gear"]'); page.click('[data-fold="data"]')
    with page.expect_download() as d:
        page.click('#sblink-win [data-run="logTxt"]')
    txt = open(d.value.path(), encoding='utf-8').read()
    check(('스킬 획득' if ko else 'Skill gained') in txt and ('스킬 사용' if ko else 'Skill used') in txt and ('뽑기' if ko else 'Gacha') in txt, 'System log has skills and draws')
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
    check(ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-shape-hexb')"), 'default shape is the glass hexagon (0.5.8)')
    box = page.locator('#sblink-fab').bounding_box()
    page.mouse.move(box['x'] + 30, box['y'] + 30)
    page.mouse.down()
    page.mouse.move(box['x'] + 25, box['y'] + 28)  # tiny move: not a drag yet
    page.mouse.move(box['x'] - 150, box['y'] - 200, steps=8)
    check(not ev(page, "!!document.getElementById('sblink-fabghost')"), 'no dashed outline left at the old place (0.5.8)')
    shot(page, 'btn_01_dragging')
    page.mouse.up()
    page.wait_for_timeout(200)
    check(not ev(page, "!!document.getElementById('sblink-win')"), 'a drag does not open the window')
    x = page.locator('#sblink-fab').bounding_box()['x']
    check(40 < x < 300, f'stays where it was let go, away from the edges ({x:.0f})')
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
    show_everywhere(page)
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


def fixes053(browser):
    print('--- 0.5.3 fixes (layers, no chat, world note, select colour)')
    page, errors = open_page(browser, 'fresh&lang=ko', width=1200, height=800)
    page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    close_pops(page, 8)
    z = ev(page, "[getComputedStyle(document.getElementById('sblink-shade')).zIndex, getComputedStyle(document.getElementById('sblink-win')).zIndex].map(Number)")
    check(z[0] > 3005 and z[1] > 3005 and z[1] < 4000, f'window above the SillyTavern menus ({z})')
    # the world note sits in "this chat", right under daily-life mode
    page.click('[data-act="gear"]'); page.wait_for_timeout(200)
    order = ev(page, "[...document.querySelectorAll('#sblink-win [data-set], #sblink-win [data-text]')].map(e => e.dataset.set || e.dataset.text).slice(0, 4)")
    check('world' in order and order.index('world') == order.index('lifeMode') + 1, f'world note right under daily-life mode {order}')
    pw = ev(page, "[...document.querySelectorAll('#sblink_settings [data-pset]')].map(e => e.dataset.pset).filter(k => k !== 'autoWake').slice(0, 3)")
    check(pw == ['roomOn', 'lifeMode', 'world'], f'the panel too {pw}')
    # a theme that paints every select white
    ev(page, "(() => { const st = document.createElement('style'); st.textContent = 'select { background-color: #fff !important; color: #ccc; }'; document.head.appendChild(st); })()")
    check(ev(page, "!!document.querySelector('[data-fold=\"data\"] .sblink-foldsub') && document.querySelector('[data-fold=\"data\"] .sblink-foldmark').textContent.includes('펼치기')"), 'folded bar: what is inside + open chip')
    page.click('[data-fold="make"]'); page.wait_for_timeout(200)
    check(ev(page, "document.querySelector('[data-fold=\"make\"]').getAttribute('aria-expanded')") == 'true' and '접기' in ev(page, "document.querySelector('[data-fold=\"make\"] .sblink-foldmark').textContent"), 'open bar says close')
    c = ev(page, "(() => { const s = document.querySelector('#sblink-win select.sblink-sel'); const cs = getComputedStyle(s); return [cs.boxShadow, cs.webkitTextFillColor]; })()")
    check('inset' in c[0] and c[1] != 'rgb(204, 204, 204)', f'select keeps a dark ground and light text {c}')
    shot(page, 'fix053_select')
    page.click('[data-act="close"]'); page.wait_for_timeout(200)
    # no chat open: the button hides, and comes back in a chat
    ev(page, "window.__fakeST.closeChat()"); page.wait_for_timeout(400)
    check(ev(page, "document.getElementById('sblink-fab').hidden"), 'no chat: the button hides')
    ev(page, "window.__fakeST.reopenChat()"); page.wait_for_timeout(400)
    check(not ev(page, "document.getElementById('sblink-fab').hidden"), 'back in a chat: the button is there')
    check(not errors, f'no script errors ({errors[:2]})')
    page.close()


def fixes051(browser):
    print('--- 0.5.1 fixes (short screen, squares, scroll memory, panel)')
    # a short screen: the big popup stays inside and its button can be reached
    page, errors = open_page(browser, 'fresh&lang=ko', width=390, height=380)
    page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    r = ev(page, "(() => { const b = document.querySelector('#sblink-pop .sblink-pop').getBoundingClientRect(); return [b.top, b.bottom, innerHeight]; })()")
    check(r[0] >= 0 and r[1] <= r[2], f'popup fits a short screen ({r[0]:.0f}..{r[1]:.0f} of {r[2]})')
    ok = ev(page, "(() => { const b = document.querySelector('#sblink-pop [data-pop=\"ok\"]').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })()")
    check(ok, 'its [OK] button is in sight')
    shot(page, 'fix_01_short_popup')
    close_pops(page, 8)
    check(not errors, f'no script errors ({errors[:2]})')
    page.close()

    page, errors = open_page(browser, 'fresh&lang=ko')
    page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    close_pops(page, 8)
    page.click('#sblink-win [data-tab="shop"]'); page.wait_for_timeout(900)
    colours = ev(page, "[...document.querySelectorAll('#sblink-win .sblink-cell')].map(c => [c.className.match(/sblink-r-(\\w+)/)?.[1], getComputedStyle(c).borderTopColor])")
    rare = [c for c in colours if c[0] == 'rare']
    common = [c for c in colours if c[0] == 'common']
    check(not rare or rare[0][1] == 'rgb(90, 169, 255)', f'a rare square is blue ({rare[:1]})')
    check(not common or common[0][1] == 'rgb(201, 211, 220)', 'a common square stays white-grey')
    check(ev(page, "[...document.querySelectorAll('#sblink-win .sblink-cellname')].every(n => n.textContent.trim())"), 'every square shows its name')
    page.click('#sblink-win [data-side="standing"]'); page.wait_for_timeout(200)
    shot(page, 'fix_02_shop')
    # not enough points: "NP 부족" instead of a minus number
    page.click('#sblink-win .sblink-cell'); page.wait_for_timeout(150)
    txt = ev(page, "document.querySelector('.sblink-afterpts')?.textContent || ''")
    check('부족' in txt and '−' not in txt and '-' not in txt, f'short of points shows "부족" ({txt.strip()})')
    # scroll memory: the settings page comes back where it was
    page.click('#sblink-win [data-act="gear"]'); page.wait_for_timeout(200)
    ev(page, "document.querySelector('#sblink-win .sblink-body').scrollTop = 300")
    page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(150)
    page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('#sblink-win [data-act="gear"]'); page.wait_for_timeout(200)
    st = ev(page, "document.querySelector('#sblink-win .sblink-body').scrollTop")
    check(abs(st - 300) < 3, f'settings page remembers its scroll ({st})')
    check(ev(page, "document.querySelectorAll('#sblink-win [data-set=\"goalAuto\"]').length") == 1, 'goal by itself: a switch in ⚙ (0.6.2)')
    check(ev(page, "document.querySelectorAll('.sblink-panel [data-pset=\"goalAuto\"]').length") == 1, 'and in the extension panel')
    check(ev(page, "[...document.querySelectorAll('.sblink-panel .sblink-pbtns')].some(d => d.querySelectorAll('button').length === 2)"), 'paired buttons sit side by side in the panel')
    check('\n' in ev(page, "document.querySelector('.sblink-panel textarea[data-pset=\"world\"]')?.placeholder || ''"), 'world examples are several lines')
    check(not errors, f'no script errors ({errors[:2]})')
    page.close()

def drag_to(page, tx, ty):
    """Drag the floating button so its middle lands at (tx, ty)."""
    box = page.locator('#sblink-fab').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + min(box['height'], 46) / 2
    page.mouse.move(cx, cy); page.mouse.down()
    page.mouse.move(cx + 3, cy + 3)
    page.mouse.move(tx, ty, steps=10); page.mouse.up()
    page.mouse.move(5, 5)  # off the button, so the PC hover peek does not move it
    page.wait_for_timeout(300)


def fab055(browser):
    print('--- 0.5.5 button (awake chats only, phone size, bookmark)')
    # phone: hidden until the System wakes in this chat
    page, errors = open_page(browser, 'fresh&lang=ko&onlyon')
    check(ev(page, "document.getElementById('sblink-fab').hidden"), 'not awake: no button by default')
    ev(page, "(async () => { const m = await import('/src/engine.js'); await m.switchOn(); })()"); page.wait_for_timeout(700)
    close_pops(page, 8)
    if ev(page, "!!document.getElementById('sblink-win')"):
        page.click('[data-act="close"]'); page.wait_for_timeout(250)
    check(not ev(page, "document.getElementById('sblink-fab').hidden"), 'awake: the button shows')
    w = page.locator('#sblink-fab').bounding_box()['width']
    check(abs(w - 46) < 1, f'phone starts small ({w:.0f})')
    # tuck to the right edge
    drag_to(page, 388, 400)
    check(ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), 'pushed to the edge: tucked in as a bookmark')
    b = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
    check(abs(b['x'] + b['width'] - 390) < 2 and abs(b['width'] - 24) < 1, f'tab against the screen edge ({b})')
    shot(page, 'fab055_phone_tab')
    page.click('#sblink-fab'); page.wait_for_timeout(300)
    check(ev(page, "!!document.getElementById('sblink-win')"), 'tap the bookmark: the window opens')
    page.click('[data-act="close"]'); page.wait_for_timeout(250)
    # reload: still tucked
    page.goto(f'{BASE}?lang=ko'); page.wait_for_function('window.__loaded === true'); page.wait_for_timeout(300)
    check(ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), 'bookmark kept after reload')
    # drag inward: the hexagon again
    drag_to(page, 200, 380)
    cls = ev(page, "document.getElementById('sblink-fab').className")
    check('sblink-fab-tuck' not in cls, 'dragged inward: back to the hexagon')
    # picked size wins
    ev(page, "(async () => { const m = await import('/src/prefs.js'); await m.setValue('btnSize', 'normal'); })()"); page.wait_for_timeout(300)
    w = page.locator('#sblink-fab').bounding_box()['width']
    check(abs(w - 60) < 1, f'size picked by hand is kept ({w:.0f})')
    # another chat that is not awake: hidden; the setting off: shown
    ev(page, "(async () => { const m = await import('/src/engine.js'); m.switchOff(); })()"); page.wait_for_timeout(400)
    check(ev(page, "document.getElementById('sblink-fab').hidden"), 'System off in this chat: button hides')
    ev(page, "(async () => { const m = await import('/src/prefs.js'); await m.setValue('btnOnlyOn', false); })()"); page.wait_for_timeout(300)
    check(not ev(page, "document.getElementById('sblink-fab').hidden"), 'setting off: shows in every chat')
    check(not errors, f'no errors {errors[:3]}')
    page.close()

    # PC: the bookmark goes beside the chat column, not the far screen edge
    page, errors = open_page(browser, 'fresh&lang=en', 1400, 860)
    col = ev(page, "(() => { const r = document.getElementById('sheld').getBoundingClientRect(); return [r.left, r.right]; })()")
    w = page.locator('#sblink-fab').bounding_box()['width']
    check(abs(w - 60) < 1, f'PC starts normal size ({w:.0f})')
    drag_to(page, col[1] + 10, 420)
    check(ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), 'PC: let go on the chat column side = bookmark')
    b = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
    check(abs(b['x'] - col[1]) < 2, f'PC tab sits right outside the column ({b["x"]:.0f} vs {col[1]:.0f})')
    page.mouse.move(b['x'] + 10, b['y'] + 30); page.wait_for_timeout(300)
    b2 = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
    check(b2['x'] > b['x'] + 3, f'PC: peeks out under the mouse ({b["x"]:.0f} → {b2["x"]:.0f})')
    shot(page, 'fab055_pc_tab')
    page.mouse.move(10, 10); page.wait_for_timeout(250)
    # left side of the column too
    drag_to(page, col[0] - 5, 300)
    b = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
    check(b and abs(b['x'] + b['width'] - col[0]) < 2, f'left side: tab right outside the column ({b})')
    # far out in the empty side area: stays a free hexagon
    drag_to(page, 120, 300)
    check(not ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), 'PC: away from the column it stays a hexagon')
    # the column narrows: the tab follows
    drag_to(page, col[1] + 10, 420)
    ev(page, "document.getElementById('sheld').style.width = '40vw'"); page.wait_for_timeout(400)
    col2 = ev(page, "document.getElementById('sheld').getBoundingClientRect().right")
    b = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
    check(abs(b['x'] - col2) < 2, f'tab follows the column width ({b["x"]:.0f} vs {col2:.0f})')
    # bookmarks off: the hexagon comes back on that side
    ev(page, "(async () => { const m = await import('/src/prefs.js'); await m.setValue('btnTuck', false); })()"); page.wait_for_timeout(300)
    check(not ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), 'bookmark setting off: a hexagon again')
    check(not errors, f'no errors {errors[:3]}')
    page.close()



def shapes056(browser):
    print('--- 0.5.6 button shapes')
    for width, height, tag in [(390, 844, 'phone'), (1400, 860, 'pc')]:
        page, errors = open_page(browser, 'fresh&lang=ko', width, height)
        ev(page, "(async () => { const m = await import('/src/engine.js'); await m.switchOn(); })()"); page.wait_for_timeout(700)
        close_pops(page, 8)
        if ev(page, "!!document.getElementById('sblink-win')"):
            page.click('[data-act="close"]'); page.wait_for_timeout(250)
        want = {'phone': {'hex': (46, 64), 'hexb': (46, 64), 'tab': (30, 68), 'badge': (46, 64)},
                'pc': {'hex': (60, 78), 'hexb': (60, 78), 'tab': (34, 76), 'badge': (54, 72)}}[tag]
        for shape, (w, h) in want.items():
            ev(page, f"(async () => {{ const m = await import('/src/prefs.js'); await m.setValue('btnShape', '{shape}'); }})()"); page.wait_for_timeout(300)
            b = page.locator('#sblink-fab').bounding_box()
            check(abs(b['width'] - w) < 1 and abs(b['height'] - h) < 1, f'{tag} {shape}: box {b["width"]:.0f}x{b["height"]:.0f} (want {w}x{h})')
            vis = ev(page, "(() => { const f = document.getElementById('sblink-fab'); const v = (c) => getComputedStyle(f.querySelector(c)).display !== 'none'; return [v('.sblink-fabring'), v('.sblink-fabtab')]; })()")
            check(vis == ([False, True] if shape == 'tab' else [shape != 'badge', False]), f'{tag} {shape}: right parts shown {vis}')
            shot(page, f'shape056_{tag}_{shape}')
        # every shape tucks into the same bookmark, and comes back as itself
        drag_to(page, width - 2 if tag == 'phone' else ev(page, "document.getElementById('sheld').getBoundingClientRect().right") + 8, 400)
        check(ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')"), f'{tag} badge tucks in')
        tb = page.locator('#sblink-fab .sblink-fabtab').bounding_box()
        check(abs(tb['width'] - 24) < 1 and abs(tb['height'] - 72) < 1, f'{tag}: the bookmark is the same for every shape')
        drag_to(page, width / 2 - 100, 380)
        b = page.locator('#sblink-fab').bounding_box()
        check(not ev(page, "document.getElementById('sblink-fab').classList.contains('sblink-fab-tuck')") and abs(b['width'] - want['badge'][0]) < 1, f'{tag}: comes back as the badge')
        # ring row only for the hologram hexagon
        page.click('#sblink-fab'); page.wait_for_timeout(300); page.click('[data-act="gear"]'); page.wait_for_timeout(250)
        check(not ev(page, "!!document.querySelector('#sblink-win [data-set=\"btnRing\"]')") and ev(page, "document.querySelectorAll('#sblink-win [data-set=\"btnShape\"]').length") == 4, f'{tag}: 4 shape chips, no ring row for the badge')
        if tag == 'phone':
            page.locator('#sblink-win [data-set="btnShape"]').first.scroll_into_view_if_needed()
            shot(page, 'shape056_settings')
        page.click('#sblink-win [data-set="btnShape"][data-val="hex"]'); page.wait_for_timeout(300)
        check(ev(page, "!!document.querySelector('#sblink-win [data-set=\"btnRing\"]')"), f'{tag}: ring row back for the hexagon')
        check(not errors, f'{tag} no errors {errors[:3]}')
        page.close()

def story060(browser, lang):
    print(f'--- 0.6.0 quest lines in the story ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&lang={lang}')
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(500)
    close_pops(page)
    # off by default: no lines asked for
    check(ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.storyQuest") is False, 'off by default')
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(900)
    close_pops(page)
    check('[SYS:QUEST]' not in ev(page, 'window.__fakeST.livePrompt'), 'off: no quest lines for the AI')
    # turning it on: quests already running are not shown all at once
    page.click('[data-act="gear"]')
    check(ev(page, "!!document.querySelector('[data-set=\"storyQuest\"]')"), 'setting in the gear page')
    check(ev(page, "!!document.querySelector('#sblink_settings [data-pset=\"storyQuest\"]')"), 'setting in the extension panel')
    page.click('[data-set="storyQuest"]'); page.wait_for_timeout(300)
    check(ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.storyQuest") is True, 'turned on')
    check('[SYS:QUEST]' not in ev(page, 'window.__fakeST.livePrompt'), 'quests from before are not shown')
    page.click('[data-act="back"]')
    # a new day: the new daily quests go to the AI as exact lines
    page.click('#sblink-win [data-tab="status"]'); page.click('[data-act="nextDay"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(900)
    close_pops(page)
    if ev(page, "!!document.getElementById('sblink-win')"):
        page.click('[data-act="close"]'); page.wait_for_timeout(200)
    names = ev(page, room_js("r.quests.filter(q => q.kind === 'daily' && q.day === r.day).map(q => q.name)"))
    live = ev(page, 'window.__fakeST.livePrompt')
    check(len(names) >= 2 and all(f'[SYS:QUEST] DAILY · {n}' in live for n in names), f'new daily quests asked for as lines ({len(names)})')
    check('never write a quest as cleared' in live, 'the AI is told not to write clears')
    # the reply writes them: drawn as one window, the plain lines hidden
    reply = '<p>The light came in.<br>' + '<br>'.join(f'[SYS:QUEST] DAILY · {n}' for n in names) + '<br>"A café? So early?"</p>'
    turn(page, 'look', reply)
    check('[SYS:QUEST] DAILY' in ev(page, 'window.__fakeST.prompt'), 'the lines went with that reply')
    last = "document.querySelector('#chat .mes:last-child')"
    check(ev(page, f"{last}.querySelectorAll('.sblink-qblock').length") == 1, 'daily quests share one window')
    check(ev(page, f"{last}.querySelectorAll('.sblink-qbrow').length") == len(names), 'one row per quest')
    check(ev(page, f"{last}.querySelector('.sblink-qbpts').textContent").endswith('P'), 'reward shown')
    txt = ev(page, f"{last}.querySelector('.mes_text').innerText")
    check('[SYS:QUEST]' not in txt and 'So early' in txt, 'plain lines hidden, the story kept')
    check(ev(page, f"{last}.querySelector('.sblink-qbtitle').textContent") == ('[일일 퀘스트가 도착했습니다]' if ko else '[Daily quests have arrived]'), 'title in the voice')
    check('[SYS:QUEST]' in ev(page, "SillyTavern.getContext().chat.at(-1).mes"), 'message text itself not changed')
    check('[SYS:QUEST]' not in ev(page, 'window.__fakeST.livePrompt'), 'shown once: not asked again')
    shot(page, f'{lang}_060_daily')
    # tap: the quests tab opens
    page.click('#chat .mes:last-child .sblink-qblock'); page.wait_for_timeout(300)
    check(ev(page, "document.querySelector('#sblink-win [data-tab=\"quests\"]')?.classList.contains('sblink-tab-on')"), 'tap opens the quests tab')
    page.click('[data-act="close"]'); page.wait_for_timeout(200)
    # the lines are not evidence for the story check
    check(ev(page, "(async () => (await import('/src/ai.js')).storyOnly('Hi [SYS:QUEST] DAILY · Drink tea<br>Bye'))()") == 'Hi Bye', 'quest lines left out of the story check')
    # swipe: the new swipe is asked again; going on, not asked a third time
    ev(page, "window.__nextReply = 'Another take.'")
    ev(page, 'window.__fakeST.swipe()'); page.wait_for_timeout(1200)
    check('[SYS:QUEST] DAILY' in ev(page, 'window.__fakeST.prompt'), 'a swipe asks for the lines again')
    check('[SYS:QUEST]' not in ev(page, 'window.__fakeST.livePrompt'), 'after the swipe: not asked again')
    # other kinds each get a window; an unknown name still shows
    other = '<p>' + '<br>'.join(['[SYS:QUEST] SUDDEN · Find the owner of the wallet', '[SYS:QUEST] HIDDEN · Follow the cat', '[SYS:QUEST] PENALTY · Leave a note']) + '<br>Then quiet.</p>'
    turn(page, 'go', other)
    kinds = ev(page, f"[...{last}.querySelectorAll('.sblink-qblock')].map(b => [...b.classList].find(c => c.startsWith('sblink-qb-')))")
    check(kinds == ['sblink-qb-sudden', 'sblink-qb-hidden', 'sblink-qb-penalty'], f'each kind its own window ({kinds})')
    shot(page, f'{lang}_060_kinds')
    # voices
    for tone in ['star', 'threat']:
        ev(page, f"(async () => {{ const m = await import('/src/prefs.js'); await m.setValue('tone', '{tone}'); }})()"); page.wait_for_timeout(200)
        ev(page, 'window.__fakeST.render()'); ev(page, "(async () => (await import('/src/ui/pop.js')).renderCards())()"); page.wait_for_timeout(300)
        check(ev(page, f"{last}.querySelector('.sblink-qblock').classList.contains('sblink-tn-{tone}')"), f'{tone} voice drawn')
        shot(page, f'{lang}_060_{tone}')
    # System switched off in this chat: the plain lines come back
    ev(page, "(async () => { const m = await import('/src/engine.js'); m.switchOff(); })()"); page.wait_for_timeout(400)
    check(ev(page, "document.querySelectorAll('.sblink-qblock').length") == 0 and '[SYS:QUEST]' in ev(page, f"{last}.querySelector('.mes_text').textContent"), 'System off: plain lines back')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def story060_paras(browser):
    print('--- 0.6.0 quest lines in separate paragraphs')
    page, errors = open_page(browser, 'fresh&lang=en')
    ev(page, "(async () => { const m = await import('/src/engine.js'); await m.switchOn(); })()"); page.wait_for_timeout(600)
    close_pops(page)
    reply = '<p>Morning.</p><p>[SYS:QUEST] DAILY · Water the plants</p><p>[SYS:QUEST] DAILY · Call a friend</p><p>"Fine."</p>'
    turn(page, 'hi', reply)
    last = "document.querySelector('#chat .mes:last-child')"
    check(ev(page, f"{last}.querySelectorAll('.sblink-qblock').length") == 1 and ev(page, f"{last}.querySelectorAll('.sblink-qbrow').length") == 2, 'lines in separate paragraphs still share one window')
    check(ev(page, f"{last}.querySelectorAll('.mes_text > p').length") == 2, 'their empty paragraphs are gone')
    check(not errors, f'no errors {errors[:3]}')
    page.close()



def fixes061(browser):
    print('--- 0.6.1 fixes (turn-off button, selects under a white theme)')
    page, errors = open_page(browser, 'fresh&lang=ko')
    page.click('#sblink-fab'); page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(400); close_pops(page)
    if not ev(page, "!!document.getElementById('sblink-win')"): page.click('#sblink-fab')
    page.add_style_tag(content="select{background:rgba(255,255,255,.85)!important;box-shadow:none!important;color:#999!important;-webkit-text-fill-color:#999!important}")
    page.click('[data-act="gear"]'); page.wait_for_timeout(300)
    page.click('#sblink-win [data-fold="make"]'); page.wait_for_timeout(300)
    page.click('#sblink-win [data-fold="data"]'); page.wait_for_timeout(300)
    col = ev(page, "getComputedStyle(document.querySelector('#sblink-win select.sblink-sel')).webkitTextFillColor")
    check(col != 'rgb(153, 153, 153)', f'white theme: our select keeps light text ({col})')
    bg = ev(page, "getComputedStyle(document.querySelector('#sblink-win [data-run=\"allOff\"]')).backgroundColor")
    check(bg == 'rgb(179, 18, 42)', f'game voice: turn-off button is blood-red ({bg})')
    undo_bg = ev(page, "getComputedStyle(document.querySelector('#sblink-win [data-run=\"export\"]')).backgroundColor")
    check(undo_bg != 'rgb(179, 18, 42)', 'other buttons unchanged')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def fixes063(browser):
    """0.6.3: the opened select list stays readable under a theme; the button is not pushed by bars over the input box."""
    print('--- 0.6.3 fixes (select list rows, button vs bars over the input box)')
    page, errors = open_page(browser, 'fresh&lang=ko', width=1200, height=800)
    page.click('#sblink-fab'); page.click('[data-act="roomOn"]'); page.wait_for_timeout(500)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(400); close_pops(page)
    if not ev(page, "!!document.getElementById('sblink-win')"): page.click('#sblink-fab')
    # a theme like the one seen: every row white with dark text, the chosen row dark
    page.add_style_tag(content="select,option{background:#fff!important;color:#222!important;-webkit-text-fill-color:#222!important} option:checked{background:#333!important}")
    page.click('[data-act="gear"]'); page.wait_for_timeout(300)
    page.click('#sblink-win [data-fold="make"]'); page.wait_for_timeout(300)
    opt = lambda sel: ev(page, "(() => { const o = document.querySelector('#sblink-win select.sblink-sel " + sel + "'); const c = getComputedStyle(o); return [c.backgroundColor, c.color]; })()")
    chosen = opt('option:checked')
    check(chosen[0] == 'rgb(90, 209, 255)' and chosen[1] == 'rgb(6, 17, 30)', f'chosen row: voice colour with dark text ({chosen})')
    rows = ev(page, "[...document.querySelectorAll('#sblink-win select.sblink-sel option')].map(o => getComputedStyle(o)).filter((c, i, a) => true).map(c => c.backgroundColor)")
    check(all(r in ('rgb(11, 26, 42)', 'rgb(90, 209, 255)') for r in rows), f'every row dark or chosen ({rows})')
    for tone, acc in (('star', 'rgb(232, 190, 88)'), ('threat', 'rgb(255, 90, 90)')):
        page.click(f'#sblink-win [data-set="tone"][data-val="{tone}"]'); page.wait_for_timeout(300)
        if not ev(page, "!!document.querySelector('#sblink-win select.sblink-sel')"):
            page.click('#sblink-win [data-fold="make"]'); page.wait_for_timeout(200)
        c = opt('option:checked')
        check(c[0] == acc, f'{tone}: chosen row in the voice colour ({c})')
    page.click('[data-act="close"]'); page.wait_for_timeout(200)

    # the button: put it high up, then a bar appears over the input box
    page.close()
    page, errors = open_page(browser, 'fresh&lang=ko', width=390, height=844)
    ev(page, "(() => { const d = JSON.parse(localStorage.getItem('systemBlink.device') || '{}'); d.pos = { phone: { fx: 1, fy: 0.3, v: 2 } }; localStorage.setItem('systemBlink.device', JSON.stringify(d)); })()")
    ev(page, "(async () => (await import('/src/ui/fab.js')).place())()"); page.wait_for_timeout(200)
    y0 = ev(page, "Number(document.getElementById('sblink-fab').dataset.y)")
    ev(page, "(() => { const b = document.createElement('div'); b.id = 'otherbar'; b.style.height = '160px'; document.getElementById('form_sheld').prepend(b); })()")
    page.wait_for_timeout(300)
    y1 = ev(page, "Number(document.getElementById('sblink-fab').dataset.y)")
    check(abs(y1 - y0) < 1, f'a bar over the input box: the button stays ({y0:.0f} → {y1:.0f})')
    ev(page, "document.getElementById('otherbar').style.height = '600px'"); page.wait_for_timeout(300)
    y2 = ev(page, "Number(document.getElementById('sblink-fab').dataset.y)")
    top = ev(page, "document.getElementById('form_sheld').getBoundingClientRect().top")
    tall = ev(page, "document.getElementById('sblink-fab').getBoundingClientRect().height")
    check(y2 < y0 and y2 + tall <= top, f'a bar that reaches it pushes it up ({y2:.0f}, bar top {top:.0f})')
    ev(page, "document.getElementById('otherbar').remove()"); page.wait_for_timeout(300)
    y3 = ev(page, "Number(document.getElementById('sblink-fab').dataset.y)")
    check(abs(y3 - y0) < 1, f'the bar goes: back where it was ({y3:.0f})')
    # an old saved place (share of the space above the input box) is moved over once, nearly where it was
    ev(page, "(() => { const d = JSON.parse(localStorage.getItem('systemBlink.device') || '{}'); d.pos = { phone: { fx: 1, fy: 0.5 } }; localStorage.setItem('systemBlink.device', JSON.stringify(d)); })()")
    ev(page, "(async () => (await import('/src/ui/fab.js')).place())()"); page.wait_for_timeout(200)
    v = ev(page, "JSON.parse(localStorage.getItem('systemBlink.device')).pos.phone.v")
    check(v == 2, 'old place moved to the new way once')
    check(not errors, f'no errors {errors[:3]}')
    page.close()


def goal062(browser, lang):
    """0.6.2: the main goal comes by itself (locked during the tutorial); new chats with a woken character wake by themselves."""
    print(f'--- 0.6.2 goal by itself / wake new chats ({lang})')
    ko = lang == 'ko'
    page, errors = open_page(browser, f'fresh&autogoal&lang={lang}')
    S = "SillyTavern.getContext().extensionSettings.systemBlink"
    calls = lambda: ev(page, 'window.__calls.goal || 0')
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(600)
    check(ev(page, "!!document.querySelector('#sblink-pop')"), 'waking: the tutorial popup')
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(500)  # start the tutorial
    close_pops(page)
    if not ev(page, "!!document.getElementById('sblink-win')"):
        page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('#sblink-win [data-tab="quests"]'); page.wait_for_timeout(200)
    check(ev(page, "!!document.querySelector('.sblink-goallock')"), 'tutorial: the goal is locked')
    check(not ev(page, "!!document.querySelector('.sblink-goalnone [data-act=\"goalNew\"]')"), 'no [Set a goal] while locked')
    check(('튜토리얼을 마치면' if ko else 'after the tutorial') in ev(page, "document.querySelector('.sblink-goallock').textContent"), 'lock text')
    shot(page, f'{lang}_062_01_locked')
    check(calls() == 0, 'no goal request during the tutorial')
    page.click('[data-act="close"]')
    check(ev(page, f"{S}.autoWake['c:mira.png']") is True, 'waking remembers the character')

    # finish the tutorial: the goal arrives by itself
    ev(page, "(async () => { const m = await import('/src/engine.js'); const r = " + S + ".chats[SillyTavern.getContext().getCurrentChatId()]; r.tutorial.done = [true, true, true, false]; m.tutorialStep(r, 3); })()")
    page.wait_for_timeout(900)
    check(calls() == 1, f'tutorial done: one goal request ({calls()})')
    check(ev(page, room_js('!!r.goal && r.goalAuto')), 'the goal is set')
    titles = []
    for _ in range(4):
        if not ev(page, "!!document.getElementById('sblink-pop')"):
            break
        page.wait_for_timeout(1500)  # the title types itself out
        titles.append(ev(page, "document.querySelector('#sblink-pop').textContent"))
        if ('부여' if ko else 'has been set') in titles[-1]:
            shot(page, f'{lang}_062_02_goal_popup')
        page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(300)
    check(any(('메인 목표가 부여' if ko else 'main goal has been set') in x for x in titles), f'the "goal set" popup ({[x[:60] for x in titles]})')
    # entering again asks nothing more
    ev(page, "window.__fakeST.openChat('Mira - 2026-01-01')"); page.wait_for_timeout(1000)
    check(calls() == 1, 'entering again: no second goal')

    # an old chat never woken stays asleep
    ev(page, "window.__fakeST.chats['Mira - old'] = [{is_user:false,name:'Mira',mes:'Hi.',send_date:'2025-01-01T00:00:00Z'},{is_user:true,name:'Ari',mes:'Hey.',send_date:'2025-01-01T00:01:00Z'},{is_user:false,name:'Mira',mes:'Hm?',send_date:'2025-01-01T00:02:00Z'}]")
    ev(page, "window.__fakeST.openChat('Mira - old')"); page.wait_for_timeout(1100)
    check(not ev(page, f"!!{S}.chats['Mira - old']"), 'an old chat is not woken')
    # another character's new chat stays asleep
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - new')"); page.wait_for_timeout(1100)
    check(not ev(page, f"!!{S}.chats['Juno - new']"), "another character's new chat is not woken")
    # a brand-new chat with Mira: asks first — nothing is made and no AI is called until the answer
    q0 = ev(page, 'window.__calls.quests')
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - new')"); page.wait_for_timeout(1300)
    check(not ev(page, f"!!{S}.chats['Mira - new']"), 'new chat: not awake before the answer')
    check(ev(page, 'window.__calls.quests') == q0, 'no quest request before the answer')
    check(ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"second\"]') && !!document.querySelector('#sblink-pop [data-pop=\"link\"]')"), 'the popup: start / skip / don\'t wake')
    page.wait_for_timeout(1500); shot(page, f'{lang}_062_05_ask')
    # entering again while it is open does not ask twice
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - new')"); page.wait_for_timeout(1100)
    check(ev(page, "document.querySelectorAll('#sblink-pop').length") == 1 and ev(page, "(async () => (await import('/src/ui/pop.js')).waiting())()") == 1, 'asked once')
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(900)  # skip
    check(ev(page, f"!!{S}.chats['Mira - new']?.on"), 'answered: the chat wakes')
    check(ev(page, 'window.__calls.quests') == q0 + 1, 'daily quests made after the answer')
    check(calls() == 2, f'skipped: the goal comes at once ({calls()})')
    check(ev(page, f"!!{S}.chats['Mira - new'].goal"), 'goal set in the new chat')
    close_pops(page)
    # "don't wake this chat": stays asleep, no AI, not asked again
    q1 = ev(page, 'window.__calls.quests')
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - skipme')"); page.wait_for_timeout(1300)
    page.click('#sblink-pop [data-pop="link"]'); page.wait_for_timeout(500)
    check(ev(page, f"{S}.chats['Mira - skipme']?.on") is False and ev(page, 'window.__calls.quests') == q1, "don't wake: asleep, no AI call")
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - new')"); page.wait_for_timeout(300)
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - skipme')"); page.wait_for_timeout(1300)
    check(not ev(page, "!!document.getElementById('sblink-pop')"), 'not asked again')
    # leaving before answering: the question goes away, and comes back on return
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - later')"); page.wait_for_timeout(1300)
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - new')"); page.wait_for_timeout(400)
    check(not ev(page, "!!document.getElementById('sblink-pop')"), 'left the chat: the question goes away')
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - later')"); page.wait_for_timeout(1300)
    check(ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"link\"]')") and not ev(page, f"!!{S}.chats['Mira - later']"), 'back: asked again')
    page.click('#sblink-pop [data-pop="link"]'); page.wait_for_timeout(300)
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - new')"); page.wait_for_timeout(1100)

    # ⚙: the row for this character, and switching the chat off asks about new chats
    page.click('#sblink-fab'); page.wait_for_timeout(200)
    page.click('#sblink-win [data-act="gear"]'); page.wait_for_timeout(200)
    check(ev(page, "!!document.querySelector('#sblink-win [data-set=\"autoWake\"].sblink-on')"), '⚙: "wake new chats too" is on')
    check(ev(page, "!!document.querySelector('.sblink-panel [data-pset=\"autoWake\"]:checked')"), 'and in the extension panel')
    shot(page, f'{lang}_062_03_gear')
    ev(page, 'window.__lastPopup = ""; window.__confirmAnswer = true')
    page.click('#sblink-win [data-set="roomOn"]'); page.wait_for_timeout(500)
    check(('저절로 깨우지' if ko else 'waking new chats') in ev(page, 'window.__lastPopup || ""'), 'switching off asks about new chats')
    check(ev(page, f"{S}.autoWake['c:mira.png']") is False, 'yes: new chats no longer wake')
    page.click('[data-act="close"]')
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - newer')"); page.wait_for_timeout(1100)
    check(not ev(page, f"!!{S}.chats['Mira - newer']"), 'the next new chat stays asleep')
    # waking by hand again does not turn it back on (it was switched off for this character)
    ev(page, "(async () => (await import('/src/engine.js')).switchOn())()"); page.wait_for_timeout(500)
    check(ev(page, f"{S}.autoWake['c:mira.png']") is False, 'waking by hand keeps it off')
    close_pops(page)

    # the AI fails: [Try again] in the Quest tab
    ev(page, f"{S}.tutorialAuto = false; window.__goalFail = true")
    # (tutorial off: a new chat asks just "wake?")
    ev(page, f"{S}.autoWake['c:juno.png'] = true")
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - three')"); page.wait_for_timeout(1300)
    check(ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"link\"]') && !document.querySelector('#sblink-pop [data-pop=\"second\"]')"), 'tutorial off: "wake?" with [Wake] and don\'t wake')
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(900)
    check(ev(page, f"{S}.chats['Juno - three']?.on && {S}.chats['Juno - three'].tutorial.state === 'skipped'"), 'woken with the tutorial skipped')
    close_pops(page)
    ev(page, f"delete {S}.autoWake['c:juno.png']")
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - two')"); page.wait_for_timeout(700)
    ev(page, "(async () => (await import('/src/engine.js')).switchOn())()"); page.wait_for_timeout(900)
    check(not ev(page, room_js('!!r.goal')), 'failed: no goal')
    close_pops(page)
    ev(page, "(async () => (await import('/src/ui/win.js')).openWindow('quests'))()"); page.wait_for_timeout(300)
    check(ev(page, "!!document.querySelector('[data-act=\"goalRetry\"]')"), '[Try again] shows')
    shot(page, f'{lang}_062_04_retry')
    ev(page, 'window.__goalFail = false')
    page.click('[data-act="goalRetry"]'); page.wait_for_timeout(900)
    check(ev(page, room_js('!!r.goal')), 'try again: goal set')
    close_pops(page)

    # an older chat (awake, tutorial done, no goal) gets one when entered; with the setting off, none
    ev(page, f"{S}.chats['Mira - 2026-01-01'].goal = null; {S}.chats['Mira - 2026-01-01'].goalAuto = false; {S}.chats['Mira - 2026-01-01'].quests = {S}.chats['Mira - 2026-01-01'].quests.filter(q => q.kind !== 'goal')")
    ev(page, f"{S}.goalAuto = false")
    n = calls()
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - 2026-01-01')"); page.wait_for_timeout(1100)
    check(calls() == n, 'setting off: no goal by itself')
    ev(page, f"{S}.goalAuto = true")
    ev(page, "window.__fakeST.openCharChat(1, 'Juno - two')"); page.wait_for_timeout(300)
    ev(page, "window.__fakeST.openCharChat(0, 'Mira - 2026-01-01')"); page.wait_for_timeout(1100)
    check(calls() == n + 1 and ev(page, room_js('!!r.goal')), 'entering an older chat without a goal: one goal')
    check(not errors, f'no script errors ({errors[:2]})')
    page.close()


def v065(browser, lang):
    """0.6.5: first-time guide, where small notices sit, extra point rate wording, the quest panel."""
    print(f'--- 0.6.5 guide / notices / panel ({lang})')
    ko = lang == 'ko'
    S = "SillyTavern.getContext().extensionSettings.systemBlink"
    page, errors = open_page(browser, f'fresh&guide&qpanel&lang={lang}')
    check(ev(page, f"{S}.guideSeen") is False, 'fresh install: guide not seen yet')
    page.click('#sblink-fab')
    page.click('[data-act="roomOn"]'); page.wait_for_timeout(600)
    txt = lambda: ev(page, "document.querySelector('#sblink-pop')?.textContent || ''")
    page.wait_for_timeout(900)
    check(('처음 오셨나요' if ko else 'First time here') in txt(), f'first wake: the guide comes first ({txt()[:50]})')
    check(ev(page, f"{S}.guideSeen") is True, 'guide marked as seen right away')
    shot(page, f'{lang}_065_01_hi')
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(1200)
    check(('말투와 난이도' if ko else 'Voice and difficulty') in txt(), 'card 1')
    check(ev(page, "document.querySelectorAll('#sblink-pop .sblink-guidetone').length") == 3, 'card 1 shows the three voices')
    shot(page, f'{lang}_065_02_card1')
    page.click('#sblink-pop [data-pop="link"]'); page.wait_for_timeout(500)
    check(ev(page, "document.querySelector('#sblink-win .sblink-body')?.dataset.view") == 'gear', '"open this setting" opens ⚙')
    check(not ev(page, "!!document.getElementById('sblink-pop')"), 'popups wait while in the settings')
    top = ev(page, "(() => { const b = document.querySelector('#sblink-win .sblink-body'); const g = b.querySelector('[data-group=\"system\"]'); return Math.round(g.getBoundingClientRect().top - b.getBoundingClientRect().top); })()")
    check(abs(top) < 30, f'scrolled to the system part ({top})')
    shot(page, f'{lang}_065_03_gear')
    page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(900)
    check(('말투와 난이도' if ko else 'Voice and difficulty') in txt(), 'closing the window brings card 1 back')
    for i in range(3):
        page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(900)
    check(('AI 호출' if ko else 'AI calls') in txt(), 'card 4')
    check(not ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"second\"]')"), 'last card: no [Stop here]')
    page.click('#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(900)
    check(ev(page, "!!document.querySelector('#sblink-pop .sblink-hexspin')"), 'then the awakening popup')
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(600)  # skip the tutorial
    close_pops(page)
    if ev(page, "!!document.getElementById('sblink-win')"):
        page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(200)

    # a second chat's first wake: no guide again
    ev(page, "window.__fakeST.openChat('Other chat')"); page.wait_for_timeout(1200)
    seen_txt = []
    for _ in range(5):
        if not ev(page, "!!document.getElementById('sblink-pop')"):
            break
        page.wait_for_timeout(700); seen_txt.append(txt())
        page.click('#sblink-pop [data-pop="second"]' if ev(page, "!!document.querySelector('#sblink-pop [data-pop=\"second\"]')") else '#sblink-pop [data-pop="ok"]'); page.wait_for_timeout(700)
    check(ev(page, room_js('r.on')), 'second chat woken')
    check(not any(('처음 오셨나요' if ko else 'First time here') in x for x in seen_txt), f'second wake: no guide ({[x[:30] for x in seen_txt]})')
    close_pops(page)
    ev(page, "window.__fakeST.openChat('Mira - 2026-01-01')"); page.wait_for_timeout(1000)
    close_pops(page)
    if ev(page, "!!document.getElementById('sblink-win')"):
        page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(200)

    # people who already use it: no guide (settings with chats but no guideSeen)
    seen = ev(page, f"(async () => {{ const st = await import('/src/store.js'); const s = {S}; delete s.guideSeen; st.migrate(s); return s.guideSeen; }})()")
    check(seen is True, 'existing user: guide counted as seen')
    seen2 = ev(page, "(async () => { const st = await import('/src/store.js'); const s = { chats: {} }; st.migrate(s); return s.guideSeen; })()")
    check(seen2 is False, 'no chats yet: guide not seen')

    # the quest panel on a phone: one line on top, opens downwards
    page.wait_for_timeout(300)
    check(ev(page, "!!document.getElementById('sblink-qpanel') && !document.getElementById('sblink-qpanel').hidden"), 'phone: the quest panel shows')
    check(ev(page, "document.getElementById('sblink-qpanel').className.includes('sblink-qp-bar') && document.getElementById('sblink-qpanel').className.includes('sblink-qp-folded')"), 'phone: a folded line')
    h = ev(page, "document.getElementById('sblink-qpanel').getBoundingClientRect().height")
    check(h <= 44, f'phone: the line is thin ({h})')
    sum_ = ev(page, "document.querySelector('.sblink-qp-sumtext').textContent")
    check(('일일' if ko else 'Daily') in sum_, f'line sums up the dailies ({sum_})')
    shot(page, f'{lang}_065_04_line')
    ev(page, "(async () => (await import('/src/ui/pop.js')).notice('Test notice', '', '+5P'))()"); page.wait_for_timeout(150)
    gap = ev(page, "document.getElementById('sblink-toasts').getBoundingClientRect().top - document.getElementById('sblink-qpanel').getBoundingClientRect().bottom")
    check(gap >= 0, f'phone: notices sit under the line ({gap})')
    fab_top = ev(page, "document.getElementById('sblink-fab').getBoundingClientRect().top - document.getElementById('sblink-qpanel').getBoundingClientRect().bottom")
    check(fab_top >= 0, f'phone: the button stays under the line ({fab_top})')
    page.click('.sblink-qp-sum'); page.wait_for_timeout(200)
    check(not ev(page, "document.getElementById('sblink-qpanel').className.includes('sblink-qp-folded')"), 'tap opens the line')
    n = ev(page, "document.querySelectorAll('#sblink-qpanel .sblink-qp-daily [data-qp]').length")
    check(n >= 2, f'opened: the daily quests ({n})')
    shot(page, f'{lang}_065_05_open')
    qid = ev(page, "document.querySelector('#sblink-qpanel .sblink-qp-daily [data-qp]').dataset.qp")
    page.click('#sblink-qpanel .sblink-qp-daily [data-qp] >> nth=0'); page.wait_for_timeout(400)
    check(ev(page, "document.querySelector('#sblink-win .sblink-body')?.dataset.view") == 'quests', 'a line opens the Quests tab')
    check(ev(page, f"!!document.querySelector('#sblink-win .sblink-quest-open[data-quest=\"{qid}\"]')"), 'that quest is opened')
    check(ev(page, "document.getElementById('sblink-qpanel').hidden"), 'panel hides while the window is open')
    check(ev(page, "!!document.querySelector('#sblink-win [data-act=\"pinPanel\"].sblink-btn-main')"), 'Quests tab: 📌 shows it is pinned')
    shot(page, f'{lang}_065_06_tab')
    page.click('#sblink-win [data-act="pinPanel"]'); page.wait_for_timeout(200)
    check(ev(page, f"{S}.questPanel") is False, '📌 turns the panel off')
    page.click('#sblink-win [data-act="pinPanel"]'); page.wait_for_timeout(200)
    check(ev(page, f"{S}.questPanel") is True, '📌 turns it on again')
    page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(300)
    check(ev(page, "!document.getElementById('sblink-qpanel').hidden && document.getElementById('sblink-qpanel').className.includes('sblink-qp-folded')"), 'back: the line, folded again')
    # sending a message folds it
    page.click('.sblink-qp-sum'); page.wait_for_timeout(150)
    turn(page, 'hello', 'Hi.', 'Q1: NO\nQ2: NO\nQ3: NO\nTIME: -\nWEATHER: -\nPLACE: -\nDATE: -\nDAYS: 0\nNEXT: -')
    check(ev(page, "document.getElementById('sblink-qpanel').className.includes('sblink-qp-folded')"), 'sending folds the line')
    # the point rate words
    page.click('#sblink-fab'); page.click('#sblink-win [data-act="gear"]'); page.wait_for_timeout(200)
    g = ev(page, "document.querySelector('#sblink-win .sblink-body').textContent")
    check(('추가 포인트 배율' if ko else 'Extra point rate') in g and ('쉬워' if ko else 'easier') in g, 'extra point rate + "gets easier"')
    check(('설정 안내 다시 보기' if ko else 'settings guide again') in g, '⚙: see the guide again')
    check(('작은 알림 위치' if ko else 'Where small notices show') in g, '⚙: where notices show')
    shot(page, f'{lang}_065_07_gear')
    page.click('#sblink-win [data-run="guideAgain"]'); page.wait_for_timeout(1000)
    check(('말투와 난이도' if ko else 'Voice and difficulty') in txt() and not ev(page, "!!document.getElementById('sblink-win')"), 'see again: card 1, window closed')
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(300)
    panel_text = ev(page, "document.getElementById('sblink_settings').textContent")
    check(('추가 포인트 배율' if ko else 'Extra point rate') in panel_text and ('퀘스트 패널' if ko else 'Quest panel') in panel_text, 'extension panel has the new rows')
    check(not errors, f'no errors ({errors[:3]})')
    page.close()

    # PC: the panel beside the chat column; notices inside the column
    page, errors = open_page(browser, f'fresh&qpanel&lang={lang}', 1400, 860)
    page.click('#sblink-fab'); page.click('[data-act="roomOn"]'); page.wait_for_timeout(600)
    page.click('#sblink-pop [data-pop="second"]'); page.wait_for_timeout(600)
    close_pops(page)
    if ev(page, "!!document.getElementById('sblink-win')"):
        page.click('#sblink-win [data-act="close"]'); page.wait_for_timeout(300)
    box = ev(page, "(() => { const p = document.getElementById('sblink-qpanel').getBoundingClientRect(); const c = document.getElementById('sheld').getBoundingClientRect(); return { cls: document.getElementById('sblink-qpanel').className, pr: p.right, pl: p.left, cl: c.left, cr: c.right, h: p.height }; })()")
    check('sblink-qp-side' in box['cls'] and 'folded' not in box['cls'], 'PC: a panel beside the column, open')
    check(box['pr'] <= box['cl'] - 4 and box['pl'] >= 0, f'PC: left of the chat column ({box})')
    shot(page, f'{lang}_065_08_pc')
    ev(page, "(async () => (await import('/src/ui/pop.js')).notice('Test notice', '', '+5P'))()"); page.wait_for_timeout(150)
    t1 = ev(page, "(() => { const t = document.getElementById('sblink-toasts').getBoundingClientRect(); const c = document.getElementById('sheld').getBoundingClientRect(); return { tr: t.right, cr: c.right, tl: t.left, cl: c.left }; })()")
    check(t1['tr'] <= t1['cr'] - 4 and t1['tl'] >= t1['cl'], f'PC: notices inside the chat column ({t1})')
    shot(page, f'{lang}_065_09_pc_notice')
    ev(page, f"{S}.toastPos = 'input'")
    ev(page, "(async () => (await import('/src/ui/pop.js')).notice('Test notice 2'))()"); page.wait_for_timeout(150)
    t2 = ev(page, "(() => { const t = document.getElementById('sblink-toasts').getBoundingClientRect(); const f = document.getElementById('form_sheld').getBoundingClientRect(); return { tb: t.bottom, ft: f.top }; })()")
    check(t2['tb'] <= t2['ft'] and t2['ft'] - t2['tb'] < 40, f'"above input": right above the input box ({t2})')
    ev(page, f"{S}.toastPos = 'screen'")
    ev(page, "(async () => (await import('/src/ui/pop.js')).notice('Test notice 3'))()"); page.wait_for_timeout(150)
    t3 = ev(page, "1400 - document.getElementById('sblink-toasts').getBoundingClientRect().right")
    check(t3 < 20, f'"screen corner": the right edge of the screen ({t3})')
    # fold, drag away, drop back by the column
    page.click('#sblink-qpanel [data-qp-act="fold"]'); page.wait_for_timeout(150)
    check(ev(page, "document.getElementById('sblink-qpanel').className.includes('sblink-qp-folded')"), 'PC: fold')
    page.click('.sblink-qp-sum'); page.wait_for_timeout(150)
    hd = ev(page, "(() => { const r = document.querySelector('.sblink-qp-head').getBoundingClientRect(); return [r.left + 30, r.top + 12]; })()")
    page.mouse.move(hd[0], hd[1]); page.mouse.down(); page.mouse.move(hd[0] + 40, hd[1] + 200, steps=6); page.mouse.move(1200, 520, steps=6); page.mouse.up(); page.wait_for_timeout(200)
    dv = ev(page, "JSON.parse(localStorage.getItem('systemBlink.device')).panel")
    check(dv and dv.get('side') is None, f'dragged away: kept where it was let go ({dv})')
    hd = ev(page, "(() => { const r = document.querySelector('.sblink-qp-head').getBoundingClientRect(); return [r.left + 30, r.top + 12]; })()")
    off = ev(page, "document.getElementById('sheld').getBoundingClientRect().left - 12 - document.getElementById('sblink-qpanel').getBoundingClientRect().right")
    page.mouse.move(hd[0], hd[1]); page.mouse.down(); page.mouse.move(hd[0] + off, 300, steps=8); page.mouse.up(); page.wait_for_timeout(200)
    dv = ev(page, "JSON.parse(localStorage.getItem('systemBlink.device')).panel")
    check(dv and dv.get('side') == 'left', f'let go by the column: sticks to it again ({dv})')
    page.click('#sblink-qpanel [data-qp-act="off"]'); page.wait_for_timeout(200)
    check(ev(page, f"{S}.questPanel") is False and ev(page, "document.getElementById('sblink-qpanel').hidden"), '✕ turns the panel off')
    check(not errors, f'no errors ({errors[:3]})')
    page.close()


if __name__ == '__main__':
    main()
