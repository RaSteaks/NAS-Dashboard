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

/** @typedef {"resources"|"storage"|"network"|"containers"|"mihomo"} WidgetId */

/**
 * Only the public same-origin proxy address is browser-configurable; the
 * controller URL and Secret belong to the private server configuration.
 * @typedef {{url: string}} MihomoConfig
 * @typedef {"connections"|"memory"|"version"} MihomoEndpoint
 * @typedef {"idle"|"loading"|"online"|"partial"|"offline"} ConnectionState
 */

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
 * @property {MihomoConfig} mihomo
 * @property {number} refreshSeconds Glances interval; mihomo owns its one-second target cadence.
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
 * Mihomo uses a separate snapshot so its endpoints never enter the Glances
 * plugin allowlist. Endpoint failures are independent of one another.
 * @typedef {object} MihomoSnapshot
 * @property {Partial<Record<MihomoEndpoint, unknown>>} data
 * @property {Partial<Record<MihomoEndpoint, string>>} errors
 * @property {number} collectedAt
 */

/**
 * Rates are bytes per second averaged between successful connection samples.
 * Unknown readings remain null; version is metadata, not proof of live metrics.
 * @typedef {object} MihomoMetrics
 * @property {number|null} up
 * @property {number|null} down
 * @property {number|null} uploadTotal
 * @property {number|null} downloadTotal
 * @property {number|null} connections
 * @property {number|null} memory
 * @property {string} version
 */

/**
 * Independent source state shared by the overview and lazy detail view.
 * @typedef {object} MihomoState
 * @property {MihomoMetrics} metrics
 * @property {HistoryPoint[]} history
 * @property {ConnectionState} connection
 * @property {MihomoSnapshot["errors"]} errors
 * @property {string} error
 * @property {number} lastSuccess
 * @property {MihomoConnection[]} activeConnections Filtered, bounded details from the controller.
 * @property {MihomoConnection[]} closedConnections Observed departures, not an upstream history API.
 * @property {boolean} detailsAvailable False for older summary-only proxies.
 * @property {boolean} detailsTruncated True when the proxy omitted some active details.
 * @property {MihomoUsageRecord[]} usageRecords Observed deltas only, kept in page memory.
 * @property {HistoryPoint[]} usageHistory Byte deltas per adaptive time bucket, distinct from rates.
 * @property {number} usageStartedAt
 * @property {boolean} usageHasSamples
 * @property {number} usageBucketMs Adaptive chart buckets preserve all page-session totals.
 */

/**
 * Only explicitly allowed connection fields reach the browser. Missing values
 * remain unknown, and rates require two observations of the same connection.
 * @typedef {object} MihomoConnection
 * @property {string} id
 * @property {string} host
 * @property {string} destinationIP
 * @property {string} destinationPort
 * @property {string} sourceIP
 * @property {string} sourcePort
 * @property {string} network
 * @property {string} type
 * @property {string} process
 * @property {string} processPath
 * @property {string} inboundName
 * @property {string} rule
 * @property {string} rulePayload
 * @property {string[]} chains
 * @property {number|null} start
 * @property {number|null} upload
 * @property {number|null} download
 * @property {number|null} up
 * @property {number|null} down
 * @property {number|null} closedAt
 */

/** @typedef {"sourceIP"|"host"|"outbound"|"process"|"rule"} MihomoUsageDimension */

/**
 * Measured deltas grouped by metadata and time bucket, kept for the entire page
 * session. Coarsening time buckets never discards recorded bytes.
 * @typedef {object} MihomoUsageRecord
 * @property {number} timestamp
 * @property {string} sourceIP
 * @property {string} host
 * @property {string} outbound
 * @property {string} process
 * @property {string} rule
 * @property {number} upload
 * @property {number} download
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
 * @property {number|null} [connections] Active-count trend; mihomo memory history uses bytes.
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
 * @property {MihomoState} mihomo
 * @property {boolean} paused
 * @property {boolean} demo
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
 * @property {string} id Hash route segment; moduleId identifies a subroute's owner.
 * @property {string} eyebrow Label above the shared page title.
 * @property {string} title Page title in the shared heading and breadcrumb.
 * @property {string} description Sentence below the page title.
 * @property {WidgetId} [moduleId] Owning module for subroutes such as mihomo connections/usage.
 * @property {(element: HTMLElement) => {
 *   update: (context: WidgetContext) => void,
 *   destroy: () => void,
 * }} mount
 */

// Exporting marks this types-only file as an ES module for JSDoc imports.
export {};
