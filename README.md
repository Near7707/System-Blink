# System Blink

*[한국어 설명은 여기](README.ko.md)*

A game-like **System** for SillyTavern roleplay, in the style of Korean system novels.
In the middle of the story, a translucent System window pops up — *"[Daily quests have arrived]"* —
you clear quests in the story, earn points, and spend them in your own **personal shop**.

This version (0.6.6): the System window, the tutorial, daily quests, the shop, the bag and daily-life mode,
sudden quests, hidden quests, a main goal, quests with several conditions, **difficulty with penalties**,
**skills and gacha**, **three System voices** with **spectators** who react and sponsor — and, if you like, **new quests shown in the story**.
A **quest panel** keeps the quests in progress in sight while you chat (beside the chat on a PC, one line on top on a phone),
and a short **settings guide** greets you the first time you wake the System.

## Install

SillyTavern → Extensions → *Install extension* → paste:

```
https://github.com/Near7707/System-Blink
```

## How it works

- **Wake the System in a chat.** Open *System Blink* in the ✨ wand menu and press *[Wake the System]*.
  Each chat has its own System: points, bag, quests and tutorial. Other chats are not touched.
  After that, **a new chat with the same character (or group) offers to wake by itself**: start or skip the tutorial, or *Don’t wake this chat*
  (nothing is made and no AI is called until you answer).
  Chats you already have stay as they are. Turn it off in ⚙ › *Wake new chats with this character too*, or say yes when you switch a chat off.
  From then on a floating hexagon button opens it in that chat. Let go of the button against the side of the chat
  and it tucks in as a small bookmark tab; drag it inward to bring it back.
- **Tutorial** (once per chat): open the window → clear your first daily quest → buy something → use something.
  Reward: 100P + a Gacha Ticket. You can skip it.
- **Daily quests** (2–3 a day) are short, checkable actions — *"Buy someone a drink"*.
  After each AI reply, one small side request reads the story and judges them. The reason (a quote from the story)
  is shown in the Quests tab. A wrong call? Tap the quest: *Clear by hand* / *Undo clear*.
  If you re-roll or delete that reply, the clear and its points go with it.
- **Sudden quests**: after each reply the dice may bring one — *"[A sudden quest has appeared]"* —
  with a limit of a few replies (3, or set by the difficulty). *[Accept]* or *[Decline]*. It comes in the same story-check request (no extra call).
  A re-rolled reply gives its reply back to the count.
- **Hidden quests**: now and then the check looks for something you did by chance and opens a purple hidden quest.
  No time limit, no penalty.
- **New quests in the story** (off by default): when a quest arrives — daily quests, an accepted sudden quest, a hidden quest,
  a new main-goal stage, a penalty quest — the AI writes a short `[SYS:QUEST] …` line in its next reply. On screen the line is
  drawn as a small System window in your voice's colours (daily quests share one, with their rewards). Tap it to open your quests.
  The message text keeps the plain line; the story check ignores these lines; a swiped reply asks for them again.
- **Main goal**: one big goal per chat in 3–5 stages. It is locked during the tutorial; when the tutorial ends (or is skipped), the System
  sets one by itself from the character card and the story — once per chat (*[Edit goal]* changes any line). You can also write one,
  or ask the AI on the *[Set a goal]* page;
  each next stage is made from the story when you clear the one before. A stage may have two conditions —
  each is checked on its own, and the points come when both are done.
- **Difficulty** (each chat its own; *Off* by default = as before): *Easy* / *Normal* / *Hard* / *Hell*.
  It changes how hard quests are, their rewards (×0.8 / ×1 / ×1.5 / ×2) and penalties — not the mood, which still
  comes from the story, and not how strictly the AI judges. Hard quests have 2 conditions, Hell 2–3; sudden quests get less time.
  - From *Normal*: a daily quest not cleared by the next day, or a sudden quest declined or out of time, costs half its reward.
  - *Hard*: also a debuff — *[Rip-off] shop prices +20%* until the next day — and a penalty quest that lifts it (no reward).
  - *Hell*: also one random thing leaves your bag. The window turns red.
  - Points never go below 0. A re-rolled reply that revives a sudden quest gives its points back.
    New quests follow the difficulty; quests you already have keep theirs. No difficulty during the tutorial.
- **Shop**: the *Daily* shop (4–6 random, unusual things, restocked every day) and the *Standing* shop
  (everyday items, plus an AI-made set with *[Restock]* — 10P, paid only when the new set comes). Prices by rarity: Common / Rare / Epic / Legendary.
- **Bag**: *[Use]* an item and the AI hears about it in your next message's reply (and its re-rolls).
- **Skills**: grades F → S, and **SS** above S (very rare). *Passive* skills are always on — the AI knows them in every
  reply and lets them show when they fit. *Active* skills are used with *[Use]* (no cooldown, no mana); the AI hears about it
  with your next message. No stats, no numbers. They sit in the Status tab as a honeycomb; tap one for its card, *[Details]* for its page.
  - Where they come from: a **Gacha Ticket** (*Bag → [Open]*: a skill or an item, often something odd; S and SS flash the screen),
    a **skill book** in the daily shop now and then (learned at once), the main goal (always) and hidden quests (sometimes).
  - **Hidden effects**: low-grade (F·E) skills hide a better use. When the story check sees the skill shine in the story,
    it opens — the grade stays, only the effect is added. A re-rolled reply shuts it again.
  - The grade is rolled by the extension; the AI only writes a skill that fits it. Skills do not depend on the difficulty.
- **Voice** (each chat its own): the System's colours and words. Point rules stay the same.
  - **Game** — blue hologram, curt game notices (as before).
  - **Sponsor** — gold. Daily quests are *"[The constellations await today's show]"*, rewards read as *"Sponsor 10P"*,
    and the shop is a **Goblin's Bundle**. The spectators become **constellations** with epithets
    like *"One Who Counts the Night Sky"*.
  - **Threat** — red, the screen shakes a little. Daily quests are *survival tasks*, the shop is a **Shady Black Market**.
    From *Normal* difficulty a failure gives a **warning** instead of losing points (Hard / Hell debuffs and lost items stay).
    **Three warnings set off a big event**: the AI is told once that something dangerous happens in the story, and the count
    starts again. The black market sells a *Warning Eraser* (−1 warning). A big event cannot be undone.
- **Spectators** (on/off): now and then a small notice in the top right — *"[Someone finds your choice interesting]"*.
  *Light* uses ready-made lines (no AI call); *Rich* lets the AI write a line about the scene (one extra call when a spectator reacts).
  Spectators sometimes **sponsor** 5–30P (a gold notice; the points go with that reply if you re-roll it), and very rarely
  send a skill (F–C). They never appear in the story.
- **Daily life**: date, time of day, weather, place and today's plan. The AI check notices changes;
  you can also edit them. When the story moves to another day, a strip above the input box asks
  *"Move to the next day?"* — settling happens once, however many days passed.
- **Log cards**: a small card under a message shows a quest clear (or a sudden quest that ran out), a daily-life change, an opened hidden effect, a sponsorship, or an item / skill use. Screen only.
  Every record is kept, so old messages keep their cards too.
- **Chat with the System log**: *Data → Chat with the System log* downloads the whole chat in order, with what the
  System did under each message (.txt or .json). It only makes a new file — the chat itself is not changed.

## Safe by design

- Never writes to character cards, chat files, chat metadata or message text. Everything is kept in extension settings
  (the floating button's place: in this device's browser storage).
- The AI gets a few short lines (quests, bag, skills, daily life, item and skill uses) only for the story reply — not for
  other extensions' background requests. Those lines ask the AI **not** to write System notices itself
  (only the quest lines, if you turned that on — never clears, rewards or points),
  to keep other status blocks as usual, and never to do your quests for you.
- No slash commands. Switched off, there are no popups, no AI calls and no cards.
- Branch a chat → the System is copied. Rename a chat → it follows.
- Updating from 0.1: saved data moves to the new format by itself. A copy of the old data is kept first in this
  device's browser storage (*Data → Data from before 0.2* downloads it).

## Settings

Everything is both in the window's ⚙ page and in SillyTavern's extension settings (same values).
Highlights: voice and difficulty (per chat), spectators (on/off, light / rich, sponsorships), an extra point rate (on top of the difficulty reward), the quest panel, where small notices show (chat column / above the input box / screen corner), story date / real time as the day basis, how often the story is checked
(every reply / every 3rd / by hand), who sees the System, telling the AI the daily-life fields,
opening chances for quests, how often sudden quests come (and the rest after one), hidden quests on/off, new quests in the story,
getting the main goal by itself, a **world note** per chat (used when making quests and items), your own
shop items, a connection profile for the side requests (a cheap, fast model is enough), backup / restore,
and *What was sent*.

## Coming later

More world modes (regression, possession, hunter, martial arts, sentinel,
apocalypse, survival/competition, magic, streamer).

## Test page

`python3 test/server.py` → open `http://localhost:8125/test/index.html?fresh` (fake SillyTavern).
`python3 test/run.py` runs the automatic checks (Playwright + Chrome).

## License

AGPL-3.0
