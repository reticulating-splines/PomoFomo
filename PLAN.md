# PomoFomo — Design & Architecture (v2)

## Purpose
A Chrome extension that helps kids aged 8–11 **take real breaks** during
screen time. A friendly character keeps time in a pinned tab, warns before a
break, calls the kid away from the screen, suggests something to do, and
rewards every break taken in full with something for their bookcase. No lockout and no content scripts: the kid
stays in charge, and the extension only needs `alarms`, `storage`, `tabs` and
`notifications`.

---

## Files

```
PomoFomo/
├── manifest.json
├── background.js              ← service worker: ALL timer authority lives here
├── shared/
│   ├── constants.js           ← enums, characters, defaults, timing knobs
│   ├── storage.js             ← chrome.storage wrappers
│   ├── timing.js              ← pure helpers: remaining time, progress, stats, rewards
│   ├── break-ideas.js         ← off-screen break suggestions (+ one per buddy)
│   ├── bookcase.js            ← draws the bookcase SVG from the shelf
│   └── tokens.css             ← fonts, colour tokens, buttons (both pages)
├── characters/
│   ├── character.js           ← controller: inject SVG, toggle one state class
│   ├── ember.svg / ember.css  ← Ember the dragon (reward: books)
│   ├── page.svg / page.css    ← Page the book (reward: books)
│   ├── yumyumnia.svg / .css   ← Yumyumnia the elf wizard (reward: fireballs),
│   │                            from an 8-year-old's drawing
│   └── otho.svg / otho.css    ← Otho S.B. (reward: spoons), hidden
├── timer/                     ← the pinned tab (main experience)
│   ├── timer.html / timer.css / timer.js
├── popup/                     ← toolbar remote for grown-ups
│   ├── popup.html / popup.css / popup.js
├── sounds/sounds.js           ← Web Audio synthesis, no audio files
├── favicon/favicon.js         ← per-tick progress favicon
└── assets/
    ├── sprite.svg             ← UI icons, rewards, bookcase, break-idea illustrations
    ├── fonts/                 ← Fredoka + Nunito variable woff2 (OFL)
    └── icons/                 ← icon.svg (128 tile), icon-small.svg (16/32), PNGs
```

---

## Architecture

- **chrome.storage is the single source of truth.** The service worker is the
  only writer of runtime state and writes each phase transition (including
  its log entry) as ONE atomic `set()`. Pages render from storage on load and
  subscribe via `chrome.storage.onChanged`; the SW never pushes messages.
  Chimes, celebrations and reward toasts are derived in the timer tab from
  observed transitions.
- **Messages (UI → SW) are user actions only:**
  `START` `PAUSE` `RESUME` `STOP` `SKIP` `SNOOZE`.
- **Pinned timer tab** is found by URL (no stored id); duplicates are pruned,
  a closed tab is recreated unless its window is closing. Install opens it in
  front, with a first-run intro.
- **Settings take effect at the next phase start**, never mid-phase.
- All listeners are registered at SW top level; alarms are always cleared
  before re-creating; time is always `startTime + phaseDuration − now`.

### Break flow
1. **Heads-up** (2 min before): character gets sleepy, favicon pulses amber,
   soft chime, and a silent notification: “find a good place to stop”.
   One **snooze** (+5 min) per round, on the timer tab only.
2. **Break starts**: timer tab is activated and its window focused, break
   notification, celebration, then a break card with an off-screen idea
   (“Another idea” rotates through them). Calm nature sounds play.
3. **Break guard**: switching to another tab during a break (outside the final
   20 s) marks it `breakInterrupted` and sends ONE friendly nudge
   notification. Optional **nag mode** re-activates the timer tab every 30 s.
4. **Break ends**: auto-rolls into the next round (the kid only presses Start
   once). A full, uninterrupted break puts the current buddy’s reward on the
   **bookcase** (a book for Ember and Page, a fireball for Yumyumnia, a spoon
   for Otho): toast, chime, and the top-bar bookcase count bumps.
5. After `sessionsBeforeLongBreak` rounds comes a **long break**, then the
   cycle restarts at round 1.

### Bookcase
- `shelf` in `chrome.storage.local` is an append-only list of
  `{ k: 'book' | 'spoon' | 'fireball', t }`, written by the SW in the same
  write as the break → focus rollover. Unlike the log it is never trimmed,
  and Stop/restarts leave it alone. Updating from v1 seeds it with one book
  per full break already in the log.
- The top-bar chip opens a dialog that draws every item (look seeded by
  index + time, so it never changes), wraps onto new shelves, always shows
  room to grow, sparkles today’s additions and drops the newest one in.
- Keepsakes join the shelf at 10 (plant), 25 (trophy), 50 (cat) and 100
  (crown) items, each with its own toast.

### Little touches
- Optional name (popup) used in greetings and the bookcase title;
  time-of-day greeting at idle.
- Each buddy has a signature break idea offered on alternate breaks.
- Easter egg: typing `spoons` on the timer tab (or clicking the popup logo five
  times) unlocks Otho; unlocking from the tab also switches to him.

---

## State

```js
// chrome.storage.local — runtime (SW is the only writer)
{
  status: 'idle' | 'focus' | 'focus-warning' | 'break' | 'longBreak',
  sessionNumber: 1,          // 1..sessionsBeforeLongBreak
  startTime, phaseDuration,  // epoch ms / ms
  isPaused, pausedRemaining,
  snoozeUsed: false,
  breakInterrupted: false,   // kid switched tabs during this break
  logs: [ { type: 'focus'|'shortBreak'|'longBreak', startedAt, endedAt,
            scheduledDuration, completedNaturally, snoozed?, interrupted? } ],
  shelf: [ { k: 'book'|'spoon'|'fireball', t } ]   // never trimmed
}
// chrome.storage.local — UI-only, written by the timer tab
{ introSeen: true, othoUnlocked: true }

// chrome.storage.sync — settings
{
  focusMinutes: 20, shortBreakMinutes: 5, longBreakMinutes: 15,
  sessionsBeforeLongBreak: 3, soundEnabled: true, persistOnRelaunch: false,
  nagDuringBreak: false, timerCharacter: 'dragon' | 'book' | 'wizard' | 'otho',
  userName: ''
}
```

### Alarms
| Alarm           | Fires when                                              |
|-----------------|---------------------------------------------------------|
| `focus-warning` | 2 min before focus ends (again after a snooze)          |
| `focus-end`     | focus complete                                          |
| `snooze-end`    | extended focus complete                                 |
| `break-end`     | break complete                                          |
| `nag`           | every 30 s during breaks (nag mode only)                |
| `badge-tick`    | every minute while running: toolbar icon ring + badge   |

### Notifications
`pomofomo-warning` (heads-up, silent) · `pomofomo-break` · `pomofomo-nudge`
(once per break). Clicking any of them focuses the timer tab.

---

## Characters
All four share one state vocabulary; `character.js` sets exactly one class
`{prefix}--{state}` on the SVG root and all motion lives in the character’s
CSS (with a `prefers-reduced-motion` fallback that keeps each expression).

| State            | Trigger                                   |
|------------------|-------------------------------------------|
| `idle`           | idle or paused                            |
| `focus`          | focusing (reading, glasses, spellbook, polishing a spoon) |
| `focus-tired`    | heads-up window                           |
| `focus-sleeping` | last 10 s of the heads-up (UI-only)       |
| `break-start`    | break begins (750/700 ms → break-active)  |
| `break-active`   | during the break                          |
| `break-done`     | break → focus rollover (1.6 s, UI-only)   |

---

## Visual design

- **Watercolour landscape.** The timer tab is a painted scene: sky gradient,
  soft sky washes, painted sun, drifting clouds, three layers of hills and a
  paper grain multiplied over everything. SVG filters (`wc-paint`, `wc-bloom`,
  `wc-sky`, `wc-paper`) only touch static shapes; motion moves whole layers.
- **Phases recolour the world** through registered custom properties, so
  colours cross-fade:

  | Phase   | Mood            | Accent    |
  |---------|-----------------|-----------|
  | idle    | soft morning    | `#FF6F5B` coral (brand / Ember) |
  | focus   | calm periwinkle | `#6C6FF5` |
  | warning | warm sunset     | `#F29A1F` |
  | break   | bright outdoors | `#1FAE79` |
  | paused  | desaturated     | `#8E86A6` |

- **Dial**: watercolour disc + 14px ring (focus drains, breaks refill) with a
  knob at the arc’s end; the character lives inside. A speech bubble gives the
  character a voice for every state.
- **Type**: Fredoka (display, numerals) + Nunito (text), both bundled.
- **Ink** `#2A2342`; ember coral `#FF6F5B`; book berry `#D9487A`.
- **Responsive**: wide windows place the break card beside the dial; narrow
  ones stack it and turn the dial sideways so the idea stays above the fold.

---

## Verification checklist
- [ ] Loads without errors; install opens the pinned timer tab with the intro
- [ ] Start → ring drains, character reads, badge + toolbar ring update
- [ ] Heads-up → sleepy character, amber favicon, chime, silent notification
- [ ] Snooze once; button disappears; warns again before the new end
- [ ] Break → tab activates, notification, celebration, break card + ideas
- [ ] Switching tabs mid-break → one nudge, hint shows the reward is lost
- [ ] Full break → reward toast, item on the bookcase; interrupted → none
- [ ] Bookcase persists through Stop and restarts; milestones add keepsakes
- [ ] Typing “spoons” unlocks and switches to Otho; spoons go on the shelf
- [ ] Round N → long break; long break → round 1
- [ ] Pause/resume/skip/stop from the popup; popup stays live
- [ ] Close the timer tab → it comes back pinned
- [ ] persistOnRelaunch off/on behaves across a Chrome restart
- [ ] Reduced motion: no looping animation, expressions still read
