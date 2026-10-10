// @ts-check

import { el } from "./dom.js";

/** Navigation owns URLs; these are sibling pages rather than nested tab widgets. @param {string} active */
export function mihomoNavigation(active) {
  return el(
    "nav",
    { class: "mihomo-subnav", "aria-label": "mihomo 页面" },
    ...[
      ["mihomo", "概览"],
      ["mihomo-connections", "连接"],
      ["mihomo-usage", "用量"],
    ].map(([id, title]) =>
      el(
        "a",
        {
          href: `#${id}`,
          ...(id === active ? { class: "active", "aria-current": "page" } : {}),
        },
        title,
      ),
    ),
  );
}

/** @param {number|null} timestamp */
export function mihomoDate(timestamp) {
  return timestamp === null
    ? "--"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      }).format(timestamp);
}

/** @param {import("../core/types.js").MihomoConnection} connection */
export function connectionTarget(connection) {
  return (
    address(
      connection.host || connection.destinationIP,
      connection.destinationPort,
    ) || "未提供目标"
  );
}

/** @param {import("../core/types.js").MihomoConnection} connection */
export function connectionSource(connection) {
  return address(connection.sourceIP, connection.sourcePort) || "未提供来源";
}

/** Brackets keep IPv6 addresses unambiguous when a port is present. @param {string} host @param {string} port */
function address(host, port) {
  if (!host) return "";
  const address =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return port ? `${address}:${port}` : address;
}
