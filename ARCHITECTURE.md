# Architecture & Retrospective: SG Long-Weekend Optimizer

> **Purpose of this doc:** Capture the architectural decisions, the genuinely hard parts, and the screenshot structure for the portfolio README. This is interview material — write it as you build, not after. The most truthful insights come within hours of the bug, not weeks.

---

## 1. Architectural Decisions

### Decision: Static-first with Astro instead of Next.js

**Context:** The app has zero runtime data needs after holidays are baked in.

**Choice:** Astro with no client-side framework (just islands of vanilla JS where needed).

**Trade-off accepted:** Slightly more work to wire up form interactivity vs. React's `useState`. Gained: ~50KB less JS shipped, near-instant LCP, simpler deploy.

**What I'd say in an interview:** *"Next.js would have been overkill. The page is essentially a form + a pure function + a render. Shipping a React runtime to do that is engineering theatre. Astro lets me ship the same UX with maybe 5KB of JS instead of 80KB, and the Lighthouse score reflects that."*

### Decision: Holidays baked at build time, not fetched at runtime

**Context:** data.gov.sg public holidays dataset is small (~50 rows for 4 years) and changes once a year.

**Choice:** A `scripts/fetch-holidays.ts` script downloads the dataset and writes JSON to `src/data/`. Re-run it manually when a new year is added.

**Trade-off accepted:** App is "stale" by up to a year unless I redeploy. Gained: zero runtime API dependency, infinite scalability, works offline.

**Alternative considered:** Fetching via `fetch()` at build time inside Astro (`---` block). I avoided this because if data.gov.sg has an outage during a deploy, the deploy fails. A pre-baked JSON file is a stable artifact.

### Decision: URL params as state, not a database

**Context:** Sharing/bookmarking is desirable but accounts are out of scope.

**Choice:** Encode `year`, `leave`, and `sat` as URL params; read them on load.

**Trade-off accepted:** Can't store user preferences across sessions. Gained: zero infrastructure, perfect privacy (URL never leaves user's machine until they share), free virality (share the link with your settings already applied).

### Decision: Exact DP, not greedy heuristic (revised after testing)

**Context:** The optimal-leave-allocation problem is a variant of the set-packing problem — NP-hard in the general case. I originally shipped a greedy heuristic (sort candidates by `totalDaysOff / leaveDaysUsed` desc, pick non-overlapping under budget) and assumed it would be within ~5% of optimum.

**What I actually found:** When I wrote the brute-force validator (`bruteForceMaxDaysOff()` — DP over the same candidate pool), the greedy was hitting only **75–89% of optimum** on real SG data. With 14 leave days in 2026, greedy returned 33 days off using 12 leave; the DP returned 37 days off using all 14. The greedy was exhausting its budget on small high-efficiency bridges and missing larger combinations.

**Choice:** Replace the greedy with the DP. Once the candidate pool is filtered (free-day-pair ranges containing ≥1 PH, ≤5 workdays inside), the problem is just weighted-interval scheduling with a budget — `f[i][l] = max(f[i-1][l], f[prev(i)][l - cost[i]] + value[i])`. O(n²) for the `prev` table + O(n × L) for the DP. With n≈100 candidates and L≤30, the whole solve runs in <5ms.

**Why this is defensible:** The original greedy's O(n) advantage was meaningless at this scale, and the DP gives true optimum for free. The story isn't "I was clever enough to write the right algorithm first" — it's "I wrote the test that proved my heuristic wasn't good enough, then upgraded the algorithm". That's what tests are for.

### Decision: No external libraries beyond `dayjs`

**Context:** Tempting to reach for date-fns, react-calendar, etc.

**Choice:** Build the calendar grid myself with CSS Grid.

**Trade-off accepted:** ~3 hours of fiddling with grid alignment. Gained: full control over rendering, no transitive dependencies, smaller bundle, deeper understanding of CSS Grid (interview talking point).

---

## 2. What Was Hard

This section is the most valuable for interviews. Be specific. *"It was hard"* is useless. *"I spent 90 minutes debugging X because Y"* is gold.

### Hard problem #1: PHs that fall on weekends

Singapore observes any PH that falls on Sunday on the following Monday (e.g. National Day if it falls on Sunday). I assumed the data.gov.sg dataset would list these as the **observed** date and the algorithm would need no special-casing.

**That assumption was wrong.** The dataset I ended up using (`d_8ef23381f9417e4d4254ee8b4dcdb176`, covering 2020–2026) lists the *original* date only — no synthetic Monday entries. I verified by checking 2026: National Day falls on Sun Aug 9 in the dataset with no Mon Aug 10 sibling, but MOM's official 2026 list does declare Aug 10 a public holiday. Same story for Vesak Day (Sun May 31 → Mon Jun 1) and Deepavali (Sun Nov 8 → Mon Nov 9).

**My fix:** A `applySundayObservedRule()` helper that walks the holiday list, and for any entry with `dayOfWeek === 0`, synthesises a follow-on Monday entry (skipping if a Monday PH already exists, which can happen when CNY/Easter clusters fall the right way). The helper runs once at the top of `optimize()` and once in the page wireup so the calendar shows observed Mondays too.

The mirror question — does Saturday → Monday observance apply? — turned out to be **no** under SG rules. Saturday PHs are simply Saturday PHs. I added a negative test (2025 National Day on Sat Aug 9) so future-me doesn't try to "fix" this back into observance.

**Lesson:** The 30 minutes of dataset spelunking I'd hoped would save 2 hours of code instead *justified* the 2 hours of code. Verify assumptions about external data before building on top of them, even when the assumption seems benign.

### Hard problem #2: The "is this strategy worth showing?" threshold

Every PH has at least one trivial strategy: take leave on the surrounding workday for a 3-day weekend. With 11 PHs, that's 11 boring strategies. The user wants the *interesting* ones.

**My fix:** Filter out strategies with `efficiency <= 2.0` unless the user has plenty of leave left and we're padding the list.

But I had to re-tune this **three** times because:
1. First version filtered too aggressively — Easter weekends got hidden because they're already 3 days off without any leave.
2. Second version showed too many — every Tuesday/Thursday PH became a strategy.
3. Third version (`efficiency >= 2.5 OR totalDaysOff >= 5`) silently broke the *selection* step: a 1-day "strategy" of just-the-PH-itself has `Infinity` efficiency, sorted to the top of the greedy list, and pre-empted the actual interesting bridge. E.g. for Christmas 2025, the greedy first picked `(Dec 25, Dec 25)` — consuming Dec 25 — and then rejected `(Dec 25, Dec 28)` (the Thu–Sun bridge with 1 leave day) for overlapping. The user effectively got their 1 leave day back unused.

The fix had two parts:
- **Display filter:** add a `totalDaysOff >= 3` floor to suppress single-PH "strategies" before they reach the UI.
- **Greedy pool:** require `leaveDaysUsed > 0`. 0-leave runs are factual ("you have a 3-day weekend already") and the calendar shows them, but they don't compete for the user's leave budget.

**Lesson:** A filter that affects ranking is doing two jobs (display + selection) and they have different criteria. Treat them as two functions, not one.

### Hard problem #3: CSS Grid for irregular months

Months don't start on Monday. February 2026 starts on Sunday. My naive grid (7 cols × 5 rows) overflowed for months that span 6 weeks.

**My fix:** `grid-template-rows: repeat(6, 1fr)` always. Pad with empty cells before day 1 and after the last day.

Time wasted: ~45 min on the wrong approach, 10 min on the right one. Lesson: when a layout problem feels weird, draw it on paper before writing CSS.

### Hard problem #4: Date math in user timezones

`dayjs()` defaults to user's local timezone. If a user in Tokyo opens the app, will Christmas 2025 still show as Thursday Dec 25?

**My fix:** Force all date construction through `dayjs.utc(...)` and only format for display. Dates from data.gov.sg are SGT but I treat them as date-only (no time), so timezone is moot.

This is the kind of bug that doesn't surface in dev because *I'm in SGT*. Worth writing a single test that constructs dates in a non-SGT timezone and verifies output.

### Hard problem #5: The mobile bug that wasn't a mobile bug

I screenshotted the app at 375×812 with headless Chrome to verify the responsive layout for the portfolio. The output looked broken — the form's "Saturday is a workday (5.5-day week)" label ran past the right edge, the summary line was cut off mid-word ("…across 5 strategie"), and strategy cards had their efficiency badges clipped. I "fixed" the form by stacking it vertically on small screens (`flex-col` + `sm:flex-row`) and added the missing `initial-scale=1` to the viewport meta tag.

The screenshot still looked broken.

The actual bug was in the screenshot tool, not the page. Headless Chrome on macOS silently **floors `--window-size` to ~500px** — `--window-size=375,812` produces a 500-wide render and a screenshot that captures only the leftmost 375px. I verified by injecting `document.body.innerHTML = window.innerWidth` into a probe page: it reported `500` for any window-size below that. Both classic and `--headless=new` had the same behaviour.

**My fix:** Switch to Playwright for any sub-500px screenshot:

```
npx --yes playwright@latest screenshot --viewport-size=375,812 --full-page \
  http://localhost:4321/ docs/mobile.png
```

Playwright sets the viewport via Chrome DevTools Protocol, which honours arbitrary widths. The page rendered correctly at 375 — the form, summary, and cards all fit. Both my "fixes" (vertical stacking on mobile, `initial-scale=1`) were defensible improvements but had nothing to do with the symptom.

**Lesson:** When a screenshot shows a layout bug, verify the *capture tool* is rendering at the dimensions you asked for *before* you change the page. Costed ~30 minutes of CSS edits and one wrong root-cause attribution.

### Hard problem #6: The Vercel deploy that failed three times in a row

After switching to hybrid SSR with `@astrojs/vercel@7.8.2`, the first Vercel deploy failed with:

```
The following Serverless Functions contain an invalid "runtime":
  - _render (nodejs18.x)
```

Vercel had deprecated the `nodejs18.x` Lambda runtime; any function declaring it gets rejected. The adapter was writing `nodejs18.x` because Vercel's build environment was running Node 18 by default (the project predated Vercel's switch to Node 20+ as the default), and the adapter mirrors the build-time Node version into `.vc-config.json`.

**Attempt 1:** Added `"engines": { "node": ">=20.0.0" }` to `package.json` to force a newer Node. The redeploy failed with the *same* error, plus this warning in the build log:

```
[WARN] [@astrojs/vercel/serverless]
The local Node.js version (24) is not supported by Vercel Serverless Functions.
Your project will use Node.js 18 as the runtime instead.
Consider switching your local version to 18.
```

Vercel saw `>=20`, picked the latest available (Node 24). `@astrojs/vercel@7.8.2` is from early 2025 and only knows about Node 18 and 20; it didn't recognise 24 and silently fell back to `nodejs18.x` — the very thing Vercel had just deprecated. The adapter's "graceful fallback" was guaranteed to fail.

**Attempt 2:** Pinned `"node": "20.x"` exactly. Vercel now picks Node 20, the adapter recognises it, writes `nodejs20.x`, deploy succeeds.

**Why this is a portfolio-worthy story:** the bug *looked* like a Vercel config issue (the error came from Vercel) but the root cause was a three-way version compatibility gap between Vercel's runtime support, Astro's adapter version, and the Node version Vercel chose for the build. Each piece made a defensible choice in isolation; combined, they deadlocked. The pin is a workaround. The proper fix is upgrading to Astro 5 + `@astrojs/vercel@8`, which natively supports modern Node — which I'll do before April 2026 when Vercel deprecates Node 20 too.

**Lesson:** When a build tool emits a warning and continues, the warning is the bug. Silent fallbacks to deprecated defaults are strictly worse than hard failures, because they ship and break in the next environment.

---

## 3. Trade-offs I Knew I Was Making

| Trade-off | Why I made it | When I'd revisit |
|---|---|---|
| No data persistence | Solves a weekend-build constraint | If the app gets >1k MAU |
| Greedy not optimal | Good enough within ±5% | Never, unless someone files a bug with a counter-example |
| English only | SG is multilingual but English suffices for v1 | If shared in Chinese/Malay/Tamil-language communities |
| No animations | Adds 1–2 hours; not core to value | When polishing for portfolio screenshots |
| Hardcoded year range 2024–2027 | Avoids re-deploying every January | Annually — set a calendar reminder |

---

## 4. What I'd Do Differently Next Time

- Write the algorithm tests **before** the algorithm itself. I wrote them after and had to refactor twice.
- Pick the design tokens (color palette, spacing scale) on Friday evening, not Saturday morning. I wasted 30 min picking shades of green.
- Set up Vercel preview deploys in the first 30 minutes. I wasted time on "is this committed yet" anxiety.

---

## 5. Screenshot Structure for Portfolio README

Capture these screenshots in this order. They tell the product story in a 30-second skim.

### Screenshot 1: Hero shot
- **What:** The full app on desktop, with default inputs producing 5+ strategies.
- **Resolution:** 1440×900, no browser chrome (use Chrome's "capture full size screenshot").
- **Caption:** *"Long-Weekend Optimizer: turns your annual leave into a ranked list of strategic breaks."*

### Screenshot 2: The calendar visualization
- **What:** Zoomed-in view of 3–4 months showing PHs, weekends, suggested leave color-coded.
- **Resolution:** 1200×600, cropped tight.
- **Caption:** *"Calendar view shows exactly which days to take leave and the resulting time off."*

### Screenshot 3: Mobile view
- **What:** iPhone mockup at 375px width showing form + first 2 strategies.
- **Resolution:** Use Mockuphone or similar.
- **Caption:** *"Fully responsive — works on phone for quick checks during commute."*

### Screenshot 4: Algorithm diagram (drawn, not screenshotted)
- **What:** A simple flowchart showing PH → bridge detection → scoring → greedy selection.
- **Tool:** Excalidraw or hand-drawn and photographed.
- **Caption:** *"Heuristic algorithm: O(n) bridge detection + greedy selection. Within 5% of true optimum."*

### Screenshot 5: Lighthouse score
- **What:** Lighthouse panel showing 100/100/100/100 (or close).
- **Resolution:** Native screenshot of devtools.
- **Caption:** *"Static-first architecture: ~5KB of JS, perfect Lighthouse scores."*

### Optional Screenshot 6: Code snippet
- **What:** The optimizer function signature and 5–10 lines of the core algorithm.
- **Tool:** Carbon or Ray.so for nice code screenshots.
- **Caption:** *"Core optimization in <100 LOC, fully tested with `vitest`."*

---

## 6. README Skeleton (root of repo)

The README itself should follow this exact structure (copy when you open the repo):

```markdown
# SG Long-Weekend Optimizer

> Find the optimal way to use your annual leave with Singapore public holidays.

[Live demo →](https://long-weekend.yoursite.dev)

![Hero screenshot](docs/hero.png)

## What it does
[2 sentences max]

## How it works
[1 paragraph on the algorithm — link to ARCHITECTURE.md for depth]

## Stack
- Astro + TypeScript
- Tailwind CSS
- `dayjs` for date math
- Vercel for hosting
- Public holidays from [data.gov.sg]

## Run locally
```bash
npm install
npm run dev
```

## Architecture deep-dive
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the engineering decisions, hard problems, and trade-offs.

## License
MIT
```

Recruiter eyes spend ~10 seconds on a README. The hero screenshot, the live link, and one sentence on the algorithm earn the click into ARCHITECTURE.md, which is where you actually demonstrate skill.
