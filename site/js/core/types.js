/**
 * Type definitions (JSDoc). Types-only module, no runtime code.
 */

/**
 * Glances plugin names: the minimal allowlist a snapshot request may use.
 *
 * @typedef {"cpu"|"mem"|"load"|"sensors"|"fs"|"network"|"containers"|"system"|"uptime"} Plugin
 */

/**
 * Connection mode: "direct" talks to the user-entered Glances URL from the
 * browser, "proxy" goes through the same-origin PHP proxy.
 *
 * @typedef {object} ApiConfig
 * @property {"proxy"|"direct"} mode
 * @property {string} url
 */

/** @typedef {"resources"|"storage"|"network"|"containers"} WidgetId */

/**
 * Byte display unit: "auto" scales each value to a readable step, the others
 * pin every reading to one unit.
 *
 * @typedef {"auto"|"B"|"KB"|"MB"|"GB"|"TB"} ByteUnit
 */

/**
 * @typedef {object} Thresholds
 * @property {number} cpu
 * @property {number} memory
 * @property {number} storage
 * @property {number} temperature
 */

/**
 * Merged site configuration (config.json plus browser-saved settings).
 *
 * @typedef {object} Config
 * @property {string} name
 * @property {string} subtitle
 * @property {ApiConfig} api
 * @property {number} refreshSeconds
 * @property {number} timeoutSeconds
 * @property {number} historyMinutes
 * @property {string} volumePattern
 * @property {string[]} networkInterfaces
 * @property {string} networkIgnorePattern
 * @property {WidgetId[]} widgets
 * @property {ByteUnit} unit Byte unit every reading renders in ("auto" scales).
 * @property {1000|1024} unitBase Decimal or binary steps between units.
 * @property {Thresholds} thresholds
 */

/**
 * One snapshot: per-plugin data and errors are independent, so a partial
 * failure never blocks the whole panel.
 *
 * @typedef {object} Snapshot
 * @property {Partial<Record<Plugin, unknown>>} data
 * @property {Partial<Record<Plugin, string>>} errors
 * @property {number} collectedAt
 */

/**
 * @typedef {object} Volume
 * @property {string} mount
 * @property {string} device
 * @property {string} type
 * @property {number|null} used
 * @property {number|null} size
 * @property {number|null} free
 * @property {number|null} percent
 */

/**
 * @typedef {object} NetworkInterface
 * @property {string} name
 * @property {number|null} rx
 * @property {number|null} tx
 * @property {number|null} speed
 * @property {boolean|null} isUp
 * @property {number|null} rxTotal Cumulative received bytes reported by the API.
 * @property {number|null} txTotal Cumulative sent bytes reported by the API.
 */

/**
 * One temperature reading from the sensors plugin.
 *
 * @typedef {object} TemperatureSensor
 * @property {string} label
 * @property {number} value
 */

/**
 * @typedef {object} Container
 * @property {string} id
 * @property {string} name
 * @property {string} image
 * @property {string} status
 * @property {number|null} cpu
 * @property {number|null} memory
 */

/**
 * Normalized metrics. Missing fields are null and render as "--"; they never
 * become measured zeros.
 *
 * @typedef {object} Metrics
 * @property {number} timestamp
 * @property {string} hostname
 * @property {string} os
 * @property {string} uptime
 * @property {number|null} cpu
 * @property {number|null} cpuUser
 * @property {number|null} cpuSystem
 * @property {number|null} cpuWait
 * @property {number|null} cores
 * @property {number|null} memory
 * @property {number|null} memoryUsed
 * @property {number|null} memoryTotal
 * @property {number|null} memoryFree
 * @property {(number|null)[]} load
 * @property {number|null} temperature
 * @property {string} temperatureLabel
 * @property {TemperatureSensor[]} sensors All temperature readings, hottest first.
 * @property {Volume[]} volumes
 * @property {NetworkInterface[]} interfaces
 * @property {number|null} rx
 * @property {number|null} tx
 * @property {Container[]} containers
 */

/**
 * @typedef {object} HistoryPoint
 * @property {number} timestamp
 * @property {number|null} cpu
 * @property {number|null} memory
 * @property {number|null} rx
 * @property {number|null} tx
 */

/**
 * Per-update context handed to widgets.
 *
 * @typedef {object} WidgetContext
 * @property {Metrics} metrics
 * @property {Snapshot} snapshot
 * @property {HistoryPoint[]} history
 * @property {Config} config
 * @property {number} windowMinutes
 */

/**
 * Widget registry entry.
 *
 * Each widget declares its API dependencies so hidden modules stop requesting
 * data.
 *
 * @typedef {object} WidgetDefinition
 * @property {WidgetId} id
 * @property {string} title
 * @property {string} icon
 * @property {Plugin[]} plugins
 * @property {(element: HTMLElement) => {
 *   update: (context: WidgetContext) => void,
 *   destroy: () => void,
 * }} mount
 */

/**
 * Detail view registry entry. Views mount lazily into their own hash-routed
 * section (`view-${id}`) on first navigation and share the polling context
 * with overview widgets, so they never request extra plugins.
 *
 * @typedef {object} ViewDefinition
 * @property {string} id Hash route segment; matches the WidgetId it expands.
 * @property {string} eyebrow Label above the shared page title.
 * @property {string} title Page title in the shared heading and breadcrumb.
 * @property {string} description Sentence below the page title.
 * @property {(element: HTMLElement) => {
 *   update: (context: WidgetContext) => void,
 *   destroy: () => void,
 * }} mount
 */

// Exporting marks this types-only file as an ES module for JSDoc imports.
export {};
