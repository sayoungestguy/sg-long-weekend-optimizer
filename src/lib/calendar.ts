import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { DayKind, Holiday } from "./types";

dayjs.extend(utc);

export type CalendarDay = {
  date: string;
  kind: DayKind;
  holidayName?: string;
};

export function buildYearCalendar(
  year: number,
  holidays: Holiday[],
  includeSaturday: boolean,
): CalendarDay[] {
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));
  const start = dayjs.utc(`${year}-01-01`);
  const days: CalendarDay[] = [];

  for (let i = 0; i < (isLeap(year) ? 366 : 365); i++) {
    const d = start.add(i, "day");
    const iso = d.format("YYYY-MM-DD");
    const dow = d.day();

    let kind: DayKind;
    if (holidayMap.has(iso)) kind = "holiday";
    else if (dow === 0 || (dow === 6 && !includeSaturday)) kind = "weekend";
    else kind = "workday";

    days.push({
      date: iso,
      kind,
      holidayName: holidayMap.get(iso),
    });
  }

  return days;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
