// @ts-check

/** @typedef {import("./types.js").HistoryPoint} HistoryPoint */
/** @typedef {import("./types.js").Snapshot} Snapshot */

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

// Demo fixtures are opt-in; connection failures never switch to simulated data.

/**
 * @param {number} [timestamp=Date.now()]
 * @returns {Snapshot}
 */
export function demoSnapshot(timestamp = Date.now()) {
  const wave = timestamp / 1000;
  const cpu = 17 + Math.sin(wave / 17) * 6 + Math.sin(wave / 5) * 2;
  return {
    collectedAt: timestamp,
    errors: {},
    data: {
      system: { hostname: "DiskStation", hr_name: "Synology DSM · Linux 4.4" },
      uptime: "28 days, 07:42:18",
      cpu: {
        total: cpu,
        user: cpu * 0.7,
        system: cpu * 0.25,
        iowait: 0.8,
        cpucore: 4,
      },
      mem: {
        percent: 42.8 + Math.sin(wave / 40),
        used: 6.85 * GIB,
        total: 16 * GIB,
        free: 9.15 * GIB,
      },
      load: { min1: 0.62, min5: 0.48, min15: 0.39, cpucore: 4 },
      sensors: [
        {
          label: "CPU Package",
          type: "temperature_core",
          value: 43 + Math.round(Math.sin(wave / 30)),
        },
        {
          label: "M.2 SSD",
          type: "temperature_core",
          value: 39 + Math.round(Math.sin(wave / 45)),
        },
        {
          label: "Disk 0",
          type: "temperature_hdd",
          value: 36,
        },
      ],
      fs: [
        {
          mnt_point: "/volume1",
          device_name: "/dev/mapper/cachedev_0",
          fs_type: "btrfs",
          size: 10.9 * TIB,
          used: 6.76 * TIB,
          free: 4.14 * TIB,
          percent: 62,
        },
        {
          mnt_point: "/volume2",
          device_name: "/dev/mapper/cachedev_1",
          fs_type: "btrfs",
          size: 3.6 * TIB,
          used: 0.85 * TIB,
          free: 2.75 * TIB,
          percent: 23.6,
        },
      ],
      network: [
        {
          interface_name: "eth0",
          bytes_recv_rate_per_sec:
            (2.4 + Math.sin(wave / 13) * 1.8) * 1024 ** 2,
          bytes_sent_rate_per_sec: (0.7 + Math.sin(wave / 9) * 0.4) * 1024 ** 2,
          bytes_recv: 812.6 * GIB,
          bytes_sent: 154.2 * GIB,
          speed: 1000000000,
          is_up: true,
        },
        {
          interface_name: "eth1",
          bytes_recv_rate_per_sec:
            (0.3 + Math.sin(wave / 21) * 0.2) * 1024 ** 2,
          bytes_sent_rate_per_sec:
            (0.1 + Math.sin(wave / 17) * 0.05) * 1024 ** 2,
          bytes_recv: 96.4 * GIB,
          bytes_sent: 48.9 * GIB,
          speed: 1000000000,
          is_up: true,
        },
      ],
      containers: [
        {
          id: "1",
          name: "glances",
          image: "nicolargo/glances",
          status: "running",
          cpu_percent: 1.2,
          memory_usage: 96 * 1024 ** 2,
        },
        {
          id: "2",
          name: "jellyfin",
          image: "jellyfin/jellyfin",
          status: "running",
          cpu_percent: 3.4,
          memory_usage: 412 * 1024 ** 2,
        },
        {
          id: "3",
          name: "immich-server",
          image: "ghcr.io/immich-app/immich-server",
          status: "running",
          cpu_percent: 0.6,
          memory_usage: 284 * 1024 ** 2,
        },
        {
          id: "4",
          name: "ddns-go",
          image: "jeessy/ddns-go",
          status: "running",
          cpu_percent: 0.1,
          memory_usage: 18 * 1024 ** 2,
        },
        {
          id: "5",
          name: "qbittorrent",
          image: "linuxserver/qbittorrent",
          status: "running",
          cpu_percent: 2.1,
          memory_usage: 156 * 1024 ** 2,
        },
        {
          id: "6",
          name: "backup-worker",
          image: "restic/restic",
          status: "exited",
          cpu_percent: 0,
          memory_usage: 0,
        },
      ],
    },
  };
}

/**
 * @returns {HistoryPoint[]}
 */
export function demoHistory() {
  const now = Date.now();
  return Array.from({ length: 181 }, (_, index) => {
    const timestamp = now - (180 - index) * 5000;
    const snapshot = demoSnapshot(timestamp);
    const cpu = /** @type {{total: number}} */ (snapshot.data.cpu);
    const mem = /** @type {{percent: number}} */ (snapshot.data.mem);
    const network =
      /** @type {{bytes_recv_rate_per_sec: number, bytes_sent_rate_per_sec: number}[]} */ (
        snapshot.data.network
      );
    // The aggregate matches live sampling, which sums every interface.
    const rx = network.reduce(
      (sum, item) => sum + item.bytes_recv_rate_per_sec,
      0,
    );
    const tx = network.reduce(
      (sum, item) => sum + item.bytes_sent_rate_per_sec,
      0,
    );
    return {
      timestamp,
      cpu: cpu.total,
      memory: mem.percent,
      rx,
      tx,
    };
  });
}
