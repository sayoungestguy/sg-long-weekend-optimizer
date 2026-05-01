# SG Long-Weekend Optimizer — Working Notes

Static client-side web app that takes a user's annual leave balance and a year (2024–2027) and returns ranked strategies for chaining leave days with Singapore public holidays into long weekends. **One-weekend build, ~10–12 hours.** See `PRD.md` for the full spec and `ARCHITECTURE.md` for decisions.

## Stack

- **Framework:** Astro 4+ (static-first, no client framework — vanilla JS islands only where needed)
- **Styling:** Tailwind CSS
- **Dates:** `dayjs` + `isBetween`, `weekday` plugins (no `date-fns`, no `react-calendar`)
- **Tests:** `vitest`
- **Hosting:** Vercel (free tier, atomic deploys, OG image API)
- **Data:** data.gov.sg public holidays dataset `d_8ef23381f9417e4d4254ee8b4dcdb176` (covers 2020–2026, ~11 holidays/year)

## Hard architectural rules

1. **No runtime API calls.** Holidays are fetched at build time via `scripts/fetch-holidays.ts` and written to `src/data/holidays-sg.json`. Re-run manually when a new year is added.
2. **No backend, no accounts, no DB.** State lives in URL params: `/?year=2026&leave=14&sat=false`.
3. **No client framework runtime.** If a component needs interactivity, write vanilla JS in an Astro island. Do not pull in React/Vue/Svelte.
4. **No new dependencies** beyond the stack above without a written justification — bundle size is part of the product.
5. **Dates are date-only, no times.** Construct via `dayjs.utc(...)` to avoid timezone bugs (the app needs to behave the same in SGT, UTC, and Tokyo).

## File structure (target)

```
src/
├── components/
│   ├── OptimizerForm.astro
│   ├── StrategyList.astro
│   ├── StrategyCard.astro
│   ├── YearCalendar.astro
│   ├── MonthGrid.astro
│   └── DayCell.astro
├── data/
│   └── holidays-sg.json        # generated, committed
├── lib/
│   ├── optimizer.ts            # core algorithm
│   └── calendar.ts             # day-kind mapping
└── pages/
    ├── index.astro
    ├── about.astro
    └── api/og.ts
scripts/
└── fetch-holidays.ts
```

## The algorithm (heuristic, not true optimum)

Greedy bridge detection. NP-hard in the general case but ~11 PHs/year keeps the search space small enough that the heuristic stays within ~5% of brute-force optimal.

1. Build a 365/366-day calendar marking each day as `weekend | holiday | workday`.
2. For each PH, examine ±5 days for "bridge candidates" — workdays sandwiched between the PH and the nearest weekend or another PH.
3. Score each candidate: `efficiency = totalDaysOff / leaveDaysUsed`.
4. Also generate longer-break candidates (contiguous weekend + PH + ≤5 leave days).
5. Sort by efficiency desc, tie-break by total days off desc.
6. Greedy-select non-overlapping strategies until leave is exhausted. **Exclude 0-leave candidates from the greedy pool** — they're factual ("you have a 3-day weekend already"), not strategic, and would otherwise pre-empt better leave-using picks for the same range (e.g. Christmas-alone would block the Thu–Sun bridge that uses Fri leave).
7. Return top picks plus 2–3 next-best alternates.

**Filter rule for what's "worth showing":** `totalDaysOff >= 3 AND (efficiency >= 2.5 OR totalDaysOff >= 5)`. The `totalDaysOff >= 3` floor blocks single-PH "strategies" with `Infinity` efficiency from passing the filter. The `OR totalDaysOff >= 5` clause keeps Easter-style 3-day weekends and longer cluster-bridges visible even when their efficiency dips below 2.5.

## Edge cases that must be handled

- PHs falling on Sunday observed on Monday — the dataset does NOT pre-apply this. Verified: 2025 National Day (Sat Aug 9) appears as a single Saturday entry with no Monday-observed sibling. The algorithm must add observed-Monday handling itself for any PH whose `dayOfWeek === 0` (Sunday). Saturday PHs are already a "free" weekend day so no observation is needed for them under the SG rule.
- Two PHs in the same week (e.g. CNY spanning Mon–Tue some years).
- `leaveBalance === 0` → empty result with friendly message.
- Huge `leaveBalance` (e.g. 30) → cap output at 10 strategies.
- 5.5-day work week toggle (`includeSaturday`).

## Test fixtures (write before the algorithm)

- 2025 Christmas (Thu Dec 25): 1 leave day (Fri Dec 26) → 4-day weekend.
- 2026 CNY (Tue–Wed Feb 17–18): 1 leave day (Mon Feb 16) → 5-day break.
- 2025 National Day (Sat Aug 9): verify Monday-observed logic via dataset.
- A non-SGT timezone construction test — algorithm must produce identical output in UTC.

## Acceptance criteria (from PRD)

- Loads <1s on 4G mobile.
- Default state (current year, 14 days leave) shows ≥5 strategies.
- Year/leave changes update results without page reload.
- Lighthouse ≥95 on all four metrics.
- Works in latest Chrome, Safari, Firefox.
- Mobile-responsive at 375px.
- OG image renders when shared.

## Hard non-goals (do NOT implement in v1)

Adding any of these turns a weekend build into a 3-week build:

- Auth, saved plans, .ics export, share-to-social.
- Multi-country support.
- Company-specific leave rules (block leave, must-take days).
- Religious/personal exclusions.
- Animations, mobile app, multi-year planning, scenario comparison.

If the user asks for one of these, push back: it's a deliberate v2+ deferral.

## Attribution requirements

- Footer + `/about` must credit data.gov.sg under the Singapore Open Data Licence.
- One-line disclaimer at the bottom: *"Not affiliated with the Government of Singapore. Public holiday data from data.gov.sg."*
- MIT license on the repo.

## Commands

```bash
npm install
npm run dev
npm run build
npm run test
npm run fetch:holidays            # refresh src/data/holidays-sg.json
```

## Capturing screenshots

For desktop shots (≥500px wide), headless Chrome is fine:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --screenshot=docs/hero.png http://localhost:4321/
```

For **mobile shots (<500px wide), use Playwright** — headless Chrome on macOS silently floors `--window-size` to ~500px regardless of the flag value, so a `--window-size=375,812` capture is really a 500px render with the right side cropped off (looks like a layout bug, isn't):

```bash
npx --yes playwright@latest screenshot --viewport-size=375,812 --full-page \
  http://localhost:4321/ docs/mobile.png
```

The full story is in ARCHITECTURE.md §2 Hard problem #5.

## Working preferences for this repo

- Write algorithm tests **before** the algorithm itself (lesson from ARCHITECTURE.md §4 — wrote them after, had to refactor twice).
- When CSS layout feels weird, sketch on paper before writing more CSS (the 6-row month grid lesson).
- When a mobile screenshot looks broken, verify the *capture tool* renders at the requested width before "fixing" the page (Hard problem #5 — wasted ~30 min editing CSS that wasn't actually wrong).
- Prefer ~3 hours of fiddling with raw CSS Grid over pulling in a calendar library — bundle size and control matter here.
- Capture interview-grade notes about hard problems *as you solve them* in `ARCHITECTURE.md` §2, not weeks later.
