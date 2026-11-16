# Animal Sounds

Simple app for kids to play animal sounds from a web browser. Nothing less,
nothing more.

A grid of big animal tiles: tap an animal to hear its sound (a YouTube
short); when the video ends, the app returns to the grid on its own. Built
to run locked-down on a Samsung Galaxy Tab A7 Lite.

The videos come from this YouTube playlist:
<https://youtube.com/playlist?list=PLHO8AJ-73A6g>

## How it works

- Plain static site — no framework, no build step. Deployed to Vercel.
- `animals.json` maps each tile (name + image) to a YouTube video ID.
- Tapping a tile first plays a recording of the animal's name (files in
  `audio/`, generated with `randysay --text "Horse" -o horse.mp3`; filenames
  are the lowercased name with spaces as dashes).
- The **Dinosaurs** tab has 26 illustrated dinosaurs with unabbreviated names.
  Tapping one speaks its name in Randy's voice without opening a video.
  Images and voice recordings are local assets; repeated taps restart the name
  and selecting another dinosaur stops the previous recording. The same touch
  guards, idle dimming, and screen-time limits apply. Dinosaur entries live in
  `dinosaurs.json`; artwork attribution is in [DINOSAUR_CREDITS.md](DINOSAUR_CREDITS.md).
- The **Foods** tab has 20 food pictures, starting with **Tomato** and **Potato**.
  Each tap speaks the name in Randy's voice without a video. Entries are in
  `foods.json`; food artwork is from OpenMoji (CC BY-SA 4.0), like the animals.
- **Alphabet** has 26 cards in A–Z order. Each starts with an animal and shows
  uppercase letter, lowercase letter, and item name (for example, **Aa Alligator**).
  A tap plays a local recording of "A is for Alligator", then changes that card
  to another item for A. Each letter has five items from animals, foods, colors,
  shapes, and everyday objects. Each card independently shuffles its choices,
  uses every choice before repeating, and avoids back-to-back repeats across
  shuffles. Interrupting a phrase, changing tabs, hiding the app, or reaching a
  screen-time limit leaves its current item unchanged. Cards reset to their
  starting animals on reload. Content is in `alphabet.json`; shuffle logic is
  in `alphabet.js`. Artwork combines OpenMoji 16.0.0 (CC BY-SA 4.0) with original
  SVG illustrations in `images/alphabet/`; phrase recordings are in `audio/alphabet/`.
- Tap the large **Puzzle** tab in the header to open **Animal Puzzle**; tap the
  large **Sounds** tab to return. Swipe navigation is deliberately disabled so
  dragging a puzzle piece cannot accidentally change pages. When eight labeled
  tabs do not fit in one row, as on a phone, the tabs show their pictures only
  (the labels remain for screen readers), sized to fit eight across. On the
  tablet's 800 px portrait width each label sits under its picture; from about
  880 px wide the labels sit beside them. The title and **Today** timer sit in
  the top grip band, where they take no room from the pages.
  Each round cuts a picture into a 3×3 jigsaw: one of 29 animals, 26
  dinosaurs, 20 foods, or 8 robots. The kinds take turns in a shuffled order,
  so no kind comes up twice in a row, and each kind shows every picture before
  repeating one (`puzzle-deck.js`). Each kind has its own backdrop: a meadow
  for animals, a volcano for dinosaurs, a picnic table for foods, and a moon
  for robots. The heading reads "Build a Horse!", "Build an Owl!", or
  "Build some Rice!" (`"article": "some"` in `foods.json`). Every inner cut has one interlocking knob, the outer edges are
  flat, and the cuts change every round (`jigsaw.js`). The board shows a faint
  copy of the picture with each piece's bold, solid outline; completed outlines
  soften so the remaining spaces stand out. The board spans the screen
  less an 8 px margin. The mixed-up pieces lie in a tray below it, smaller than
  on the board, sized by `Jigsaw.fitLayout()` to fill the height that is left.
  The board gives up width only if tray pieces would otherwise drop below
  48 px. A piece grows to its real size around the finger when picked up and
  goes back to its tray size wherever it is put down. Pieces never rotate, so
  each shape fits only its own spot. A piece
  seats where its own center is released, not where the finger is, so it can
  be carried by a knob. It slides the last bit into place with a soft click,
  and seated neighbors join into one seamless picture. Only a piece's shape,
  plus a fingertip's margin, can be grabbed, so a loose piece's empty corners
  never block another piece. A star, particles, and chime celebrate a
  completed puzzle. Once the chime fades (0.7 s), the picture's name plays in
  Randy's voice, the same recording its tile uses, and a new randomized round
  appears 4.2 s after completion. Leaving the tab, a screen-time lock, or
  hiding the app before then cancels the name. The puzzle stays fixed in the
  viewport; it does not scroll.
  Several fingers can drag several pieces at once, and each piece keeps
  tracking its own finger; a second finger cannot take a piece that is already
  being carried. Pickup checks the touch coordinates against the actual cut
  shape, so it also works in WebViews that miss invisible SVG touch targets.
  The piece's button captures the finger immediately to keep tracking it while
  waiting for movement. A contact does not own a piece until it moves with drag
  intent,
  so a stationary palm, belly, or extra finger cannot block the fingers doing
  the puzzle. Pieces remain where they are released until moved again or placed
  in their matching spot. A piece left over a spot it does not match stays there,
  shakes slightly, and glows faint red for under a second.
- The **Fish** tab is a pet goldfish in a tank of pebbles, seaweed and a sunken
  pirate ship. It lives in real time, saved on the device (each device has its
  own fish), so hours and days pass while the tab, the app, or the tablet is
  off. A clock set back, as when the tablet boots with its clock reset, pauses
  the fish until the clock catches up again rather than changing it for good.
  The care rules are in `goldfish.js`; drawing and motion in `fish-tank.js`.
  - **Feed** sprinkles three flakes from a shaker. A hungry fish chases and
    gulps them. Hunger goes from full to starving in 12 hours, and a new fish
    starts hungry, so feeding is the first thing to do. A full fish shakes its
    head at more food, which sinks to the pebbles and stays there.
  - The water clouds over on its own in about a day, and faster with each
    flake left on the pebbles (five is enough). **Change water** appears only
    then. It drains about half the water, sweeps the old food away, and refills
    it clear. Water left very cloudy (about two and a half days, or a dozen
    leftover flakes) makes the fish sick over a few hours: pale, heavy-lidded,
    drooping fins, moping on the bottom, and not eating while the water stays
    dirty. Fresh water makes it well again in about 15 seconds, before the
    45-second idle dim, and it eats again straight away.
  - It grows over months, but only while it is fed and well: from a small
    orange baby with a short tail to a big orange fish with a long fan tail,
    about 90% grown after 100 days of good care. It never dies; neglect only pauses its growth until it
    is cared for again.
  - What it needs shows over its head, one thing at a time, as the icon of the
    button that helps, and that button breathes: water when sick in dirty
    water, then food when hungry, then water when the tank is cloudy. It only
    asks for water while Change water is showing.
  - **Rings** (a button on the tank's top-right corner, with the best score
    as a badge) starts a quick game. A gold ring appears in the water and
    Randy says "Tap the ring!"; ripples show where to tap until the fish is on
    its way. Tapping the ring sends the fish into its hole and out the other
    side; tapping elsewhere or leading with a finger steers it too. Each ring
    counts aloud ("One!" up to "Twenty!") with a chime that climbs a scale,
    and the next ring appears somewhere new. A ring waits for the swim plus
    time to react, which shrinks as the score climbs (`fish-rings.js`); it
    shrinks, then turns orange and wobbles in its last second. When one runs
    out, the score shows with the best, a star and "New high score!" for a
    new best, or "Great swimming!". The best is saved with the fish. Feed,
    Change water and Rings step aside during a game, a fish sick in dirty
    water is too poorly to play, and leaving the tab ends a game quietly.
  - Tap the fish and it blows bubbles and says how it is doing, in Randy's
    voice (`fish-talk.js`): sick, getting better, hungry, full with food left
    over, cloudy water, just ate, happy, its age ("two weeks old", "three
    months old"), its size, or a hello. How it is doing comes every other
    tap; age, size and hellos fill the taps between. Each kind takes its turn
    and each phrasing is used before any repeats, so no line comes twice in a
    row. A tap while it is still talking only makes it wiggle, so lines are
    never cut short. Tap the ship to hear "Pirate ship" as bubbles pour out
    of a porthole; tap the water and the fish comes to look. A finger moving across the water leads the fish; a resting
    one does not, and a leading finger that flattens into a palm lets go.
    Taps use the same fingertip rules as the tiles. Taps, Feed, Change water
    and leading (credited every second, so a long lead never dims the screen)
    count as play for screen time.
  - The tank is cheap to draw on the tablet. The water, plants, pebbles and
    ship are one canvas painted once. The fish is redrawn each frame into its
    own small canvas that is only ever moved, never scaled; its turns, tilt and
    growth are drawn inside it. Flakes and the thought bubble are small moved
    layers, bubbles are compositor animations, and cloudy water is a tiny
    canvas stretched soft whose opacity follows the dirt. The two buttons
    have their own layers, so their glow never redraws the page. Nothing
    animates unless the tab is showing and the app is awake, including the
    glow and the thought bubble under the dim or a break. Leaving stops the
    tank's sounds, finishes a water change, and eats or settles any flakes
    still falling.
  - Sounds are made on the spot with Web Audio, like the puzzle's click. The
    voice is recorded in Randy's voice: `audio/goldfish.mp3`,
    `audio/pirate-ship.mp3`, and the fish's 49 lines in `audio/fish/`. Change or
    add a line in `fish-talk.js`, then run
    `../ChannelKnowledgeBase/.venv/bin/python scripts/build-fish-voice.py` to
    record the missing ones (or pass ids to redo some). It renders two takes,
    checks each with Whisper, and keeps the right one closest to the pitch of
    the other names. The fish and its icons are original artwork.
- The **Words** tab is a wooden board with a picture and its name etched into
  the wood, one letter-shaped recess per letter, and plastic letters loose on
  the table below in scrambled rows: the name's own letters and a few extra
  ones that are not in it (three for a 3 or 4 letter word, two for a longer
  one, different each round), so the last letter is never simply the one left
  over. Read in order, the name's own letters never spell it. Words are the one-word
  names of 3 to 6 letters among the animals, foods and robots (35 of them,
  from Cat and Egg to Banana and Pigeon); short (3 or 4 letters) and long
  words take turns, starting short, and each word comes up before any repeats
  (`word-game.js`).
  - Drag a letter into its recess and it slides in with the puzzle's wooden
    click, sitting flush in the wood. Either recess takes a letter the word
    has twice. A letter let go over the wrong recess shakes, sounds a soft
    low note and slides back down to the table, as does an extra letter on
    any recess and any letter let go over the board. On the table a letter
    stays where it is put down.
  - Letters are solid: a carried letter pushes the others out of its way,
    even when flicked fast, and they knock once as they meet and slide on,
    then stay quiet while pressed together or against the table's side, even
    under a trembling finger. A letter let go mid-swipe slides a little way,
    and a finger put on a sliding letter stops it. A letter coming back down from the board onto
    another steps aside rather than resting on top of it. They all stay on
    the table, clear of the grip band; one let go in the band glides back
    onto the table, and can be caught on the way.
  - When the last recess is filled, the chime plays, the seated letters hop
    one after another while the extras stay on the table, and the word is
    spoken in Randy's voice (the recording its tile uses) once the chime
    fades. A new word appears 3.4 s after the last letter.
  - After 8 seconds without a letter seated, the first empty recess glows
    and a letter that fits it wiggles, and again every 8 seconds.
  - Touch works as on the puzzle: a contact owns a letter only once it moves
    like a drag, so a resting palm or still finger blocks nothing; several
    fingers carry several letters, and a finger cannot take a letter another
    one carries, nor one knocked out from under it. Unlike the puzzle, the
    tab turns with the device; the board puts the picture beside the word
    when the screen is short, and the table is always at least two letters
    tall. On a very short screen, such as a small phone turned sideways in
    Chrome, the letters shrink (below the usual smallest size if they must)
    to keep a table at least one letter tall. Turning as the last letter
    slides home still celebrates the word.
  - The tab is cheap to draw. The wood and its recesses are painted once per
    word into one canvas. Each letter is painted once into three small
    canvases (lying with its plastic side and a close shadow, lifted with a
    softer one, and seated), and is only ever moved, never scaled. Motion
    runs only while something moves, and nothing runs unless the tab is
    showing and awake. Leaving, dimming, a break or hiding puts a carried
    letter down where it is; leaving during the celebration cancels the name
    and brings a new word on return. A carry counts as play every second, so
    a long one never dims the screen.
  - Drawing and touches are in `word-board.js`; the letters are the
    self-hosted Fredoka typeface.
- The Puzzle tab stays in portrait when the device turns. It requests a native
  orientation lock where supported, and counter-rotates its play surface in
  kiosk WebViews that reject the lock. Piece sizes and completed slots stay
  intact; rotating during a drag releases the piece safely. Returning to Sounds
  restores the browser's normal orientation.
- Touch input is arbitrated one intentional pointer at a time. Animal taps must
  be brief, stationary fingertip-sized contacts; simultaneous candidates are
  considered together for 90 ms and only the best candidate is committed.
  Long holds, broad contacts (when the WebView reports contact geometry),
  canceled pointers, and every non-winning contact are ignored. Mouse,
  keyboard, and assistive-technology activation continue to use native clicks.
- Every page has a 48 px grip band along all four screen edges (`--safe-edge`
  in `style.css`). Touches that start there do nothing: no taps, puzzle drags,
  page swipes, or waking the dimmed screen. Page content is inset to stay clear
  of it, scrolling tiles pass beneath it, loose puzzle pieces are kept out of
  it, and the video's hold-to-close button sits inside it. The puzzle board may
  reach under it, because the board takes no touches and pieces seat by their
  own center. A hand resting in the
  band does not stop the other hand from tapping or scrolling.
- Playback uses the official YouTube IFrame API. An invisible "tap shield"
  covers the video so little fingers can't pause it, open related videos, or
  click through to YouTube.
- Only the active tab is laid out and painted; hidden tabs retain their small
  game state, so unfinished puzzles survive tab switches. The first puzzle is
  built only when opened. Dragging starts after 4 CSS pixels of movement, and
  all fingers share one animation-frame update using compositor transforms.
- Puzzle pieces are cheap to draw on the tablet's weak GPU. Each piece's
  picture is clipped to the piece's own box. On opening a round, the app
  prepares nine canvas images of the cut pieces with a small baked shadow,
  capped at twice their displayed resolution. Carrying moves one cached image
  with a transform; it does not redraw SVG masks or apply blur filters. The
  lift is laid out larger rather than scaled. Preparation is spread across
  tasks; a very early pickup uses its SVG immediately, then switches to the
  bitmap without interrupting the drag. If preparation fails, SVG dragging
  still works. Only this round's pieces retain their images. Seated pieces
  keep their SVG artwork so neighbors join without gaps. The carried copy also
  slides the last bit into place, so the seated piece never gets a layer of
  its own.
- Tile images load lazily and decode asynchronously. YouTube loads on the
  first animal tap and reuses the player for consecutive Sounds selections.
  Changing tabs, dimming for idle, reaching a screen-time limit, or hiding the
  browser destroys the player iframe and releases cached recordings. While a
  tab is active, its voice cache holds at most four recordings.
- The video auto-returns to the grid when it ends, errors, or never starts
  (watchdog timeout).
- Each video plays once. Looping is explicitly disabled, and the app also
  checks playback progress in case YouTube misses the end event or restarts a
  short. A fixed timeout allows the clip's duration plus 30 seconds for
  buffering. An absolute four-minute maximum also covers unavailable metadata.
- Parent escape hatch: **hold the ✕ in the top-right corner for about 1.2
  seconds** (`HOLD_MS` in app.js) while a video is playing. Quick taps do
  nothing.
- Screen time is limited to **15 active minutes per session** and **one active
  hour per local calendar day**. Each session break lasts **three hours**;
  after the fourth session reaches the daily hour, it stays locked until
  tomorrow. Usage and the current lock persist across page reloads, FreeKiosk
  restarts, and device restarts. Hidden tabs do not count toward usage.
- Hidden admin reset: tap the **Animal Sounds** title **17 times in a row**
  without tapping anywhere else. The title remains available while dimmed or
  locked. The 17th tap clears today's usage, session usage, break count, and
  lock, saves the reset, and wakes the app. Any tap elsewhere restarts the
  sequence; there is no time limit between title taps.
  The break screen ("Time for a break!" or "All done for today!") has a
  second way in: tap its **bottom-right corner 17 times in a row**, anywhere
  in a 120 px square there, including the grip band. It does the same reset.
  Taps outside the square, on the title, or in other corners start the count
  over, and the corner does nothing when no break is showing. FreeKiosk's
  own fixed-corner return to settings may share that corner, but it needs 15
  taps within 1.5 seconds; tap at a relaxed pace (there is no time limit
  here), and a little in from the very edge if the corner itself does not
  respond.
- Screen time starts only after an animal-tile tap, a moved puzzle piece, a
  carried letter, or play in the fish tank (a tap, a lead, Feed or Change
  water). After 45 seconds
  without any of these, the app dims and pauses the clock. The next tap only
  wakes the app; a following tile tap, puzzle move or tank play resumes
  counting. Watching the fish swim does not count.
  The whole wake gesture is consumed, including extra fingers, swipes, and
  delayed clicks, so it cannot activate controls behind the dimming layer.
  Swipes, wake taps, close controls, and passive video playback do not count.
- The header's **Today** timer shows the accumulated active time for the local
  calendar day, including the current active second and excluding dimmed or
  locked time.
- Ad-free playback relies on a YouTube Premium account being signed in once
  in the kiosk browser (see step 6 below). Embedded players honor the
  viewer's Premium session.

## Editing the animals

The tiles are defined in `animals.json`; each entry looks like

```json
{ "name": "Horse", "videoId": "erYhEM4qLpU", "image": "images/horse.svg" }
```

**The entry format, image/voice-clip pipeline, and deploy steps are all in
[ADDING_ANIMALS.md](ADDING_ANIMALS.md)** — that's the canonical guide.
`scripts/refresh-playlist.sh` diffs the playlist against `animals.json` and
checks every animal has its voice clip.

## Tablet setup: full kiosk lockdown (Tab A7 Lite, Android 14)

Plan A uses **FreeKiosk** (free, open-source, MIT). If it misbehaves on this
tablet, Plan B is **Fully Kiosk Browser** (€7.90 one-time) — the steps are
nearly identical; differences are noted inline. Neither requires root.

### 1. Prep the tablet

1. Settings → Software update — install the latest updates.
2. **Remove every account**: Settings → Accounts and backup → Manage
   accounts → remove each one (Google, Samsung, …). Device-owner
   provisioning refuses to run if any account exists. (Removing the
   account does not delete it — you can re-add it any time.)
3. Settings → Lock screen → Screen lock type → **None** (so waking the
   tablet lands straight back in the app).
4. Enable Developer options: Settings → About tablet → Software
   information → tap **Build number** 7 times. Then Settings → Developer
   options → enable **USB debugging**.
5. Optional but recommended: Settings → Display → Screen timeout → 30
   minutes (or "Keep screen on while charging" in Developer options if it
   will live on a charger).

### 2. Sideload the kiosk app from your Mac

Install adb if needed: `brew install android-platform-tools`

- **FreeKiosk**: download the latest APK from
  <https://github.com/RushB-fr/freekiosk/releases>
- **Fully Kiosk**: download the APK from <https://www.fully-kiosk.com>

Connect the tablet by USB, accept the debugging prompt on screen, then:

```bash
adb install path/to/freekiosk.apk
```

(Sideloading avoids re-adding a Google account just for the Play Store.)

### 3. Make it device owner (true lockdown, no root)

```bash
# FreeKiosk:
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver

# Fully Kiosk (Plan B):
adb shell dpm set-device-owner de.ozerov.fully/.DeviceOwnerReceiver
```

If it complains about accounts, an account still exists — see step 1.2.
Device-owner mode is what disables the status bar, home/recents buttons,
and edge swipes for real (Android "Lock Task Mode").

To undo later: remove device owner from the kiosk app's own settings, or
factory-reset the tablet.

### 4. Configure the kiosk

As configured on Randy's tablet (July 2026), in FreeKiosk's settings
(GENERAL and SECURITY tabs):

- **Start URL**: `https://animal-sounds-beta.vercel.app` (GENERAL).
- **PIN**: set a unique six-digit PIN (do not leave the default `1234`).
- SECURITY: **Enable Lock Mode** ON, **Launch on Boot** ON.
- **Return to Settings**: use **Fixed Corner**, with the return indicator
  hidden; require **15 taps within 1.5 seconds**, then require the PIN. Do not
  use **Tap Anywhere**: ordinary tile taps can satisfy it.
- Disable the volume-button return shortcut unless it is specifically needed
  for maintenance.
- Left OFF (deliberately): Block Power Menu and Show System Info Bar — the
  app warns both interact with audio muting on Samsung/OneUI; audio
  confirmed working with this combination.
- "Appear on top" permission granted via
  `adb shell appops set com.freekiosk SYSTEM_ALERT_WINDOW allow`.

### 5. Buy the license (Plan B only)

Fully Kiosk needs the PLUS license (€7.90 one-time per device) to remove
the watermark and unlock the full lockdown settings. FreeKiosk is free.

### 6. Sign into YouTube Premium (kills ads in the videos)

In the kiosk app's browser, temporarily set the Start URL to
`https://youtube.com`, sign in with the Premium account, then set the
Start URL back to the app. The session cookie persists and embedded
videos play ad-free.

If Google shows *"This browser or app may not be secure"*: in the kiosk
settings, temporarily change the user agent to a desktop Chrome user
agent, sign in, then revert it.

If ads ever reappear (session expired after weeks/months), repeat this
step.

### 7. Escape-proofing checklist

Test with the kiosk locked:

- [ ] Swipe from every edge — nothing should appear.
- [ ] Volume buttons — disabled (videos can be loud; set a volume first).
- [ ] Power button tap — screen sleeps; tapping again wakes straight into
      the app (no lock screen).
- [ ] Long-press power — Samsung may still show the Power off menu; if the
      tablet gets powered off, the kiosk auto-relaunches on boot (verified:
      after a reboot the tablet comes back locked into the app).
- [ ] In-app: tap the video repeatedly — it must not pause or navigate.
- [ ] In-app: quick-tap the ✕ — nothing; hold it ~1.2 s — back to the grid.
- [ ] Hold one finger on the screen, then tap several different animal tiles
      with another finger — each new tile tap must still open its video.
- [ ] Rest a palm or belly on one or more tiles, lift it, and verify no animal
      opens; while it remains down, tap an animal with one fingertip and verify
      only that animal opens.
- [ ] Rest one or more fingers on puzzle pieces, then drag a different piece;
      the moving finger must own the piece and the resting contacts must do
      nothing when lifted.
- [ ] Drag two puzzle pieces at once with two fingers; each must follow its
      own finger, and lifting one must not drop the other.
- [ ] Carry a piece by one of its knobs and let go with the piece over its
      spot; it must slide in with a click and line up with its neighbors.
- [ ] Leave a piece on a slot it does not match; it must stay there, shake
      slightly, and fade out a faint red glow.
- [ ] Hold the tablet with thumbs on the screen edges on every tab; nothing
      should tap, drag, or scroll, and the other hand should still tap and
      scroll normally.
- [ ] Start an upward swipe on an animal tile — the grid must scroll instead
      of opening that tile.
- [ ] Verify that repeated taps on tiles do not open FreeKiosk settings; only
      the hidden fixed-corner gesture plus the PIN should do so.

## Local development

Run the touch-input and playback regression checks with `node --test tests/*.test.js`.

For the kiosk lifecycle and touch-intent checks, reload the local site and
run the following in the browser console (the first suite expects a fresh
page):

```js
for (const file of ["browser-kiosk-performance", "browser-touch-intent"]) {
  const result = await (0, eval)(await (await fetch(`tests/${file}.js`)).text());
  console.table(result.results);
  console.assert(result.passed, `${file} failed`);
}
location.reload(); // restore real media APIs after the test doubles
```

They verify the small drag threshold, frame scheduling, tab-state
preservation, palm rejection, bounded audio caching, and video
startup/teardown races using synthetic contacts and fake media. These checks
and desktop CPU throttling do not establish physical FreeKiosk latency or real
YouTube playback, so also check on the Tab A7 Lite in FreeKiosk: cold startup,
tab switching, a short drag with another finger resting on the screen, and
dragging again after returning from a video.

Run `node tests/browser-screen-time.cjs` against the local server below, or
pass a deployed URL, to check that usage and locks survive reloads and fresh
WebView sessions. It also checks the 17-tap admin reset from the title and
from the break screen's bottom-right corner (other corners, taps just outside
it, mixed title and corner taps, and corner taps with no break showing do
nothing), interrupted sequences,
the locked and dimmed screens, saved resets, and the local calendar-day reset.
`PLAYWRIGHT_MODULE` selects an existing Playwright installation and
`BROWSER_EXECUTABLE_PATH` can select an older Chromium binary.

With Playwright and Chrome available, run `node tests/browser-orientation.cjs`
against the local server below, or pass a deployed URL as its first argument.
`PLAYWRIGHT_MODULE` can point to an existing Playwright installation. This
checks both landscape directions, loose-piece dragging, rotation during a
drag, puzzle completion, return navigation, and the touch-input checks.
Run `node tests/browser-wake.cjs` with the same setup to check that dim-screen
taps, multi-touch, swipes, and delayed clicks only wake the app, while the next
gesture works normally.
Run `node tests/browser-jigsaw.cjs` with the same setup to check that only a
piece's shape can be grabbed, that a piece carried by a knob seats by its
center and slides home, and that a finished puzzle shows no backdrop through
its cuts. The gap check first proves it can see a piece moved 6 px. It also
logs every recording's play, pause and end to check that the animal's name
plays once after the chime, in full, with no browser-speech fallback. Set
`VIEWPORT=412x800` to run it at phone size, and `PUZZLE=robot` (or `animal`,
`dinosaur`, `food`, or one picture such as `PUZZLE="robot:Robot Dog"`) to play
that kind.
Run `node tests/browser-puzzle-layout.cjs` with the same setup to check the
puzzle on three phone sizes, a sideways phone, and the tablet: one row of tabs,
a board spanning the screen less 8 px, tray pieces clear of the grip band, and
pieces that grow when picked up and shrink back where they are put down. It
also plays twelve rounds to check that kinds take turns, each on its own
backdrop, and that every picture and recording loads.
Run `node tests/browser-words.cjs` with the same setup to play the Words tab
with real touches: the board and letters on five phone and tablet layouts
(one row of tabs, no label wrapped under its picture, the picture and word on
the board, letters on the table and clear of the grip band, the right number
of extras and none from the word, the word's letters scrambled), two whole
words spelled on the tablet and the phone (each letter lifted and kept under
the finger, a click per letter, done with the extras still loose, one chime,
the word's recording once after the chime and in full, the next word 3.4 s
later with its own extras, short and long words taking turns), a wrong recess
and an extra letter on a recess (shake, soft note, back to the table), letters
let go on the board and on the table, pushing and knocking letters against the
table's side, a thrown letter, two fingers at once and a third that cannot
take a carried letter, a palm, the grip band (no pickup from it, and a letter
let go there glides back rather than jumping), and leaving, dimming and hiding
mid-carry. A minute-long carry must not dim the screen, while a still finger
must. On a short sideways table, a letter let go on the board above another
must step aside and settle within 3 s with at most three knocks; turning the
screen as the last letter seats must still click, chime and bring a new word;
and a resting finger must not carry a letter knocked out from under it. A
letter gliding back from the band can be caught. On four very short screens
(down to 640×280) the letters must lie on the table, clear of the band, and
come to rest without a sound, and a trembling finger pressing a letter against
another at the table's side must not make it rattle. Every frame, no loose
letter may leave the table and no seated letter its recess.
`ONLY=layout,spell` runs some parts.
Run `node tests/browser-words-paint.cjs` to count the tab's drawing in a
trace: a carried letter has its own layer that only translates and is not
redrawn, nothing else is redrawn while letters are carried and pushed, no
canvas is painted during play, and frame callbacks stay small with the CPU
slowed six times. Each check is first shown its fault (letters drawn into the
page, a scaled carry, the board redrawn, slow motion) and must flag it. The
header's Today timer is held still during the count; it redraws its strip
once a second on every tab.
`node --test tests/*.test.js` includes the word game's rules
(`tests/word-game.test.js`: which names are words, short and long words
taking turns, the extra letters (how many, none from the word, none twice,
every other letter turning up), every word laid out on five screens with its
widest possible extras and its letters on the
table and apart, a table at least two letters tall, scrambled starts,
pushing, sliding to rest on the table, the glide back from the board, a
letter landing on another stepping aside with a single knock, no rattle while
letters stay pressed together (still or under a trembling finger), short
screens down to 568×180 keeping a table a letter tall whose letters rest
quietly, a letter resting on the bottom of a table shorter than itself,
plastic sides clear of the bottom band, starting rows that fit at every
screen width whatever the scramble, a thin letter flicked fast pushing rather
than passing through, a held letter never pushing harder than a throw however
short the frame, and which recess a letter seats in), the fish's
care rules
(`tests/goldfish.test.js`), the rings game's rules (`tests/fish-rings.test.js`:
time per ring, ring size, placement and passing through), and what it says
(`tests/fish-talk.test.js`: every
line recorded, age wording, lines that follow its state, no line twice in a
row over 3000 random taps). It also includes the cut geometry: shared cuts, flat
borders, knob size, and that every knob's head is wider than its neck. It also
sweeps the layout solver across screen sizes, and checks the puzzle deck and
that every puzzle picture has its art and name recording.
Run `node tests/browser-multitouch.cjs` with the same setup to drag two pieces
at once with real touch input in portrait and landscape, lift one finger while
the other keeps dragging, and measure the wrong-slot shake and glow frame by
frame.
Run `node tests/browser-puzzle-pickup.cjs` to check pickup with both normal
SVG touch targets and those targets disabled to simulate missed SVG hits.
It checks the drag threshold, canceled contacts, re-picking up a
dropped piece, and completing all nine pieces. `BROWSER_EXECUTABLE_PATH` can
point to an older Chromium binary; `VIEWPORT=412x800` checks phone sizing.
Run `node tests/browser-puzzle-rendering.cjs` to check prepared, delayed, and
unavailable carry images with real touch input. Prepared copies have no live
SVG or filters, moving them does not redraw their canvases, and the newest
touch position reaches the displayed piece. It also checks all four picture
kinds and bounded image dimensions. `BROWSER_EXECUTABLE_PATH` selects an older
Chromium for these checks too.
Run `node tests/browser-safe-area.cjs` with the same setup to check the grip
band on every page: edge taps, swipes, drags, and wake taps do nothing, while
tiles just inside it, a second hand's taps and scrolls, and puzzle drags still
work in both orientations.
Run `node tests/browser-puzzle-paint.cjs` with the same setup to check how much
drawing the puzzle asks of Chrome, counted in a trace rather than timed: a
carried bitmap's layer is at most 1.5 times the piece, it only translates,
has no live SVG or filters, is not repeatedly rasterized while carried, and a
seat redraws at most one screen of the board. Each check is first shown the
fault it guards against (the whole picture under every piece, a scaled
carried layer, live SVG artwork, repeated board painting, a composited shadow)
and must flag it.
`PUZZLE=animal` (or another kind) picks the picture. Desktop
counts say nothing about the tablet's frame rate on their own; measure that on
the device.
Run `node tests/browser-goldfish.cjs` with the same setup to play the Fish tab
with real touches: a hungry new fish eats each sprinkle and refuses food once
full, keeps after one flake until it has it (food dropped right over it, and
food by a wall it is pinned against, are both eaten), leftovers cloud the
water until Change water appears, and every frame of
the water change keeps the fish under the water line. It checks the fish, ship
and water taps and their recordings: a hungry fish says it is hungry, a happy
one that it is happy, a second tap does not cut a line short, and each tap
after says something new. It plays the rings game: Rings starts it and the
other buttons step aside, the first ring shows where to tap, rings go
through by tap and by lead with time to spare and are counted aloud, a missed
ring ends the game on time with the score, best, star and voice, the best
is saved across reloads and kept by a lower score, leaving mid-game ends it
quietly, and a sick fish cannot play. It checks leading with a moving finger but not a
resting one, a lead that turns into a palm, a minute-long lead that must not
dim the screen, a mouse drag whose closing click is not a tap, a tap on a
fish that has swum on, saves across reloads, a fish that is hungry and cloudy
overnight, sick after four days, eating as soon as its water is changed and
well soon after, never asking for water while Change water is hidden, grown
with a fan tail after months and orange at every age, and that the tank, its
looping animations and its sounds stop when the tab changes (including to the
puzzle), dims, locks or hides. It also checks five phone and tablet layouts, buttons whose picture
and word fit inside them, and that the thought bubble stays in the water.
`ONLY=care,time` runs some parts.
Run `node tests/browser-goldfish-paint.cjs` to count the tank's drawing in a
trace while a grown fish chases flakes among bubbles in cloudy water, which
is then drained and refilled, and again through a rings game: no layer is
redrawn as things move, the fish's layer only translates, and the frame callbacks stay small with the CPU slowed
six times. Each check is first shown its fault
(movers painted into the page, the water redrawn, a scaled fish, slow frames).
On the Pixel 8 Pro the same scene ran at about 60 fps; the tablet's frame rate
is still unmeasured.

```bash
python3 -m http.server 8642
# open http://localhost:8642
```

Deploy: `vercel --prod` (static site, no configuration needed).

## Credits

Robot artwork in `images/robots/` is original, drawn in OpenMoji's style.
Dinosaur puzzle cutouts are modified from the illustrations listed in
[DINOSAUR_CREDITS.md](DINOSAUR_CREDITS.md) and keep their licenses.

Animal artwork from [OpenMoji](https://openmoji.org) — the open-source
emoji and icon project, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Some animals use nearest-species stand-ins (the ferret is an otter, the
yak is a bison, the guinea pig is a hamster, and several birds share the
songbird art with shifted colors) — swap any file in `images/` to change.

"Fredoka" typeface (SIL Open Font License) is self-hosted in `fonts/`.

## Puzzle pictures

- Animals and foods use their tile artwork. Animals that share a name, such
  as the two geese, make one puzzle.
- Dinosaur tiles are wide paintings, mostly on white. Run
  `scripts/build-puzzle-dinosaurs.py` (Pillow with WebP, NumPy, SciPy) to
  rebuild the square cutouts in `images/dinosaurs/puzzle/`. It removes the
  white, keeps soft ground shadows as translucent shade, and centers each
  dinosaur so its feet stand on the puzzle's ground. Brontosaurus is a painted
  scene, so it is cropped to a square instead. The script records each path as
  `puzzleImage` in `dinosaurs.json`.
- Robots exist only as puzzles: `robots.json`, original OpenMoji-style art in
  `images/robots/`, and name recordings in `audio/`. They were made with
  `randysay --voice-id-env ELEVENLABS_RANDY_VOICE_ID --text "Robot Dog" -o audio/robot-dog.mp3`,
  keeping the take Whisper heard correctly whose pitch best matched the
  existing names.

## Lessons and alphabet speech

Lessons contains **Chicken Wing** and **Wash Hands**. Tapping a card plays its
recorded name and animates its illustration inline for five seconds. Tapping
again restarts it. No additional screen, captions, timers, or controls appear.
Leaving the tab, hiding the app, or reaching a screen-time limit stops it.
Reduced-motion settings keep the instructional poses without repetitive motion.
Chicken Wing uses a front-facing child in matching long sleeves, a connected
shoulder/elbow/wrist chain, and a bent arm crossing the chest to the mouth.
Wash Hands is a condensed visual demonstration of wetting, soap, scrubbing,
rinsing and drying, not a timer for actual handwashing.

Alphabet recordings use explicit American letter names from
`alphabet-pronunciations.json`, including **Why** and **Zee**. Each group stores
its `spokenLetter` for browser speech fallback, which also selects `en-US`.
The refreshed `-us.mp3` filenames prevent cached older recordings from playing.
Display labels remain unchanged, such as `Yy Yak` and `Zz Zebra`.

Lesson audio uses one local five-second track per card, combining the spoken
name with synchronized effects. Chicken Wing coughs at 1.8 and 2.6 seconds;
Wash Hands runs water during wetting and rinsing and bubbles during scrubbing.
The animation follows the audio clock when playback is available. Leaving,
restarting, idle dimming, or a time limit stops the complete track.

The cough is trimmed from [Cough 2 by ezwa](https://commons.wikimedia.org/wiki/File:Cough_2.ogg),
released into the public domain. Water and bubbles are synthesized locally.
`scripts/build-lesson-audio.py` rebuilds the mixes with numpy, scipy, and ffmpeg.

Alphabet Banana's current recording uses `eleven_flash_v2` with the explicit
CMU phonemes `B AA0 N AE1 N AH0`, placing primary stress on the Apple vowel
in the middle syllable. Its versioned filename is `b-banana-us-v3.mp3`.
Chicken Wing's initial and reset artwork use the same rest pose as animation
completion, so switching to Wash Hands cannot restore the coughing pose.
