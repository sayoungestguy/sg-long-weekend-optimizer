import { describe, it, expect } from "vitest";
import {
  optimize,
  applySundayObservedRule,
  bruteForceMaxDaysOff,
} from "./optimizer";
import type { Holiday } from "./types";
import realHolidays from "../data/holidays-sg.json";

const fixtures: Record<string, Holiday[]> = {
  "2025-christmas": [
    { date: "2025-12-25", name: "Christmas Day", year: 2025, dayOfWeek: 4 },
  ],
  "2026-cny": [
    { date: "2026-02-17", name: "Chinese New Year", year: 2026, dayOfWeek: 2 },
    { date: "2026-02-18", name: "Chinese New Year", year: 2026, dayOfWeek: 3 },
  ],
  "2025-national-day": [
    { date: "2025-08-09", name: "National Day", year: 2025, dayOfWeek: 6 },
  ],
  "synthetic-sunday-ph": [
    // A made-up Sunday PH to verify observance handling without depending on
    // a real-year coincidence. April 12, 2026 is a Sunday.
    { date: "2026-04-12", name: "Synthetic Holiday", year: 2026, dayOfWeek: 0 },
  ],
};

describe("optimizer", () => {
  it("2025 Christmas (Thu): 1 leave day on Fri Dec 26 yields a 4-day weekend", () => {
    const out = optimize(
      { year: 2025, leaveBalance: 1, includeSaturday: false },
      fixtures["2025-christmas"]!,
    );
    const top = out.topStrategies[0]!;
    expect(top.leaveDates).toEqual(["2025-12-26"]);
    expect(top.totalDaysOff).toBe(4);
    expect(top.startDate).toBe("2025-12-25");
    expect(top.endDate).toBe("2025-12-28");
  });

  it("2026 CNY (Tue–Wed): 1 leave day on Mon Feb 16 yields a 5-day break", () => {
    const out = optimize(
      { year: 2026, leaveBalance: 1, includeSaturday: false },
      fixtures["2026-cny"]!,
    );
    const top = out.topStrategies[0]!;
    expect(top.leaveDates).toEqual(["2026-02-16"]);
    expect(top.totalDaysOff).toBe(5);
    expect(top.startDate).toBe("2026-02-14");
    expect(top.endDate).toBe("2026-02-18");
  });

  it("Sunday PH triggers an observed Monday entry", () => {
    const out = applySundayObservedRule(fixtures["synthetic-sunday-ph"]!);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      date: "2026-04-13",
      dayOfWeek: 1,
    });
    expect(out[1]!.name).toMatch(/observed/i);
  });

  it("Saturday PH does NOT trigger Monday observance (SG rule)", () => {
    const out = applySundayObservedRule(fixtures["2025-national-day"]!);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2025-08-09");
  });

  it("leaveBalance=0 returns no strategies (free stretches are not strategies)", () => {
    const out = optimize(
      { year: 2026, leaveBalance: 0, includeSaturday: false },
      fixtures["2026-cny"]!,
    );
    expect(out.topStrategies).toEqual([]);
    expect(out.totalLeaveDaysAvailable).toBe(0);
    expect(out.totalPossibleDaysOff).toBe(0);
  });

  it("output is deterministic for identical inputs", () => {
    const a = optimize(
      { year: 2026, leaveBalance: 5, includeSaturday: false },
      fixtures["2026-cny"]!,
    );
    const b = optimize(
      { year: 2026, leaveBalance: 5, includeSaturday: false },
      fixtures["2026-cny"]!,
    );
    expect(a).toEqual(b);
  });
});

describe("optimize() vs brute-force optimum", () => {
  // Validates the ARCHITECTURE.md §1 claim that the greedy heuristic stays
  // within ~5% of true optimum on real SG data.
  const years = [2024, 2025, 2026];
  const balances = [3, 7, 14, 21];

  for (const year of years) {
    for (const leaveBalance of balances) {
      it(`${year} with ${leaveBalance} leave days: heuristic ≥ 95% of optimum`, () => {
        const yearHolidays = (realHolidays as Holiday[]).filter(
          (h) => h.year === year,
        );
        const heuristic = optimize(
          { year, leaveBalance, includeSaturday: false },
          yearHolidays,
        );
        const exact = bruteForceMaxDaysOff(
          { year, leaveBalance, includeSaturday: false },
          yearHolidays,
        );
        const ratio = exact === 0 ? 1 : heuristic.totalPossibleDaysOff / exact;
        expect(ratio).toBeGreaterThanOrEqual(0.95);
      });
    }
  }
});
