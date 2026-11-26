# System Blink

*[한국어 설명은 여기](README.ko.md)*

A game-like **System** for SillyTavern roleplay, in the style of Korean system novels.
In the middle of the story, a translucent System window pops up — *"[Daily quests have arrived]"* —
you clear quests in the story, earn points, and spend them in your own **personal shop**.

Stage 1 (this version): the System window, the tutorial, daily quests, the shop, the bag and daily-life mode,
in the **Game** voice.

## Install

SillyTavern → Extensions → *Install extension* → paste:

```
https://github.com/Near7707/System-Blink
```

## How it works

- **Wake the System in a chat.** Tap the floating hexagon button (or *System Blink* in the ✨ wand menu) and press
  *[Wake the System]*. Each chat has its own System: points, bag, quests and tutorial. Other chats are not touched.
- **Tutorial** (once per chat): open the window → clear your first daily quest → buy something → use something.
  Reward: 100P + a Gacha Ticket (draws open in stage 2). You can skip it.
- **Daily quests** (2–3 a day) are short, checkable actions — *"Buy someone a drink"*.
  After each AI reply, one small side request reads the story and judges them. The reason (a quote from the story)
  is shown in the Quests tab. A wrong call? Tap the quest: *Clear by hand* / *Undo clear*.
  If you re-roll or delete that reply, the clear and its points go with it.
- **Shop**: the *Daily* shop (4–6 random, unusual things, restocked every day) and the *Standing* shop
  (everyday items, plus an AI-made set with *[Restock]*). Prices by rarity: Common / Rare / Epic / Legendary.
- **Bag**: *[Use]* an item and the AI hears about it in your next message's reply (and its re-rolls).
- **Daily life**: date, time of day, weather, place and today's plan. The AI check notices changes;
  you can also edit them. When the story moves to another day, a strip above the input box asks
  *"Move to the next day?"* — settling happens once, however many days passed.
- **Log cards**: a small card under a message shows a quest clear or an item use. Screen only.

## Safe by design

- Never writes to character cards, chat files, chat metadata or message text. Everything is kept in extension settings
  (the floating button's place: in this device's browser storage).
- The AI gets a few short lines (quests, bag, daily life, item uses) only for the story reply — not for
  other extensions' background requests. Those lines ask the AI **not** to write System notices itself,
  to keep other status blocks as usual, and never to do your quests for you.
- No slash commands. Switched off, there are no popups, no AI calls and no cards.
- Branch a chat → the System is copied. Rename a chat → it follows.

## Settings

Everything is both in the window's ⚙ page and in SillyTavern's extension settings (same values).
Highlights: point rate, story date / real time as the day basis, how often the story is checked
(every reply / every 3rd / by hand), who sees the System, telling the AI the daily-life fields,
opening chances for quests, a **world note** per chat (used when making quests and items), your own
shop items, a connection profile for the side requests (a cheap, fast model is enough), backup / restore,
and *What was sent*.

## Coming later

Other voices (sponsor, threat) and spectator reactions, sudden and hidden quests, a main goal, gacha and skills,
penalties and difficulty, and more world modes (regression, possession, hunter, martial arts, sentinel,
apocalypse, survival/competition, magic, streamer).

## Test page

`python3 test/server.py` → open `http://localhost:8125/test/index.html?fresh` (fake SillyTavern).
`python3 test/run.py` runs the automatic checks (Playwright + Chrome).

## License

AGPL-3.0
