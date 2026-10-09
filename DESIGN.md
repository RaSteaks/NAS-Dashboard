---
version: alpha
name: "NAS Dashboard"
description: "A quiet NAS instrument panel with precise telemetry and visible data freshness."
colors:
  background: "#f5f7f9"
  surface: "#ffffff"
  text: "#20292f"
  secondary: "#59656e"
  muted: "#65717c"
  border: "#e5e9ed"
  grid: "#eef1f4"
  primary: "#216fa8"
  primary-hover: "#195987"
  primary-soft: "#e9f3fa"
  memory: "#8170c4"
  memory-soft: "#f0edf9"
  network: "#2a82c2"
  network-soft: "#e9f3fa"
  upload: "#b77831"
  upload-soft: "#f9f0e3"
  warning: "#946315"
  warning-soft: "#fbf3e3"
  danger: "#b23c42"
  focus: "#217bce"
typography:
  sans:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  data:
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif'
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
rounded:
  control: "6px"
  panel: "8px"
spacing:
  page: "32px"
  gap: "20px"
components:
  button:
    height: "36px"
    rounded: "{rounded.control}"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
  dialog:
    width: "480px"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
---

# NAS Dashboard Design System

## Overview

### Creative North Star

A Synology administration instrument panel: small device identity, four aligned
resource readouts, thin telemetry traces, and a clear volume capacity meter.
The four different measurement colors are the visual signature, not decoration.

### Product context and register

- Audience: a NAS owner checking resource pressure, volume space, and connectivity.
- Locale: Simplified Chinese, `zh-CN`; displayed sample times use `Asia/Shanghai`.
- Usage: repeated desktop checks and quick mobile checks in a private network.
- Register: product tool, opening directly into monitoring or first-run connection.
- Evidence: current user brief and the referenced Web Station / Glances discussion.
- Anti-references: marketing heroes, oversized metrics, a terminal clone, decorative
  gradients, and falsely reassuring connected status when the source is unavailable.
- Token ownership: `site/styles.css :root` is canonical. Frontmatter mirrors those
  accepted values. `colors.name` maps to `--color-name`; rounded control/panel maps
  to `--radius-control` / `--radius-panel`; spacing maps to `--space-page` / `--space-gap`.
  Chart.js reads those CSS variables through `site/js/ui/chart.js` rather than
  copying palette literals. DOM widgets use shared classes in the same stylesheet.

## Colors

Cool neutral surfaces, graphite labels, blue actions and CPU traces, lavender
memory traces, lighter blue received traffic, and ochre sent traffic. Action blue
is deeper than the brand mark to preserve text and button-label contrast. Warning and failure
states carry text as well as color. This release uses one light theme, with a
system-color path under forced colors. Scrollbar tokens apply globally.

## Typography

System Chinese-capable body fonts avoid external font loading. Numeric readouts
use Avenir Next where available and tabular numbers; technical paths use a system
monospace stack. Letter spacing is zero. Desktop page heading is 27px, metric
numbers 32px, body 14px, compact operational labels 10-12px. Fonts do not scale
with viewport width. Long hostnames and container names wrap without clipping.

## Layout

The 220px desktop sidebar narrows to an icon rail at 850px and a compact header at
680px, where a horizontal view strip under the topbar replaces the hidden sidebar
links. Navigation switches between the overview and hash-routed detail views
(`#resources`, `#storage`, `#network`, `#containers`) instead of scrolling.
Content uses natural document scrolling and a 1600px maximum width. Four
resource cards become two columns on mobile. Monitoring widgets use two columns
and then one; detail cards and volume cards follow the same two-to-one collapse.
Chart frames have stable heights; the container table has its own
horizontal overflow and a six-item page on the overview (twelve on the detail
view). Loading and connectivity notices have
reserved geometry. Device identification and uptime stay visible on narrow screens.

## Elevation & Depth

Panels are functional instrument frames with thin borders. No nested cards,
floating section surfaces, gradients, or blur. Elevation is limited to the settings
dialog and the selected segmented control.

## Shapes

Controls use 6px corners; panels use 8px. Status dots and the switch are circular
only because their conventional semantics require it. No pill-shaped tool labels.

## Components

### Foundational visual states

Disabled controls keep geometry and use reduced opacity. Hover is quiet; keyboard
focus uses a visible blue outline. Loading rotates an existing refresh icon without
changing button text width. Unknown metrics remain `--`; absent API fields never
become measured zeros. Freshness and connection are explicit states.

### Buttons and actions

Monitoring settings has one manual entry in the shared sidebar, retained in its
compact header layout on narrow screens. It has a visible desktop label and an
accessible name and tooltip in icon-only layouts. The topbar and monitoring
toolbars contain no additional settings entry. First-run connection setup still
opens automatically; notices and empty module states point to navigation settings.
Refresh and retry only request data, with refresh disabled before a source is set.
Pause uses a labeled Lucide icon button; refresh has icon and text.
Primary emphasis is reserved for saving connection settings. Read-only monitoring
has no destructive controls.

### Navigation and data display

Navigation switches views: the overview keeps compact summaries while each
category's detail view adds deeper telemetry from the same snapshot; detail
views mount lazily on first navigation so charts size against a visible
container. Disabled modules hide their route and fall back to the overview.
Time ranges are pressed-state button
groups. The container state filter, sortable detail headers, and page controls
preserve semantic HTML.
Charts provide textual current values; history represents actual in-page samples.

### Forms and overlays

The canonical modal is native `<dialog>` using `showModal()` for focus trapping,
Escape, and inert background; the application restores trigger focus. Inputs have
real labels and inline errors; forms use `novalidate`. Native `<select>` popup
geometry and interaction are deliberately platform-owned. Settings are reversible
browser-local preferences. Saving a display preference or a module choice repaints
the readings on screen in place; only a changed data source discards samples, so a
paused dashboard never waits on a poll that will not start. API credentials are
never accepted in browser fields.
Persistent failures use one page notice rather than repeated toasts.

### Iconography

The favicon and sidebar brand share a custom two-bay NAS SVG: white enclosure and solid
blue drive bays (`colors.network`, #2a82c2). Broad gaps retain recognition at
16px; the SVG is self-contained and has no fonts or external assets.

Icon path data is extracted from Lucide v0.468 (ISC) into `site/js/ui/icons.js`
and hydrated with a 1.7px stroke. The same icon identifies each widget in
navigation, settings, and headings. Decorative icons are hidden from assistive
technology. Hydration converts new placeholders once and preserves existing SVGs
and their classes during metric refreshes.

### Motion

140ms color changes; no animated chart interpolation or auto-scrolling. Reduced
motion disables spinner animation and transitions. Hidden tabs stop network polls.

### Content and data visualization

Plain Chinese operational copy. Bytes default to auto-scaled binary units
(`MiB/s`, `GiB`, `TiB`); the saved unit preference (`unit`, `unitBase`) can pin
one unit and switch to decimal steps, and every reading — including chart axes,
tooltips, and footnotes — follows it. CPU and memory use percent; load is
dimensionless. API success is distinct from hardware health, and capacity alone
never implies RAID health. Demo data is opt-in and persistently labeled.

## Do's and Don'ts

- Do use explicit missing, stale, disconnected, and partial states.
- Do reuse the widget registry and central CSS roles when extending the app.
- Don't represent Glances sample age as a throughput divisor.
- Don't imply historical storage, physical disk health, or model identity that the
  upstream API has not supplied.
