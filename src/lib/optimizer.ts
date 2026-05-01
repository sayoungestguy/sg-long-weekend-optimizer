import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import type {
  Holiday,
  OptimizerInput,
  OptimizerOutput,
  Strategy,
} from "./types";

dayjs.extend(utcPlugin);

export const STRATEGY_FILTER = {
  minEfficiency: 2.5,
  minTotalDaysOff: 5,
  absoluteMinDaysOff: 3,
} as const;

const MAX_LEAVE_PER_STRATEGY = 5;
const MAX_STRATEGIES = 10;

export function isStrategyWorthShowing(s: Strategy): boolean {
  if (s.totalDaysOff < STRATEGY_FILTER.absoluteMinDaysOff) return false;
  return (
    s.efficiency >= STRATEGY_FILTER.minEfficiency ||
    s.totalDaysOff >= STRATEGY_FILTER.minTotalDaysOff
  );
}

/**
 * SG rule: a PH falling on Sunday is observed on the following Monday.
 * The data.gov.sg dataset does not pre-apply this — we synthesise the
 * observed entry here. Saturday PHs are NOT observed under SG rules.
 */
export function applySundayObservedRule(holidays: Holiday[]): Holiday[] {
  const dateSet = new Set(holidays.map((h) => h.date));
  const result = [...holidays];
  for (const h of holidays) {
    if (h.dayOfWeek !== 0) continue;
    const monday = dayjs.utc(h.date).add(1, "day");
    const mondayDate = monday.format("YYYY-MM-DD");
    if (dateSet.has(mondayDate)) continue;
    result.push({
      date: mondayDate,
      name: `${h.name} (observed)`,
      year: monday.year(),
      dayOfWeek: 1,
    });
    dateSet.add(mondayDate);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

type DayInfo = {
  date: string;
  isFree: boolean;
  isHoliday: boolean;
};

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function buildDayList(
  year: number,
  holidays: Holiday[],
  includeSaturday: boolean,
): DayInfo[] {
  const holidayDates = new Set(holidays.map((h) => h.date));
  const start = dayjs.utc(`${year}-01-01`);
  const len = isLeap(year) ? 366 : 365;
  const days: DayInfo[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const d = start.add(i, "day");
    const iso = d.format("YYYY-MM-DD");
    const dow = d.day();
    const isHoliday = holidayDates.has(iso);
    const isWeekend = dow === 0 || (dow === 6 && !includeSaturday);
    days[i] = { date: iso, isFree: isHoliday || isWeekend, isHoliday };
  }
  return days;
}

export function optimize(
  input: OptimizerInput,
  holidays: Holiday[],
): OptimizerOutput {
  const { year, leaveBalance, includeSaturday } = input;

  const observed = applySundayObservedRule(holidays);
  const holidayByDate = new Map(observed.map((h) => [h.date, h]));
  const days = buildDayList(year, observed, includeSaturday);

  const freeIndices: number[] = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i]!.isFree) freeIndices.push(i);
  }

  const candidates: Strategy[] = [];

  // Enumerate (a, b) pairs of free-day indices. Endpoints on free days
  // because any range with workday endpoints is dominated by shrinking
  // inward to the next free day (saves leave for equal-or-more days off).
  for (let i = 0; i < freeIndices.length; i++) {
    for (let j = i; j < freeIndices.length; j++) {
      const a = freeIndices[i]!;
      const b = freeIndices[j]!;

      let workdayCount = 0;
      let phCount = 0;
      const leaveDates: string[] = [];
      const phDates: string[] = [];
      for (let k = a; k <= b; k++) {
        const d = days[k]!;
        if (!d.isFree) {
          workdayCount++;
          leaveDates.push(d.date);
        } else if (d.isHoliday) {
          phCount++;
          phDates.push(d.date);
        }
      }

      // Workdays only grow as j grows; once we exceed cap, no recovery.
      if (workdayCount > MAX_LEAVE_PER_STRATEGY) break;
      if (phCount === 0) continue;

      const startDate = days[a]!.date;
      const endDate = days[b]!.date;
      const totalDaysOff = b - a + 1;
      const efficiency =
        workdayCount === 0 ? Infinity : totalDaysOff / workdayCount;

      candidates.push({
        id: `${year}-${startDate}-${endDate}`,
        startDate,
        endDate,
        totalDaysOff,
        leaveDaysUsed: workdayCount,
        efficiency,
        leaveDates,
        holidaysIncluded: phDates.map((d) => holidayByDate.get(d)!),
      });
    }
  }

  // Pool excludes 0-leave candidates: they're factual ("you have a 3-day
  // weekend already") and would otherwise pre-empt better leave-using
  // strategies covering the same range.
  const pool = candidates.filter(
    (c) => c.leaveDaysUsed > 0 && isStrategyWorthShowing(c),
  );

  // Weighted-interval scheduling with a leave-day budget, solved via DP.
  // Originally wrote a greedy (sort by efficiency desc, pick under budget)
  // but the brute-force test caught that on real SG data the greedy was only
  // 75–89% of optimum — it'd exhaust the budget on small high-efficiency
  // bridges and miss bigger combinations. The DP is O(n²) for n≈100 and
  // runs in <5ms, so there's no reason to use a worse algorithm.
  pool.sort((a, b) => a.endDate.localeCompare(b.endDate));
  const n = pool.length;

  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (pool[j]!.endDate < pool[i]!.startDate) {
        prev[i] = j;
        break;
      }
    }
  }

  const f: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(leaveBalance + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    const c = pool[i - 1]!;
    for (let l = 0; l <= leaveBalance; l++) {
      f[i]![l] = f[i - 1]![l]!;
      if (c.leaveDaysUsed <= l) {
        const useValue =
          f[prev[i - 1]! + 1]![l - c.leaveDaysUsed]! + c.totalDaysOff;
        if (useValue > f[i]![l]!) f[i]![l] = useValue;
      }
    }
  }

  // Backtrack to recover which candidates were selected
  const selected: Strategy[] = [];
  let i = n;
  let l = leaveBalance;
  while (i > 0) {
    const c = pool[i - 1]!;
    const usedHere =
      c.leaveDaysUsed <= l &&
      f[prev[i - 1]! + 1]![l - c.leaveDaysUsed]! + c.totalDaysOff === f[i]![l]!;
    if (usedHere) {
      selected.push(c);
      l -= c.leaveDaysUsed;
      i = prev[i - 1]! + 1;
    } else {
      i--;
    }
  }
  selected.reverse();

  // Cap displayed strategies (PRD acceptance criterion: max 10)
  const top = selected.slice(0, MAX_STRATEGIES);

  return {
    topStrategies: top,
    totalLeaveDaysAvailable: leaveBalance,
    totalPossibleDaysOff: top.reduce((s, x) => s + x.totalDaysOff, 0),
  };
}

/**
 * Exact optimum (DP) over the same candidate pool the heuristic uses.
 * Solves: pick a subset of non-overlapping candidates with sum(cost) <= budget
 * that maximises sum(value). O(n²) for the prev table + O(n × L) for the DP.
 *
 * This exists to validate the architectural claim in ARCHITECTURE.md §1 that
 * the greedy heuristic stays within ~5% of true optimum for SG's ~11 PHs/year.
 */
export function bruteForceMaxDaysOff(
  input: OptimizerInput,
  holidays: Holiday[],
): number {
  const { year, leaveBalance, includeSaturday } = input;
  const observed = applySundayObservedRule(holidays);
  const days = buildDayList(year, observed, includeSaturday);

  const freeIndices: number[] = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i]!.isFree) freeIndices.push(i);
  }

  type Cand = { startIdx: number; endIdx: number; cost: number; value: number };
  const candidates: Cand[] = [];

  for (let i = 0; i < freeIndices.length; i++) {
    for (let j = i; j < freeIndices.length; j++) {
      const a = freeIndices[i]!;
      const b = freeIndices[j]!;
      let workdayCount = 0;
      let phCount = 0;
      for (let k = a; k <= b; k++) {
        const d = days[k]!;
        if (!d.isFree) workdayCount++;
        else if (d.isHoliday) phCount++;
      }
      if (workdayCount > MAX_LEAVE_PER_STRATEGY) break;
      if (phCount === 0) continue;
      if (workdayCount === 0) continue;

      const totalDaysOff = b - a + 1;
      const efficiency = totalDaysOff / workdayCount;
      if (totalDaysOff < STRATEGY_FILTER.absoluteMinDaysOff) continue;
      if (
        efficiency < STRATEGY_FILTER.minEfficiency &&
        totalDaysOff < STRATEGY_FILTER.minTotalDaysOff
      ) {
        continue;
      }

      candidates.push({ startIdx: a, endIdx: b, cost: workdayCount, value: totalDaysOff });
    }
  }

  candidates.sort((a, b) => a.endIdx - b.endIdx);
  const n = candidates.length;

  // prev[i] = largest j < i where candidates[j].endIdx < candidates[i].startIdx
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (candidates[j]!.endIdx < candidates[i]!.startIdx) {
        prev[i] = j;
        break;
      }
    }
  }

  // f[i][l] = max value using candidates[0..i-1] with budget l
  const f: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(leaveBalance + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    const c = candidates[i - 1]!;
    for (let l = 0; l <= leaveBalance; l++) {
      f[i]![l] = f[i - 1]![l]!;
      if (c.cost <= l) {
        const useValue = f[prev[i - 1]! + 1]![l - c.cost]! + c.value;
        if (useValue > f[i]![l]!) f[i]![l] = useValue;
      }
    }
  }

  return f[n]![leaveBalance]!;
}

function rangeOverlapsSet(s: Strategy, used: Set<string>): boolean {
  let d = dayjs.utc(s.startDate);
  const end = dayjs.utc(s.endDate);
  while (d.isBefore(end) || d.isSame(end)) {
    if (used.has(d.format("YYYY-MM-DD"))) return true;
    d = d.add(1, "day");
  }
  return false;
}

function addRangeToSet(s: Strategy, used: Set<string>): void {
  let d = dayjs.utc(s.startDate);
  const end = dayjs.utc(s.endDate);
  while (d.isBefore(end) || d.isSame(end)) {
    used.add(d.format("YYYY-MM-DD"));
    d = d.add(1, "day");
  }
}
