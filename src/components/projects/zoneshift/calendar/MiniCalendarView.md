# Mini Calendar Layout Considerations

This mini calendar view is designed specifically for narrow phone-sized layouts where a traveller needs a quick sense of their upcoming week without panning through the denser timeline. Key considerations:

## Screen Fit & Scannability
- The entire 24-hour cycle fits inside a single viewport column by capping the column height at `min(26rem, 70vh)`. This prevents the line from exceeding the screen on compact devices while keeping hour-to-pixel ratios consistent.
- Columns are intentionally narrow (`w-28`) so that seven days fit within thumb reach and can be skimmed left-to-right. Horizontal overflow is enabled so longer plans are still reachable without zooming.

## Colour Coding & State Priority
- Each day is rendered as a vertical line where segments are colour-coded by state: deep blue for scheduled sleep, yellow for bright-light windows, and grey for all other periods. Sleep segments are carved first so they always take precedence, avoiding bright-light windows from overwriting rest periods.
- Colours mirror the broader Zoneshift palette to preserve mental models between views, and the neutral baseline ensures high contrast when states change hour-to-hour.

## Temporal Landmarks
- Horizontal guide lines mark every four hours so the entire day can be read at a glance, even on a phone screen. Labels sit just outside the column to reduce clutter while still providing an explicit reference for midnight, early-morning wake-ups, mid-day commitments, and late-night flights.

## Event Discovery & Interaction
- Event start times become tappable markers along the line, providing a spatial cue before engaging with text. The marker also doubles as a button to expand event details.
- A compact list of event buttons sits directly beneath each day. It offers an alternative enlargement target for accessibility and shows the formatted time range, reducing the need to open each event just to confirm timing.
- Expanded event cards reuse the generic button component so “Edit event” remains discoverable for power users without introducing bespoke controls.

## Mobile Ergonomics
- Touch targets (markers and list buttons) receive focus-visible rings for keyboard users and meet minimum 32px sizing once padding is accounted for.
- The mini header reiterates the display time zone so users switching between home and target zones have immediate context, critical when crossing time zones on the road.

## Fallback Behaviour
- When schedule data is unavailable the component returns a bordered placeholder matching other views, keeping onboarding consistent.
- Wake or sleep times missing from the model simply leave their portions grey, avoiding misleading assumptions about rest windows.
