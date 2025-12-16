import { Temporal } from "@js-temporal/polyfill";

export type MiniEvent = {
  id: string;
  title: string;
  start: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
  summary: string;
  zone: string;
  kind: "event" | "wake";
  editable: boolean;
  anchorId?: string;
  note?: string;
  displayTime?: string;
};
