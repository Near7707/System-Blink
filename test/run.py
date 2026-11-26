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
    page.click('[data-tab="quests"]')
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
