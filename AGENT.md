# NAS Dashboard Project Plan

## Goal

Build a focused, Chinese-language NAS monitoring dashboard driven by Glances 4.
Deploy `site/` directly through Synology Web Station without a build step. Users enter their API address
on first visit; no private NAS address or credentials ship as defaults.

## Architecture

- `site/` is the buildless web root: native ES modules typed via JSDoc and
  checked with `tsc --noEmit`, vendored Chart.js UMD, and inline lucide icon
  data. Deploy by copying `site/`; there is no compile step.
- `site/js/core/` owns configuration, transport, normalization, polling, and formatting.
- `site/js/widgets/` registers modules with explicit Glances plugin dependencies.
- `site/js/views/` expands enabled modules into hash-routed detail views with
  deeper telemetry; views reuse the same polling data and mount lazily on first
  navigation, adding no extra plugin requests.
- `site/js/ui/` owns safe DOM rendering and Chart.js integration; icons come from
  `site/js/ui/icons.js`.
- Browser preferences are versioned in localStorage. Credentials stay server-side.
- Direct mode connects to a user-entered Glances API. Optional `site/api/index.php`
  provides a Web Station PHP/cURL proxy with a fixed upstream and read-only allowlist.
- `config/glances.php` is private and excluded from Git and the public web root.
- Demo data is explicitly enabled through settings or `?demo=1`; failures never
  substitute simulated values for live telemetry.

## Data Rules

- Missing metrics display `--`, not zero. A failed poll keeps the last snapshot and
  visibly marks connectivity and freshness.
- Network uses Glances 4 `*_rate_per_sec` fields; `time_since_update` is sample age.
- Synology volumes match `^/volume[0-9]+$` by default. Filters are configurable.
- Bond interfaces are preferred over member interfaces to avoid double counting.
- Sensors include `temperature_core`; container images may be strings or arrays.
  Container health states (`healthy`, `unhealthy`, `starting`) also count as running.
- History is bounded and exists only while this page is open. Demo history is fake
  and explicitly labeled. Hidden tabs suspend polling; requests never overlap.
- Icon hydration initializes only new placeholders; existing SVGs survive refreshes.
- The Chart.js UMD bundle registers its own controllers and plugins.
- Local preview checks both decoded paths and symlink targets against `site/`.
- PHP requests to localhost or literal private/reserved IP addresses bypass inherited
  network proxies for that upstream host. Public IPs and other hostnames retain
  environment proxy settings; TLS verification and the fixed-upstream boundary remain enforced.

## Extension Plan

Add a widget implementing `WidgetDefinition`, register it in
`site/js/widgets/index.js`, and extend `WidgetId` / default configuration. Add new Glances plugin types and
proxy fields only when necessary. Keep normalized data independent from rendering.
Future persistent history should use a real time-series service rather than
pretending the browser supplies historical NAS uptime or samples.

## Verification

Run `npm run typecheck`, `npm test`, `npm run format:check`, and
`npm run test:e2e`. Browser coverage includes first connection, demo, API failures,
partial responses, settings, keyboard, empty data, and mobile layout. PHP syntax is
parsed by tests; verify the PHP/cURL runtime in Web Station before production use.
Regression coverage includes stable icon nodes, class deduplication, sibling-path
traversal, and symlinks outside the web root.
Do not claim a NAS deployment unless files and the target portal are verified.

## Maintenance

Keep code comments updated after edits, especially around rate units, concurrency,
proxy boundaries, and lifecycle behavior. Keep DESIGN.md aligned with CSS tokens.
Do not commit credentials, deploy automatically, or modify DSM nginx configuration.
Deployment ZIPs are generated from `site/`, the configuration example, README,
and LICENSE only. Create a fresh archive so obsolete build entries cannot remain.
Keep upstream Chart.js and Lucide notices in `site/vendor/LICENSES.txt` so they
remain available when `site/` is deployed independently of the repository.
