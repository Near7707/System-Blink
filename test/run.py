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
    check(40 < x < 300, f'stays where it was let go (no edge snap by default) ({x:.0f})')
    ev(page, "SillyTavern.getContext().extensionSettings.systemBlink.btnSnap = true")
    box = page.locator('#sblink-fab').bounding_box()
    page.mouse.move(box['x'] + 30, box['y'] + 30); page.mouse.down()
    page.mouse.move(box['x'] + 25, box['y'] + 28)
    page.mouse.move(box['x'] - 20, box['y'] + 40, steps=8); page.mouse.up(); page.wait_for_timeout(200)
    x = page.locator('#sblink-fab').bounding_box()['x']
    check(x < 40 or x > 300, f'with "stick to the edge" on, it sticks to an edge ({x:.0f})')
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
    check(ev(page, "document.querySelectorAll('#sblink-win [data-set=\"goalSuggest\"]').length") == 3, 'goal suggestion: auto / manual / off in ⚙')
    check(ev(page, "document.querySelectorAll('.sblink-panel [data-pset=\"goalSuggest\"] option').length") == 3, 'and in the extension panel')
    check(ev(page, "[...document.querySelectorAll('.sblink-panel .sblink-pbtns')].some(d => d.querySelectorAll('button').length === 2)"), 'paired buttons sit side by side in the panel')
    check('\n' in ev(page, "document.querySelector('.sblink-panel textarea[data-pset=\"world\"]')?.placeholder || ''"), 'world examples are several lines')
    check(not errors, f'no script errors ({errors[:2]})')
    page.close()

if __name__ == '__main__':
    main()
