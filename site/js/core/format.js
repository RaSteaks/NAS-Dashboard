// @ts-check

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
  // Capacity and throughput consistently use binary units rather than decimal GB.
  if (value === null) return "--";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const exponent =
    value > 0
      ? Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
      : 0;
  return `${decimal(value / 1024 ** exponent, exponent > 0 ? 1 : 0)} ${units[exponent]}${rate ? "/s" : ""}`;
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
