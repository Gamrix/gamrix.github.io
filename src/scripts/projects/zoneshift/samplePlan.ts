import type { CorePlan } from "./model";

export const sampleCorePlan: CorePlan = {
  id: "zoneshift-demo",
  version: 1,
  params: {
    homeZone: "America/Los_Angeles",
    targetZone: "Asia/Taipei",
    startSleepUtc: "2024-10-17T08:30:00Z",
    sleepHours: 8,
    maxShiftLaterPerDayHours: 1.5,
    maxShiftEarlierPerDayHours: 1,
  },
  anchors: [
    {
      id: "taipei-morning-market",
      kind: "wake",
      instant: "2024-10-21T01:00:00Z",
      zone: "Asia/Taipei",
      note: "Meet friends for breakfast",
    },
  ],
  events: [
    {
      id: "flight-out",
      title: "Flight to Taipei",
      start: "2024-10-18T05:00:00Z",
      end: "2024-10-18T17:30:00Z",
      zone: "America/Los_Angeles",
      colorHint: "peach",
    },
    {
      id: "check-in",
      title: "Hotel Check-In",
      start: "2024-10-19T14:00:00Z",
      end: "2024-10-19T15:00:00Z",
      zone: "Asia/Taipei",
      colorHint: "peach",
    },
  ],
  prefs: {
    displayZone: "target",
    timeStepMinutes: 30,
  },
};
