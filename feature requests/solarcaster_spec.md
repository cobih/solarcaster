# Solarcaster — Feature Build Specifications

> Version 1.0 · April 2025 · Status: Draft — ready for build

Including test & acceptance criteria for all 5 priority features.

**Recommended build order: 4 → 1 → 3 → 2 → 5**

| # | Feature |
|---|---------|
| 1 | Plain-language appliance timing output |
| 2 | Probabilistic forecast output (P10 / P50 / P90) |
| 3 | Modelled vs actual accuracy tracker |
| 4 | Outlier filtering in calibration loop |
| 5 | Self-consumption & export breakdown |

---

## Feature 1 — Plain-language appliance timing output

### Description

Reads the hourly forecast curve and outputs a single human-readable sentence recommending the best window to run high-draw appliances. No new data inputs required — this is an interpretation layer on the existing forecast array.

### Logic

1. Find the 2–3 consecutive hours with the highest forecast kW output. That window = "peak window."
2. Compare peak window start time to current time (`browser Date.now()`).
3. Apply decision rules below to generate the output string.

### Decision rules

| Condition | Output string |
|-----------|--------------|
| Peak starts within 30 min of now | "Your best solar window is right now — good time to run the washing machine or dishwasher." |
| Peak is 1–4 hours away | "Peak output expected between [HH:MM]–[HH:MM]. Hold off on heavy appliances until then." |
| Peak has already passed today | "Your best window today was [HH:MM]. Tomorrow's peak is around [HH:MM]." |
| Total day forecast < 1 kWh | "Low generation day — not worth optimising around solar today." |
| E/W bimodal split | "Your west string peaks around [time] — best window for heavy use. East peaked at [time]." |

### UI placement

- Single sentence or two-line highlight card at the top of the dashboard, above the forecast chart.
- Distinct background (light blue/green tint) — never buried in data rows.
- Must be the first readable element for a non-technical user on mobile.

### Inputs

- Hourly kW forecast array (already computed by physics engine)
- Current time — browser `Date` object
- Optional: user-defined high-draw threshold in watts (default: 1000W)

### Edge cases

- **E/W split:** Peak will be bimodal. Pick the higher of the two peaks for the primary recommendation, but note both.
- **Cloudy day:** If no hour exceeds ~20% of rated capacity, show the low-generation message instead of a window.
- **Overnight:** If it's past 20:00, always show tomorrow's window.

### Test & acceptance criteria

| # | Test | Expected result | Type |
|---|------|----------------|------|
| T1.1 | Peak window is within 30 min of current time | Card displays "right now" variant. No time range shown. | Functional |
| T1.2 | Peak window is 2 hours away | Card shows correct start/end times in HH:MM format. Grammar is correct. | Functional |
| T1.3 | Peak window has already passed | Card shows today's peak time and tomorrow's expected peak time. | Functional |
| T1.4 | Total day forecast < 1 kWh | Low generation message shown. No time recommendation displayed. | Functional |
| T1.5 | E/W bimodal profile (two peaks >1 hour apart) | Both peaks identified. Output references the higher of the two for primary recommendation. | Functional |
| T1.6 | User has set custom threshold of 500W | Recommendation window uses 500W floor, not default 1000W. | Functional |
| T1.7 | Current time is after 20:00 | Output references tomorrow's window, not today's. | Edge case |
| T1.8 | Forecast API returns zero for all hours (outage / night) | Fallback message shown. No crash or blank card. | Edge case |
| T1.9 | Card renders on mobile viewport (375px wide) | Full sentence visible without horizontal scroll. Font legible at default zoom. | UX |
| T1.10 | Card renders correctly in both light and dark mode | Background tint, text colour, and contrast all pass WCAG AA. | UX |
| T1.11 | User in IST (UTC+5:30) | Recommendation reflects local time, not UTC. No off-by-one hour error. | Edge case |
| T1.12 | Card appears within 200ms of forecast data loading | No visible delay between chart render and card appearance. | Performance |

---

## Feature 2 — Probabilistic forecast output (P10 / P50 / P90)

### Description

Replace the single forecast line with three lines — pessimistic (P10), most likely (P50), and optimistic (P90) — displayed as a shaded confidence band with a central line. Exposes the same data via the JSON API for Home Assistant battery automations.

### How to generate percentiles

Open-Meteo does not natively return irradiance percentiles. Model uncertainty using `cloud_cover` as the proxy variable:

| Cloud cover | Uncertainty band |
|-------------|-----------------|
| 0–20% | Narrow: P10 = P50 × 0.92 / P90 = P50 × 1.08 |
| 20–60% | Medium: P10 = P50 × 0.82 / P90 = P50 × 1.18 |
| 60–100% | Wide: P10 = P50 × 0.70 / P90 = P50 × 1.30 |

Apply per hour. P50 is the existing physics engine output, unchanged. Cap P90 at the string's rated peak kW — it cannot exceed hardware limits.

### Chart rendering

- **P50:** solid line (existing line, unchanged)
- **P10–P90 band:** filled area, ~12% opacity, same colour as the P50 line
- **Legend:** "Shaded area = likely range based on cloud cover uncertainty" — shown below the chart
- **Tooltip on hover:** shows P10, P50, P90 values for that specific hour

### JSON API additions

Add three fields per hourly entry alongside the existing `kw` field:

```json
{
  "p10": 1.8,
  "p50": 2.2,
  "p90": 2.6
}
```

The existing `kw` field remains for backwards compatibility but should be deprecated with a note: *"Use p50 — kw will be removed in v2."*

### Battery copy

Add a static note below the chart on the HA integration page: *"For battery pre-charging, use the P10 (pessimistic) figure to avoid over-relying on solar that may not arrive."*

### Test & acceptance criteria

| # | Test | Expected result | Type |
|---|------|----------------|------|
| T2.1 | Cloud cover = 10% for all hours | P10 = P50 × 0.92 and P90 = P50 × 1.08 for every hour. Delta tolerance ±0.01 kWh. | Functional |
| T2.2 | Cloud cover = 80% for all hours | P10 = P50 × 0.70 and P90 = P50 × 1.30. Wide band visible on chart. | Functional |
| T2.3 | P90 exceeds rated string peak kW | P90 is capped at rated peak. No value above hardware maximum appears in chart or API. | Functional |
| T2.4 | JSON API response for a configured system | Response includes p10, p50, p90 fields per hour. kw field still present. All values are numbers, not null. | Functional |
| T2.5 | Hover tooltip on chart at any hour | Tooltip shows p10, p50, p90 for that specific hour. Values match API output. | Functional |
| T2.6 | Chart renders shaded band | Band visible between P10 and P90. Opacity approximately 12% (not solid, not invisible). Colour matches P50 line. | UX |
| T2.7 | Legend is present below chart | "Shaded area = likely range based on cloud cover uncertainty" text visible. No cut-off on mobile. | UX |
| T2.8 | Battery copy note shown on HA integration tab | "For battery pre-charging, use the P10 figure" note appears. No copy errors or placeholder text. | UX |
| T2.9 | Backwards compatibility: existing kw field | kw field still returns the same value as p50. No breaking change for existing API consumers. | Functional |
| T2.10 | Mixed cloud cover (morning clear, afternoon cloudy) | Band is narrow in clear hours and wide in cloudy hours. Per-hour multiplier applied correctly. | Functional |
| T2.11 | E/W system — two strings | Each string's band computed independently. Combined chart shows correct aggregate band. | Functional |
| T2.12 | Chart renders within 300ms after forecast data loads | No visible jank or progressive band drawing on desktop or mobile. | Performance |

---

## Feature 3 — Modelled vs actual accuracy tracker

### Description

A secondary view (separate tab or collapsible panel) showing a rolling 30-day chart of forecast vs inverter actuals, with a per-day delta column and summary statistics. Turns the calibration loop from a background process into something users actively engage with.

### Data model — what to store per day

| Field | Description |
|-------|-------------|
| `date` | ISO format string e.g. `"2025-04-25"` — keyed per user |
| `modelled_kwh` | What Solarcaster predicted — **must be snapshotted at forecast generation**, before actuals are entered |
| `actual_kwh` | What the user entered |
| `delta_pct` | `(actual - modelled) / modelled × 100`, rounded to 1 decimal |
| `efficiency_factor` | The calibrated efficiency value on that day |
| `calibration_excluded` | Boolean — `true` if user manually excluded this day |

> **Critical:** `modelled_kwh` must be written to Firebase at forecast generation time each morning, before the user can enter actuals. If you wait until actuals are submitted, the baseline is lost.

### Chart specification

- **Type:** Grouped bar chart — modelled vs actual kWh per day, last 30 days on X-axis
- **Overlay:** Line showing rolling 7-day average delta %
- **Axes:** kWh on left (bars) / % on right (line). Most recent date on the right.
- **Outlier flag:** Red marker on bars where `abs(delta) > 25%`. Tooltip: *"Large delta — consider excluding."*
- **Excluded day:** Greyed-out bars. Tooltip: *"Excluded from calibration."*

### Summary cards above the chart

| Card | Content |
|------|---------|
| Average error (30d) | Mean `abs(delta_pct)` across last 30 non-excluded days, shown as ±X.X% |
| Best day | Date with lowest `abs(delta_pct)`. Format: "Apr 12 — 0.4% off" |
| Worst day | Date with highest `abs(delta_pct)`. Format: "Mar 3 — 22% off (possible outlier?)" |
| Calibration days | Count of days with actuals submitted out of last 30 |

### Outlier flag & exclusion

- Any day where `abs(delta_pct) > 25%` receives a visual flag on the bar.
- One-click "Exclude from calibration" toggle per day — updates `calibration_excluded` in Firebase immediately.
- Excluded days still appear on chart (greyed) but do not count in summary stats or efficiency model.

### Test & acceptance criteria

| # | Test | Expected result | Type |
|---|------|----------------|------|
| T3.1 | User enters actuals for today | New bar appears. `modelled_kwh` retrieved from snapshot, not recalculated. Delta shown correctly. | Functional |
| T3.2 | `modelled_kwh` snapshot was not written (user's first day) | Day shown with "No forecast baseline" label. Delta not calculated. No crash. | Edge case |
| T3.3 | Day with delta > 25% | Red marker appears on that bar. Tooltip reads "Large delta — consider excluding from calibration." | Functional |
| T3.4 | User clicks "Exclude from calibration" | Bar turns grey immediately. Day removed from average error and best/worst calculations. Firebase updated. | Functional |
| T3.5 | User re-includes an excluded day | Bar returns to normal colour. Stats recalculate. Firebase updated. | Functional |
| T3.6 | 30-day rolling window: day 31 falls off | Oldest bar disappears. All stats recalculate for current 30-day window. | Functional |
| T3.7 | Summary card: Average error | Calculation matches manual sum of `abs(delta_pct)` / count of non-excluded days. Tolerance ±0.1%. | Functional |
| T3.8 | Summary card: Best and worst day | Correct dates shown. Labels match the bar chart. | Functional |
| T3.9 | Rolling 7-day delta line | Line is smooth. On days 1–6, line uses available data. No null or zero gap. | Functional |
| T3.10 | User has no actuals yet | Empty state: "Enter your first inverter actual to start tracking accuracy." No broken chart. | Edge case |
| T3.11 | Chart renders on mobile (375px) | Bars legible. Date labels don't overlap. Toggle accessible by touch. | UX |
| T3.12 | Firebase write on exclusion toggle | UI reflects change optimistically. Firebase write confirmed within 2 seconds on standard connection. | Performance |

---

## Feature 4 — Outlier filtering in calibration loop

### Description

Prevents a single bad actual (inverter fault, panel snow, curtailment) from corrupting the efficiency factor used across all future forecasts. Runs automatically on every actual submission and prompts the user if a potential outlier is detected.

> Build this first. It is a data integrity fix — every actual submitted before it ships risks corrupting the efficiency model.

### Detection logic — runs on every actuals submission

| Step | Action |
|------|--------|
| 1 | Compute raw delta: `delta = (actual - modelled) / modelled` |
| 2 | Retrieve last 7 accepted (non-excluded) actuals |
| 3 | Compute mean and standard deviation of their deltas |
| 4 | Flag if today's delta is > 2 standard deviations from recent mean |
| 5 | Also flag unconditionally if `delta < -0.40` (actual >40% below model) |
| Early stage | Fewer than 7 actuals in history: skip std dev check. Apply only the hard 40% threshold. |

### UI behaviour when flagged

- Do **not** silently discard. Show a warning card immediately after submission.
- Warning text: *"Today's actual is [X]% below the model forecast. This looks unusual."*
- Two buttons: **"Include anyway"** / **"Exclude this day"**
- If excluded: store with `calibration_excluded: true`. Accuracy tracker shows greyed bar.
- If force-included: store with `calibration_excluded: false` and `outlier_overridden: true` for audit.

### Efficiency factor update — EWMA

Once an actual passes the filter (or is force-included), update the efficiency factor:

```
new_efficiency = 0.85 × previous_efficiency + 0.15 × day_efficiency
```

| Parameter | Value |
|-----------|-------|
| Decay factor λ | 0.85 — recent days weighted more than older ones |
| `day_efficiency` | `actual_kwh / theoretical_clear_sky_kwh` for that day |
| Storage | One record per day in Firebase — full history kept for trend visualisation |

### Test & acceptance criteria

| # | Test | Expected result | Type |
|---|------|----------------|------|
| T4.1 | Actual is within normal range (delta −10%) | No warning shown. Efficiency factor updated via EWMA. Stored with `calibration_excluded: false`. | Functional |
| T4.2 | Actual is 45% below model (hard threshold) | Warning card shown regardless of history. Shows percentage delta. Both buttons visible. | Functional |
| T4.3 | Actual is 2.5 std devs below recent mean | Warning card shown. Percentage delta and comparison to recent average displayed. | Functional |
| T4.4 | Fewer than 7 actuals in history | Only hard 40% threshold applied. No std dev check. No false warnings on noisy early data. | Edge case |
| T4.5 | User clicks "Exclude this day" | Stored with `calibration_excluded: true`. EWMA not updated. Accuracy tracker shows greyed bar. | Functional |
| T4.6 | User clicks "Include anyway" on flagged day | Stored with `calibration_excluded: false`, `outlier_overridden: true`. EWMA updated. No second warning. | Functional |
| T4.7 | EWMA calculation correctness | After 3 actuals with known efficiency values, final EWMA matches hand calculation within ±0.001. | Functional |
| T4.8 | Efficiency factor history stored | Firebase contains one record per submitted actual. Values retrievable for trend display. | Functional |
| T4.9 | Actual is 50% above model (unusually high) | Hard threshold triggers for large positive deltas too. Warning shown. | Edge case |
| T4.10 | Warning card renders on mobile | Both buttons accessible by touch. Warning text does not overflow card bounds. | UX |
| T4.11 | Consecutive flagged days (e.g. 3-day fault) | Each day independently assessed. No cascading exclusions or corrupted mean/std dev from excluded days. | Edge case |
| T4.12 | Firebase write on actual submission | User sees confirmation of save within 1.5s on standard connection. No spinner timeout. | Performance |

---

## Feature 5 — Self-consumption & export breakdown

### Description

Given the forecast, estimates how much generated energy will be self-consumed vs exported to the grid vs imported from the grid. Translates kWh into estimated financial value using Irish microgeneration export rates. Connects the forecast to real financial outcomes for the first time.

### One-time setup inputs (user profile)

| Input | Default | Notes |
|-------|---------|-------|
| Daily consumption (kWh) | 12 kWh/day | Entered manually |
| Battery capacity (kWh) | 0 | Optional. Enter 0 if no battery. |
| On microgeneration scheme? | — | Yes/No toggle |
| Export rate (€/kWh) | 0.21 | Labelled "SEAI standard rate — update if your tariff differs" |
| Import rate (€/kWh) | 0.40 | Standard Irish unit rate |

### Calculation logic (per hour)

```
generation  = forecast_kw[hour]
consumption = daily_kwh / 24        // flat profile — simplified v1
net         = generation - consumption

if net > 0:
    self_consumed = consumption
    exported      = net  (capped by battery headroom if battery present)
else:
    self_consumed = generation
    exported      = 0
    grid_import   = abs(net)
```

Sum all daylight hours to get daily totals for `self_consumed`, `exported`, and `grid_import`.

### Output — three metric cards below the forecast chart

| Card | Content |
|------|---------|
| Self-consumed | "9.2 kWh — saved ~€3.68 vs grid import" (value = kWh × import_rate) |
| Exported | "4.1 kWh — est. €0.86 today" (value = kWh × export_rate) |
| Grid import needed | "6.8 kWh — est. €2.72" (value = kWh × import_rate) |

**Summary line below the cards:** *"Tomorrow's solar could save you an estimated €X in avoided grid costs."*

### Microgeneration nudge (non-scheme users)

If the user is NOT on the scheme, label exported kWh as: *"Potential export value if you join the microgeneration scheme: €X.XX."* Include a link to the SEAI microgeneration page.

### Simplification to disclose

Add a tooltip on the consumption card: *"Based on flat consumption profile (daily average divided evenly across 24 hours). Add a time-of-use profile for more accurate results."*

Time-of-use profiles are a v2 feature — do not build now.

### Test & acceptance criteria

| # | Test | Expected result | Type |
|---|------|----------------|------|
| T5.1 | 12 kWh/day consumption, no battery, 8 kWh forecast | Self-consumed = 8 kWh. Exported = 0. Grid import = 4 kWh. Values match manual calc. | Functional |
| T5.2 | 8 kWh/day consumption, no battery, 12 kWh forecast | Exported = 4 kWh. Self-consumed = 8 kWh. Grid import = 0. Financial values correct at default rates. | Functional |
| T5.3 | 5 kWh battery, forecast produces 8 kWh surplus | Exported capped at surplus minus battery headroom. Battery absorbs remainder before export. | Functional |
| T5.4 | User is on microgeneration scheme (toggle: Yes) | Export card shows €value using export_rate. No nudge text shown. | Functional |
| T5.5 | User is NOT on microgeneration scheme (toggle: No) | Export card shows "Potential value if you join the scheme: €X.XX." SEAI link present and functional. | Functional |
| T5.6 | User overrides export rate to 0.24 | All export financial calculations update immediately. No page reload required. | Functional |
| T5.7 | User overrides import rate to 0.35 | Self-consumed savings and grid import cost update immediately. | Functional |
| T5.8 | Low generation day (<1 kWh total) | Self-consumed = 0 kWh generation. Grid import card shows full daily consumption cost. No divide-by-zero error. | Edge case |
| T5.9 | Summary line financial figure | "Tomorrow's solar could save you an estimated €X" — value matches (self_consumed × import_rate) + (exported × export_rate). | Functional |
| T5.10 | Tooltip on consumption card | "Based on flat consumption profile" tooltip appears on hover/tap. Text matches spec exactly. | UX |
| T5.11 | Three metric cards on mobile (375px) | Cards stack vertically. No truncated text. Currency symbols visible. | UX |
| T5.12 | Setup inputs persist across sessions | Consumption, battery, scheme toggle, and rates saved to Firebase. Pre-populated on next login. No re-entry required. | Functional |

---

## Appendix — Build order rationale

**Feature 4 first.** Data integrity fix. Every actual submitted before it ships risks corrupting the efficiency model. Also the lowest-effort item — mostly Firebase write logic and a warning modal.

**Feature 1 second.** Highest-impact UX change for Reddit launch. Requires no new data — pure interpretation layer on the existing forecast array. Ship before posting to r/ireland.

**Feature 3 third.** Once actuals flow cleanly through the outlier filter, the tracker gives users a reason to return weekly. Creates the feedback loop needed to see where the model is weakest.

**Feature 2 fourth.** Requires adding `cloud_cover` to the Open-Meteo API call and an additional computation pass. Validates better once you have real actuals to compare against.

**Feature 5 last.** Requires the most new user input (consumption, battery, rates) and the most UI surface area. Most Ireland-specific — launch after the community is established.

---

*Solarcaster — Feature Specifications v1.0 — Confidential*
