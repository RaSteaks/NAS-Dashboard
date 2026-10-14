// @ts-check

/** @typedef {import("./types.js").Config} Config */
/** @typedef {import("./types.js").Metrics} Metrics */
/** @typedef {import("./types.js").Snapshot} Snapshot */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function rows(value) {
  return Array.isArray(value) ? value.map(record) : [];
}

/**
 * @param {(number|null)[]} values
 * @returns {number|null}
 */
function total(values) {
  return values.length && values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
}

/**
 * @param {Record<string, unknown>} disk
 * @returns {number|null}
 */
function diskTemperature(disk) {
  // ATA 194/190 store Celsius in raw, e.g. "34 (Min/Max 14/61)".
  // Glances' NVMe temperature has a named key instead of a fixed attribute ID.
  const attributes = [
    record(disk["194"]),
    record(disk["190"]),
    ...Object.values(disk)
      .map(record)
      .filter(
        (attribute) =>
          attribute.key === "_temperature" ||
          attribute.name === "Temperature (°C)",
      ),
  ];
  for (const attribute of attributes) {
    const raw = attribute.raw;
    if (number(raw) !== null) return number(raw);
    const match =
      typeof raw === "string"
        ? raw.match(/^\s*(-?\d+(?:\.\d+)?)(?=\s|$)/)
        : null;
    const value = match ? number(Number(match[1])) : null;
    if (value !== null) return value;
  }
  // SMART value/worst/threshold are normalized scores, not temperatures.
  return null;
}

/**
 * @param {Snapshot} snapshot
 * @param {Config} config
 * @returns {Metrics}
 */
export function normalize(snapshot, config) {
  const cpu = record(snapshot.data.cpu);
  const mem = record(snapshot.data.mem);
  const load = record(snapshot.data.load);
  const system = record(snapshot.data.system);
  // Glances distinguishes temperature_core, temperature_hdd, and other sensors.
  const sensors = rows(snapshot.data.sensors).filter(
    (sensor) =>
      text(sensor.type).startsWith("temperature") &&
      number(sensor.value) !== null,
  );
  const cpuSensors = sensors.filter((sensor) =>
    /cpu|package|core|k10temp/i.test(`${sensor.label} ${sensor.unit}`),
  );
  const temperature = (cpuSensors.length ? cpuSensors : sensors).sort(
    (a, b) => Number(b.value) - Number(a.value),
  )[0];
  // Detail views list every temperature reading; the overview keeps only the peak.
  const temperatureSensors = sensors
    .map((sensor) => ({
      label: text(sensor.label) || "未命名传感器",
      value: /** @type {number} */ (number(sensor.value)),
    }))
    .sort((a, b) => b.value - a.value);
  const volumes = rows(snapshot.data.fs)
    .filter((volume) =>
      new RegExp(config.volumePattern).test(text(volume.mnt_point)),
    )
    .filter(
      (volume, index, array) =>
        array.findIndex((item) => item.mnt_point === volume.mnt_point) ===
        index,
    )
    .map((volume) => ({
      mount: text(volume.mnt_point),
      device: text(volume.device_name),
      type: text(volume.fs_type),
      used: number(volume.used),
      size: number(volume.size),
      free: number(volume.free),
      percent: number(volume.percent),
    }));
  let interfaces = rows(snapshot.data.network).filter((item) =>
    config.networkInterfaces.length
      ? config.networkInterfaces.includes(text(item.interface_name))
      : !new RegExp(config.networkIgnorePattern).test(
          text(item.interface_name),
        ),
  );
  // A bond and its member interfaces carry the same traffic; prefer the bond.
  if (
    !config.networkInterfaces.length &&
    interfaces.some((item) => /^(ovs_)?bond\d/.test(text(item.interface_name)))
  )
    interfaces = interfaces.filter((item) =>
      /^(ovs_)?bond\d/.test(text(item.interface_name)),
    );
  const network = interfaces.map((item) => ({
    name: text(item.interface_name),
    // Glances 4 delta bytes and time_since_update are not a bytes/second rate.
    rx: number(item.bytes_recv_rate_per_sec),
    tx: number(item.bytes_sent_rate_per_sec),
    speed: number(item.speed),
    isUp: typeof item.is_up === "boolean" ? item.is_up : null,
    // Cumulative counters come straight from the API, never from arithmetic.
    rxTotal: number(item.bytes_recv),
    txTotal: number(item.bytes_sent),
  }));
  return {
    timestamp: snapshot.collectedAt,
    hostname: text(system.hostname),
    os: text(system.hr_name) || text(system.os_name),
    uptime: text(snapshot.data.uptime),
    cpu: number(cpu.total),
    cpuUser: number(cpu.user),
    cpuSystem: number(cpu.system),
    cpuWait: number(cpu.iowait),
    cores: number(cpu.cpucore) ?? number(load.cpucore),
    memory: number(mem.percent),
    memoryUsed: number(mem.used),
    memoryTotal: number(mem.total),
    memoryFree: number(mem.free),
    load: [number(load.min1), number(load.min5), number(load.min15)],
    temperature: temperature ? number(temperature.value) : null,
    temperatureLabel: temperature ? text(temperature.label) : "",
    sensors: temperatureSensors,
    volumes,
    disks: rows(snapshot.data.smart)
      .filter((disk) => text(disk.DeviceName).trim())
      .map((disk) => ({
        name: text(disk.DeviceName),
        temperature: diskTemperature(disk),
      })),
    interfaces: network,
    rx: total(network.map((item) => item.rx)),
    tx: total(network.map((item) => item.tx)),
    containers: rows(snapshot.data.containers).map((item, index) => ({
      id: text(item.id) || String(index),
      name: text(item.name) || "未命名容器",
      image: Array.isArray(item.image)
        ? item.image.map(text).filter(Boolean).join(", ")
        : text(item.image),
      status: text(item.status) || "unknown",
      cpu: number(item.cpu_percent),
      memory: number(item.memory_usage),
    })),
  };
}
