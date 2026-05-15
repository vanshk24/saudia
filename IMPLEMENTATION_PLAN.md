# Saudia Automation — Full Implementation Plan

## What This App Does (Plain English)

1. User opens the .exe app
2. Screen 1: User selects Word file (input), Excel template, output folder → clicks Start
3. Screen 2: App auto-detects installed browsers → user picks one → clicks Launch
4. App opens that real browser (visible, not hidden)
5. For each unique PNR:
   - Opens Saudia website once
   - Searches using PNR + Last Name
   - Loops through all passengers in that booking
   - Extracts all details per passenger
   - Fills Excel row in real time (Excel is visible on screen)
   - Handles missing passport gracefully (marks row, continues)
6. Screen 3: Live progress visible while running (progress bar, log, pause/stop)
7. Screen 4: Summary when done (success count, failed count, open output folder)

---

## Input File — Word File Format

**File:** 23_mar_37.docx (example)

Each passenger line:
```
001 01AL LUHAYB/RAED MR    9737GJ  F  HK  14JAN  NYCSV08AA
```

| Part | Value | Meaning |
|------|-------|---------|
| 001 | Sequence number | Line number |
| 01 | Group size | How many passengers in this PNR |
| AL LUHAYB | Last Name | Before the "/" |
| RAED MR | First Name | After the "/" |
| 9737GJ | PNR | 6-char booking reference |
| F | Class | Travel class |
| HK | Status | Confirmed booking |

**Junk lines to skip:** Lines containing only `)>`, `>`, `m`, or blank lines.

**Grouping logic:**
- Same PNR appearing multiple times = group booking
- Open Saudia website ONCE per unique PNR
- Process all passengers in that group one by one

**Example groupings from real data:**
```
8OZLY9  → 2 passengers (ALKANDIL, ALSABAAN)
9C96MP  → 2 passengers (ALLUHIB, ALOWAYMIR)
8KSX7F  → 3 passengers (ALEEBAN, ALMINEEFI x2)
79H3AT  → 4 passengers (ALOTAIBI x4)
9Z5DDH  → 4 passengers (ALFAGEEH, ALSHEHIRY x3)
9GXV45  → 4 passengers (ALBUTAIRI, ALISSA, ALRASHEED, ALYAHYA)
97XHW2  → 5 passengers (ABUALI, ALQUDSI x4)
8O7RLX  → 6 passengers (BASHIR x5, VIQAR)
```

---

## Output File — Excel Structure

**File:** LPC_-SV37-23MAR.xlsx (example)

Columns:
| # | Column | Source |
|---|--------|--------|
| 1 | PNR | Word file |
| 2 | First T | Saudia website (first flight date) |
| 3 | From | Saudia website (origin) |
| 4 | To | Saudia website (destination) |
| 5 | Second T | Saudia website (return date) |
| 6 | From | Saudia website (return origin) |
| 7 | To | Saudia website (return destination) |
| 8 | Third T | Saudia website (if 3rd leg exists) |
| 9 | From/To | Saudia website |
| 10 | Fourth T | Saudia website (if 4th leg exists) |
| 11 | From/To | Saudia website |
| 12 | Full Name | Saudia website |
| 13 | Last Name | Word file / Saudia website |
| 14 | FF. No. | Saudia website (Frequent Flyer) |
| 15 | Class | Word file |
| 16 | Ticket No. | Saudia website |
| 17 | Passport No. | Saudia website (blank if missing) |
| 18 | Status | Auto: ✅ Done / ⚠️ No Passport / ❌ Skipped |
| 19 | Skip Reason | Auto: blank or reason text |

**Passenger rules:**
- Has passport → enter it, extract all details, mark ✅ Done
- No passport → fill all other fields, leave passport blank, mark ⚠️ No Passport
- Missing critical info → skip that passenger, mark ❌ Skipped, write reason

**Excel behaviour:**
- Excel file is open and visible on screen while automation runs
- Each row is written and saved immediately after that passenger is processed
- Color coding applied per row automatically
- Do NOT edit Excel while automation is running — use Pause button if needed

---

## Bot Detection — How We Avoid It

| Wrong (Old Approach) | Right (New Approach) |
|----------------------|----------------------|
| Headless browser | Real visible browser |
| Fresh profile every run | Persistent profile saved to ./browser-profile |
| Launching isolated browser | User's actual installed browser |
| Instant robotic clicks | Human-like random delays 500ms–1500ms |
| No user agent | Proper browser user agent |

**Core Playwright launch code:**
```typescript
const browser = await chromium.launchPersistentContext(
  './browser-profile',
  {
    headless: false,
    executablePath: selectedBrowserPath, // from user selection
    args: ['--start-maximized'],
  }
);
```

---

## Build Sessions — One at a Time

### Session 1 — Electron App Skeleton + Screen 1
**Goal:** App opens, Screen 1 works fully.

Screen 1 contains:
- "Select Word File" button → file picker (.docx only)
- "Select Excel Template" button → file picker (.xlsx only)
- "Select Output Folder" button → folder picker
- Selected paths shown on screen
- "Next →" button (disabled until all 3 selected)

**Start message for Claude Code:**
> "Build an Electron + React + TypeScript desktop app skeleton. 
> Follow CLAUDE.md rules strictly.
> Build Screen 1 only: file picker for Word file, file picker for Excel template, 
> folder picker for output. Show selected paths. Next button disabled until all 3 selected.
> No other screens yet."

---

### Session 2 — Word File Parser
**Goal:** Read Word file, extract all passenger data, group by PNR.

Logic:
- Read .docx using mammoth.js
- Parse each line with regex
- Extract: Last Name, First Name, PNR, Class, Group size
- Skip junk lines (lines with only `>`, `)>`, `m`, or blank)
- Group passengers by PNR into a map
- Show preview on Screen 1: "Found X passengers across Y unique PNRs"

**Start message for Claude Code:**
> "Add Word file parsing to the automation. 
> File: automation/readWord.ts
> Parse lines like: '001 01AL LUHAYB/RAED MR 9737GJ F HK 14JAN NYCSV08AA'
> Extract: Last Name (before /), PNR (6-char after name), Class (letter after PNR).
> Skip junk lines. Group by PNR. Return a Map<PNR, Passenger[]>.
> Show passenger count preview on Screen 1 after file is selected."

---

### Session 3 — Browser Detection + Screen 2
**Goal:** App detects installed browsers, user picks one, browser launches.

Logic:
- Scan common install paths for Chrome, Brave, Edge, Firefox on Windows
- Show only browsers that are actually installed
- User selects one
- Click Launch → opens real browser with persistent profile
- Browser stays open for entire automation session

**Start message for Claude Code:**
> "Add browser detection to electron/browserDetect.ts.
> Scan Windows paths for Chrome, Brave, Edge, Firefox.
> Build Screen 2: show detected browsers as radio buttons, Launch button.
> On launch, open Playwright with launchPersistentContext using selected browser path.
> Browser must be visible (headless: false). Use persistent profile at ./browser-profile."

---

### Session 4 — Saudia Bot Core Logic
**Goal:** Automation looks up each PNR on Saudia website, extracts all data.

Logic:
- Navigate to Saudia booking lookup page
- Enter PNR + Last Name
- Extract: full name, flight dates, origin/destination, ticket number, FF number, passport
- Handle: wrong PNR (log as failed), no result (retry once then skip), timeout
- Loop through all passengers in a PNR group
- Return structured data per passenger ready for Excel

**Start message for Claude Code:**
> "Build automation/saudiaBot.ts.
> Function: lookupPNR(page, pnr, lastName) → returns array of passenger details.
> Navigate to Saudia booking lookup. Enter PNR + last name. Extract all passenger fields.
> Handle errors: wrong PNR → mark failed. No passport → mark no passport. Timeout → retry once.
> Add human-like delays 500–1500ms between actions. Never use headless mode."

---

### Session 5 — Excel Writing + Screen 3 Live Progress
**Goal:** Excel fills in real time, user sees live progress.

Logic:
- Open Excel file using ExcelJS
- For each passenger processed, write their row immediately
- Apply color coding per status
- Auto-save after every row
- Screen 3 shows:
  - Progress bar: "Processing 12 of 89 passengers"
  - Current PNR being processed
  - Live scrolling log of each action
  - Pause button (finishes current passenger then pauses)
  - Stop button (saves progress, stops)

**Start message for Claude Code:**
> "Build automation/writeExcel.ts using ExcelJS.
> Open Excel template, write passenger data row by row in real time.
> Color rows: green = done, yellow = no passport, red = skipped.
> Auto-save after every row. Keep Excel file open and visible on screen.
> Build Screen 3: progress bar, current PNR label, live log panel, Pause and Stop buttons.
> Pause finishes current passenger then waits. Stop saves and exits."

---

### Session 6 — Summary Screen + Error Handling + .exe Build
**Goal:** App is complete and packaged as .exe.

Logic:
- Screen 4 shows after automation completes:
  - Total passengers processed
  - Success count
  - No passport count
  - Skipped/failed count
  - "Open Output Folder" button
  - "Run Again" button
- Failed PNRs listed separately in a scrollable panel
- Package app as .exe using electron-builder

**Start message for Claude Code:**
> "Build Screen 4: summary screen showing success, no passport, skipped counts.
> List failed PNRs in scrollable panel. Add Open Output Folder and Run Again buttons.
> Then configure electron-builder.config.js to package the app as a Windows .exe.
> Test the build. Make sure no terminal window appears when app runs."

---

## Before Starting Session 1 — Checklist

- [ ] Node.js installed on your computer
- [ ] VS Code or any code editor ready
- [ ] Claude Code installed (terminal: `npm install -g @anthropic-ai/claude-code`)
- [ ] New folder created: `saudia-automation/`
- [ ] CLAUDE.md placed in that folder
- [ ] This IMPLEMENTATION_PLAN.md placed in that folder
- [ ] Sample Word file (.docx) ready to test with
- [ ] Sample Excel template (.xlsx) ready
- [ ] Claude Pro subscription active

---

## Important Notes

1. **Do not skip sessions** — each session builds on the previous one
2. **Test each session** before starting the next
3. **Share your Word file and Excel file** with Claude Code in Session 1
4. **If something breaks** — start a new Claude Code session, reference CLAUDE.md, describe the error
5. **The browser profile folder** (./browser-profile) should be gitignored — it stores your browser cookies/session
6. **Never run automation on the real file** until Session 5 is tested with a small test file first
