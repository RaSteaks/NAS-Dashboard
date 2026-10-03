// @ts-check

/** @typedef {import("./types.js").ByteUnit} ByteUnit */

const UNIT_KEYS = ["B", "KB", "MB", "GB", "TB"];
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

// Display preference for every byte quantity; applied before the first render.
/** @type {{unit: ByteUnit, base: 1000|1024}} */
let bytePreference = { unit: "auto", base: 1024 };

/**
 * @param {ByteUnit} unit "auto" scales each value; a fixed unit pins every reading.
 * @param {1000|1024} base Decimal (KB/MB/GB) or binary (KiB/MiB/GiB) steps.
 */
export function setByteUnits(unit, base) {
  bytePreference = { unit, base };
}

/**
 * The unit network charts plot in: the fixed preference, or the second step
 * (MiB/MB) when values scale automatically.
 *
 * @returns {{divisor: number, unit: string}}
 */
export function chartByteScale() {
  const { unit, base } = bytePreference;
  const exponent = unit === "auto" ? 2 : Math.max(0, UNIT_KEYS.indexOf(unit));
  return { divisor: base ** exponent, unit: unitLabels(base)[exponent] };
}

/**
 * @param {1000|1024} base
 * @returns {string[]}
 */
function unitLabels(base) {
  return base === 1000 ? DECIMAL_UNITS : BINARY_UNITS;
}

/**
 * @param {number|null} value
 * @param {number} [digits=1]
 * @returns {string}
 */
export function decimal(value, digits = 1) {
  return value === null
    ? "--"
    : value.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
}

/**
 * @param {number|null} value
 * @param {boolean} [rate=false]
 * @returns {string}
 */
export function bytes(value, rate = false) {
  if (value === null) return "--";
  const { unit, base } = bytePreference;
  const units = unitLabels(base);
  const exponent =
    unit === "auto"
      ? value > 0
        ? Math.min(
            units.length - 1,
            Math.floor(Math.log(value) / Math.log(base)),
          )
        : 0
      : Math.max(0, UNIT_KEYS.indexOf(unit));
  return `${decimal(value / base ** exponent, exponent > 0 ? 1 : 0)} ${units[exponent]}${rate ? "/s" : ""}`;
}

/**
 * @param {number|null} bitsPerSecond
 * @returns {string}
 */
export function bitrate(bitsPerSecond) {
  // Glances reports link speed in bits per second; scale to a readable unit.
  if (bitsPerSecond === null) return "--";
  if (bitsPerSecond >= 1e9) return `${decimal(bitsPerSecond / 1e9)} Gbit/s`;
  if (bitsPerSecond >= 1e6) return `${decimal(bitsPerSecond / 1e6)} Mbit/s`;
  if (bitsPerSecond >= 1e3) return `${decimal(bitsPerSecond / 1e3)} Kbit/s`;
  return `${decimal(bitsPerSecond, 0)} bit/s`;
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function time(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(timestamp);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function uptime(value) {
  if (!value) return "--";
  const match = value.match(/^(?:(\d+)\s+days?,?\s*)?(\d+):(\d+)(?::(\d+))?$/);
  if (!match) return value;
  const hours = Number(match[2]);
  const days = Number(match[1] ?? 0) + Math.floor(hours / 24);
  return `${days ? `${days} 天 ` : ""}${hours % 24} 小时 ${Number(match[3])} 分钟`;
}
