# PRD: SG Long-Weekend Optimizer

> **Tagline:** Given your annual leave balance, find the optimal way to chain leave days with Singapore public holidays for maximum-length breaks.
>
> **Status:** Spec — ready for implementation.
> **Build effort:** 1 weekend (~10–12 focused hours).
> **Phase:** 1 (Foundations — no auth, no backend).

---

## 1. Problem & Audience

Every January, working adults in Singapore stare at the year's public holiday calendar and ask: *"How do I use my 14/18/21 days of leave to get the most days off?"* The naive approach (take leave whenever) wastes the natural bridge days that public holidays create when they fall on Tuesday or Thursday. Doing this optimally by hand for a whole year is tedious and error-prone.

**Target user:** Singapore-based working adult, 25–45, with a fixed annual leave allowance. Likely already using Google Calendar. Comfortable with a 30-second web tool. Not paying for an app.

**Success criteria for the user:** They leave with a list of leave days to take and an immediate visual confirmation of how those days yield long weekends and mini-vacations.

---

## 2. Goals & Non-Goals

### Goals (v1)
- Generate optimal leave-taking strategies for any year 2024–2027.
- Show each strategy as a date range, leave days used, and total contiguous days off.
- Visualize the result on a yearly calendar.
- Work entirely client-side (no backend, no API calls at runtime).
- Ship in one weekend.

### Non-Goals (v1)
- User accounts, saved plans, calendar export, sharing.
- Multi-country support (SG only).
- Modeling company-specific leave rules (block leave, "must take" days).
- Religious/personal preference exclusions ("don't suggest leave during Ramadan for me").
- Mobile app.

These are **deliberate** non-goals. Adding any of them turns a weekend build into a 3-week build.

---

## 3. User Stories

1. *As a user opening the app for the first time*, I want to see a sensible default (current year, 14 days leave) so I get instant value before configuring anything.
2. *As a user with 14 days of leave*, I want the app to surface the top 5–7 strategies, ranked by efficiency (days off per leave day used).
3. *As a user evaluating a strategy*, I want to see exactly which calendar dates the strategy uses, including the public holidays it leverages.
4. *As a user comparing strategies*, I want the calendar visualization to make it obvious which dates are PHs (red), weekends (gray), and proposed leave (green).
5. *As a user who wants to share a plan*, I want the URL to encode my inputs so I can bookmark or send the link.

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Astro 4+ (minimal template) | Static-first, near-zero JS by default, fast deploys |
| Styling | Tailwind CSS | Rapid, consistent, no design debt |
| Date utilities | `dayjs` + plugins (`isBetween`, `weekday`) | Tiny, sufficient |
| Testing | `vitest` | Native to Vite-based Astro |
| Hosting | Vercel | Free tier, atomic deploys, OG image API |
| Analytics | Vercel Web Analytics | Free, no consent banner needed |
| Data source | data.gov.sg public holidays dataset (`d_4e19214c3a5288eab7a27235f43da4fa`) | Authoritative, free, no auth |

**Important:** Holidays are fetched at **build time** via a script, not at runtime. This means zero API dependency in production.

---

## 5. Data Model

```typescript
// src/data/holidays-sg.json (generated)
type Holiday = {
  date: string;        // "2026-02-17"
  name: string;        // "Chinese New Year"
  year: number;        // 2026
  dayOfWeek: number;   // 0 = Sunday, 6 = Saturday
};

// In-memory types
type DayKind = "weekend" | "holiday" | "leave" | "workday";

type Strategy = {
  id: string;                    // "2026-cny-bridge-1"
  startDate: string;             // first day off
  endDate: string;               // last day off
  totalDaysOff: number;          // e.g. 9
  leaveDaysUsed: number;         // e.g. 3
  efficiency: number;            // totalDaysOff / leaveDaysUsed, e.g. 3.0
  leaveDates: string[];          // exact dates to take leave
  holidaysIncluded: Holiday[];   // PHs leveraged in this strategy
};

type OptimizerInput = {
  year: number;
  leaveBalance: number;
  includeSaturday: boolean;      // some users have 5.5-day work weeks
};

type OptimizerOutput = {
  topStrategies: Strategy[];     // sorted by efficiency desc, max 10
  totalLeaveDaysAvailable: number;
  totalPossibleDaysOff: number;  // sum across all selected strategies
};
```

---

## 6. The Optimization Algorithm (the hard part)

### Approach: Bridge Detection + Greedy Selection

This is **not** a true global optimum (that's NP-hard for the full year), but a heuristic that produces results indistinguishable from optimal in practice for SG's ~11 PHs/year.

```
1. Build a calendar of all 365/366 days, marking each as weekend, holiday, or workday.

2. For each public holiday H, examine the 5 days before and 5 days after H:
   - Identify "bridge candidates": sequences of workdays sandwiched
     between H and the nearest weekend (or another PH).
   - Example: PH falls on Tuesday. Monday is a 1-day bridge that yields
     a 4-day weekend (Sat, Sun, Mon-leave, Tue-PH).

3. For each bridge candidate, compute the resulting Strategy:
   - startDate = first weekend/PH day in the contiguous block
   - endDate = last weekend/PH day in the contiguous block
   - leaveDaysUsed = number of workdays in the block
   - totalDaysOff = (endDate - startDate) + 1
   - efficiency = totalDaysOff / leaveDaysUsed

4. Also generate "longer break" candidates: any contiguous run of
   weekends + PHs + ≤5 leave days in between. (e.g. a full week off
   around CNY when CNY falls Mon-Tue.)

5. Sort all candidates by efficiency descending. Tie-break by total
   days off descending.

6. Greedy selection: walk the sorted list, selecting strategies until
   leave balance is exhausted. Skip any strategy whose dates overlap
   with already-selected strategies. Exclude 0-leave candidates from
   the pool — they have Infinity efficiency, sort first, and would
   pre-empt better leave-using picks for the same range. Free stretches
   are factual (the calendar shows them) but they are not "strategies".

7. Return the selected strategies as `topStrategies`, plus 2–3 next-best
   alternates (not selected) so the user sees what they "missed".
```

### Edge Cases to Handle
- PHs falling on Sunday → observed on Monday. **Verified against dataset `d_8ef23381f9417e4d4254ee8b4dcdb176`: observance is NOT pre-applied.** The optimizer applies it via `applySundayObservedRule()`. SG only observes Sun → Mon — Saturday PHs (e.g. National Day 2025 on Sat Aug 9) are not observed.
- Two PHs in the same week (e.g. some years CNY spans 2 days mid-week).
- User's leave balance is 0 → return empty `topStrategies` (free stretches are not strategies). Friendly message in the UI.
- User's leave balance is huge (e.g. 30) → cap suggestions at 10 strategies.

### Test Fixtures (write these first)
- 2025: Christmas (Thu Dec 25) → 1 day leave (Fri Dec 26) yields 4-day weekend.
- 2026: CNY Feb 17–18 (Tue–Wed) → 1 day leave (Mon Feb 16) yields 5-day break.
- 2025: National Day (Sat Aug 9) → asserts Saturday PHs are NOT observed (negative test).
- Synthetic Sunday PH (e.g. Sun Apr 12 2026) → asserts `applySundayObservedRule()` injects the Monday entry.
- `leaveBalance === 0` → empty `topStrategies`.
- Determinism → same input ⇒ identical output (acts as a smoke test for the dayjs.utc discipline that prevents user-timezone drift).

---

## 7. Pages & Routes

| Route | Purpose |
|---|---|
| `/` | Main app: form + results + calendar |
| `/about` | One paragraph on what this is, why it's free, attribution to data.gov.sg |
| `/api/og` | Dynamic OG image generation (Vercel) |

State is encoded in URL params: `/?year=2026&leave=14&sat=false`

---

## 8. Components

```
src/components/
├── OptimizerForm.astro       # Inputs (year, leave balance, Sat toggle)
├── StrategyList.astro        # Ranked list of strategies
├── StrategyCard.astro        # Single strategy with date range + efficiency
├── YearCalendar.astro        # 12-month grid showing all marked days
├── MonthGrid.astro           # Single month, 7×6 CSS grid
└── DayCell.astro             # Single day with color/symbol per kind
```

---

## 9. UI Notes

- **Form is always visible** at top, sticky on scroll. User adjusts and sees results re-render instantly.
- **Strategy cards** show:
  - Date range (e.g. "Sat 14 Feb – Sun 22 Feb")
  - Big number: total days off
  - Small number: leave days used
  - Efficiency badge (e.g. "3.0x" — 3 days off per leave day)
  - Holiday names included ("Chinese New Year")
- **Calendar** at the bottom shows the full year with all markings.
  - PHs: red dot
  - Weekends: gray
  - Suggested leave: green
  - Selected strategy block: green border around the whole range
- **Hover a strategy card** → calendar highlights only that strategy's days.

---

## 10. Acceptance Criteria

The app is "done" when:

- [ ] Loads in <1 second on 4G mobile
- [ ] Default state (current year, 14 days leave) shows ≥5 strategies
- [ ] Changing year updates results without page reload
- [ ] Changing leave balance updates results without page reload
- [ ] Calendar correctly highlights PHs in the chosen year (verify against MOM website)
- [ ] All 5 algorithm tests pass in `vitest`
- [ ] No console errors or warnings
- [ ] Lighthouse score ≥95 on all four metrics
- [ ] Works in Chrome, Safari, Firefox (latest)
- [ ] Mobile-responsive (test at 375px width minimum)
- [ ] OG image renders for the homepage when shared on WhatsApp/Twitter

---

## 11. Out of Scope (Future Versions)

These are deliberately deferred. Add them in v2+ if the app gets traction.

- Save plans to local storage / accounts
- Export to .ics calendar file
- Compare two scenarios side-by-side
- "Block out" specific dates (school holidays, partner's leave)
- Multi-year planning
- Other countries (UK, AU, MY)
- Pretty animations for calendar transitions
- A/B test different ranking algorithms

---

## 12. Attribution & Licensing

- Holiday data: data.gov.sg, used under the Singapore Open Data Licence. Required to attribute in footer and `/about`.
- Code: MIT license on the repo.
- **Important:** App is not affiliated with any government agency. Add a one-line disclaimer at the bottom: *"Not affiliated with the Government of Singapore. Public holiday data from data.gov.sg."*
