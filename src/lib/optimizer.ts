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

  // Greedy pool excludes 0-leave candidates: they're factual ("you have a
  // 3-day weekend already") and would otherwise pre-empt better leave-using
  // strategies covering the same range.
  const pool = candidates.filter(
    (c) => c.leaveDaysUsed > 0 && isStrategyWorthShowing(c),
  );

  pool.sort((a, b) => {
    if (b.efficiency !== a.efficiency) return b.efficiency - a.efficiency;
    return b.totalDaysOff - a.totalDaysOff;
  });

  const selected: Strategy[] = [];
  const usedDays = new Set<string>();
  let leaveLeft = leaveBalance;

  for (const c of pool) {
    if (selected.length >= MAX_STRATEGIES) break;
    if (c.leaveDaysUsed > leaveLeft) continue;
    if (rangeOverlapsSet(c, usedDays)) continue;
    selected.push(c);
    leaveLeft -= c.leaveDaysUsed;
    addRangeToSet(c, usedDays);
  }

  return {
    topStrategies: selected,
    totalLeaveDaysAvailable: leaveBalance,
    totalPossibleDaysOff: selected.reduce((s, x) => s + x.totalDaysOff, 0),
  };
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
