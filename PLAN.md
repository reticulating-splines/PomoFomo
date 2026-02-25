# PomoFomo — Chrome Extension Implementation Plan

## Context
Building a Pomodoro timer Chrome Extension for kids aged 8–11. The primary goal is helping children remember to take periodic breaks during browser-based activities (edutainment games, etc.). Features a charming animated SVG dragon, a persistent pinned tab as the main experience, and a gentle two-stage break alert system. No hard lockout — autonomy is respected.

---

## Final Architecture

```
PomoFomo/
├── PLAN.md                          ← this file
├── manifest.json
├── background.js                    ← service worker: ALL timer authority lives here
├── shared/
│   ├── constants.js                 ← enums, alarm names, defaults
│   └── storage.js                   ← chrome.storage wrappers
├── timer/
│   ├── timer.html                   ← persistent pinned tab (main experience)
│   ├── timer.js                     ← arc, controls, dragon wiring, message bus
│   ├── timer.css                    ← layout, CSS custom property themes, animations
│   └── dragon.js                    ← DragonController: SVG fetch+inject, state machine
├── popup/
│   ├── popup.html                   ← extension icon click: status + settings
│   ├── popup.js
│   └── popup.css
├── dragon/
│   └── dragon.svg                   ← SVG source (fetched + injected by dragon.js)
├── sounds/
│   └── sounds.js                    ← SoundPlayer: pure Web Audio API, no external files
├── favicon/
│   └── favicon.js                   ← FaviconUpdater: canvas → data URL, per-second update
└── assets/
    ├── fonts/
    │   ├── Nunito-Regular.woff2     ← download from gwfh.mranftl.com (Latin subset)
    │   ├── Nunito-Bold.woff2
    │   └── Nunito-ExtraBold.woff2
    └── icons/
        ├── icon16.png
        ├── icon32.png
        ├── icon48.png
        └── icon128.png
```

---

## Key Design Decisions

- **Persistent pinned tab** (`timer.html`) is the main experience. Service worker re-creates it if closed via `chrome.tabs.onRemoved`.
- **Popup** is a mini remote control: status chip + settings panel (gear icon slides in settings view).
- **No content script** — no overlay injection. Break alert = tab focus switch. Games pause naturally when tab loses focus (Page Visibility API).
- **Two-stage break alert:**
  1. `focus-warning` (~2 min before): dragon goes tired, favicon pulses, soft chime
  2. Break fires: `chrome.tabs.update({active:true})` + `chrome.windows.update({focused:true})` + system notification + dragon celebrates + nature sounds
- **One snooze per session** (5 min). Button hidden after use. Dragon reacts mildly.
- **All sounds synthesized** via Web Audio API — no external audio files.
- **Settings take effect at next phase start**, never mid-session.
- **AudioContext unlocked** by user clicking Start (required by Chrome autoplay policy).

---

## State Shape

```js
// chrome.storage.local — runtime state
{
  status: 'idle' | 'focus' | 'focus-warning' | 'break' | 'longBreak',
  sessionNumber: 1,         // 1..sessionsBeforeLongBreak
  startTime: null,          // epoch ms — source of truth for time remaining
  phaseDuration: null,      // total ms for current phase
  snoozeUsed: false,
  timerTabId: null,
  timerWindowId: null,
  logs: []                  // session log entries (future analytics)
}

// chrome.storage.sync — settings
{
  focusMinutes: 20,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 3,
  soundEnabled: true,
  persistOnRelaunch: false
}
```

## Chrome Alarms
| Alarm name       | Fires when                  |
|------------------|-----------------------------|
| `focus-warning`  | 2 min before focus end      |
| `focus-end`      | Focus session complete      |
| `break-end`      | Break complete              |
| `snooze-end`     | 5 min after snooze          |

## Message Types (timer.js / popup.js → background.js)
`START` `PAUSE` `SKIP` `SNOOZE` `BREAK_ACKNOWLEDGED` `GET_STATE` `SETTINGS_CHANGED`

## Dragon States
| State          | Trigger              | Key animation                                        |
|----------------|----------------------|------------------------------------------------------|
| `idle`         | Not started          | Slow blink, breathe                                  |
| `focus`        | Session running      | Alert bob, blink every 8s                            |
| `focus-tired`  | focus-warning alarm  | Yawn, drooping eyelids                               |
| `break-start`  | Break fires          | Jump, wings spread, sparkle burst → auto break-active|
| `break-active` | During break         | Tail wag, playful bob, butterfly                     |
| `break-done`   | Break complete       | Ready bounce, bright eyes                            |

---

## Visual Design Tokens

```
Focus  (amber):         bg #FFF8EE   accent #F5A623
Break  (teal):          bg #EFF9F6   accent #2BBFA0
Warning (deeper amber): accent #E8842A

Dragon: body #5B9BD5 (blue-teal)  belly #F9C784 (warm gold)
        eyes #2D2D2D              sparkles #FFD93D

Typography: Nunito 400/700/800, bundled woff2 (Latin subset)
Arc radius: 100  circumference: 628.32  viewBox: 220×220
Focus arc: drains (stroke-dashoffset increases with elapsed time)
Break arc: fills  (stroke-dashoffset decreases — recharge metaphor)
```

---

## Build Order

### Phase 1 — Scaffold + Core
1. Directory structure + empty files
2. `PLAN.md` (this file) in project root
3. Download Nunito woff2 (Latin, 3 weights)
4. Placeholder PNG icons (16/32/48/128)
5. `shared/constants.js` — ALARM, STATUS, MSG enums + defaults
6. `shared/storage.js` — storage wrappers
7. `background.js` — full state machine, alarms, tab lifecycle, logging

### Phase 2 — Timer Tab UI
8. `timer.html` — semantic shell, SVG arc, dragon container, controls
9. `timer.css` — CSS custom property theming, arc, Nunito, session dots, buttons
10. `timer.js` — applyState(), tick(), arc update, message bus, GET_STATE on load
11. `favicon/favicon.js` — FaviconUpdater, canvas-based progress arc

### Phase 3 — Popup
12. `popup.html` — header, status view, settings view
13. `popup.css` — 320px fixed, slide transition, mini-badge
14. `popup.js` — state display, settings r/w, Go to Timer

### Phase 4 — Dragon
15. `dragon/dragon.svg` — chubby body, expressive eyes, wings, tail, sparkles (< 8KB)
16. `timer/dragon.js` — DragonController: fetch+inject, setState, state queuing
17. Dragon @keyframes in `timer.css`
18. Wire DragonController into `timer.js`

### Phase 5 — Sound
19. `sounds/sounds.js` — SoundPlayer: chimes + ambient synthesis
20. Wire unlock() to Start, ambient to break state changes
21. background.js sends PLAY_CHIME messages to timer tab

### Phase 6 — Alert Flow + Snooze
22. End-to-end test: warning → break → tab focus → notification → celebrate → sounds
23. Snooze wiring: show/hide button, one-use guard, dragon mild reaction

### Phase 7 — Polish
24. Smooth CSS theme transitions across all state changes
25. Micro-animations, accessibility pass
26. Edge case testing: tab close/reopen, mid-session settings change, persist on relaunch

---

## Critical Gotchas

1. **Alarm listeners at SW top level** — not inside async callbacks
2. **Time from `Date.now() - startTime`** — never counters; setInterval is display-only
3. **storage.local.get** — spread over DEFAULT_STATE to handle missing keys on first install
4. **AudioContext autoplay** — unlock() must be called on a user gesture (Start button)
5. **Popup font face** — popup.css needs its own @font-face (or shared fonts.css)
6. **Popup JS context** — destroyed on close; always read from storage/SW on open
7. **Duplicate alarms** — always clear before create to avoid accumulation across SW restarts
8. **OffscreenCanvas** for action.setIcon in SW; regular Canvas in timer tab for favicon
9. **Settings mid-session** — take effect at next phase start only
10. **chrome.windows.update focused** — best-effort; notification is the reliable alert

---

## Verification Checklist

- [ ] Extension loads without errors in chrome://extensions
- [ ] Timer tab opens pinned on install
- [ ] Start → arc drains → dragon alert → favicon updates
- [ ] 2-min warning → dragon yawns → favicon pulses → soft chime
- [ ] Break fires → tab activates → dragon celebrates → notification → sounds play
- [ ] Snooze works once, button disappears, second snooze attempt ignored
- [ ] Break complete → arc full → dragon ready pose
- [ ] 3 sessions → long break (15 min) instead of short (5 min)
- [ ] Close timer tab → reopens within ~1s, pinned
- [ ] Settings change → applies at next phase start
- [ ] persistOnRelaunch off → restart Chrome → timer resets
- [ ] persistOnRelaunch on → restart Chrome → timer resumes
- [ ] Popup status view, settings slide, Go to Timer button all work
