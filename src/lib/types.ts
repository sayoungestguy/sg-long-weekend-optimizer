export type Holiday = {
  date: string;
  name: string;
  year: number;
  dayOfWeek: number;
};

export type DayKind = "weekend" | "holiday" | "leave" | "workday";

export type Strategy = {
  id: string;
  startDate: string;
  endDate: string;
  totalDaysOff: number;
  leaveDaysUsed: number;
  efficiency: number;
  leaveDates: string[];
  holidaysIncluded: Holiday[];
};

export type OptimizerInput = {
  year: number;
  leaveBalance: number;
  includeSaturday: boolean;
};

export type OptimizerOutput = {
  topStrategies: Strategy[];
  totalLeaveDaysAvailable: number;
  totalPossibleDaysOff: number;
};
