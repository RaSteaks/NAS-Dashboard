<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'Only GET requests are supported.']);
}

// Only these read-only plugins and fields cross the dashboard boundary.
$fields = [
    'cpu' => ['total', 'user', 'system', 'iowait', 'cpucore'],
    'mem' => ['percent', 'used', 'total'],
    'load' => ['min1', 'min5', 'min15', 'cpucore'],
    'sensors' => ['label', 'type', 'unit', 'value'],
    'fs' => ['mnt_point', 'device_name', 'fs_type', 'used', 'size', 'free', 'percent'],
    'network' => ['interface_name', 'bytes_recv_rate_per_sec', 'bytes_sent_rate_per_sec', 'speed', 'is_up'],
    'containers' => ['id', 'name', 'image', 'status', 'cpu_percent', 'memory_usage'],
    'system' => ['hostname', 'hr_name', 'os_name'],
    'uptime' => [],
];
$listPlugins = ['sensors', 'fs', 'network', 'containers'];
$rawPlugins = $_GET['plugins'] ?? implode(',', array_keys($fields));
if (!is_string($rawPlugins)) {
    respond(400, ['error' => 'Invalid plugins parameter.']);
}
$plugins = array_values(array_unique(explode(',', $rawPlugins)));
if (!$plugins || count($plugins) > count($fields) || array_diff($plugins, array_keys($fields))) {
    respond(400, ['error' => 'Unsupported monitoring plugin.']);
}

if (!extension_loaded('curl')) {
    respond(503, ['error' => 'Enable the PHP curl extension in Web Station.']);
}

// The upstream is administrator-owned, never supplied by a browser query.
$configPath = getenv('GLANCES_CONFIG') ?: dirname(__DIR__, 2) . '/config/glances.php';
$config = is_file($configPath) ? require $configPath : [];
if (!is_array($config)) {
    respond(503, ['error' => 'Invalid server configuration.']);
}
$apiUrl = getenv('GLANCES_API_URL') ?: ($config['api_url'] ?? '');
$url = is_string($apiUrl) ? parse_url($apiUrl) : false;
if (!$url || !isset($url['host'], $url['scheme']) || !in_array($url['scheme'], ['http', 'https'], true)
    || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment'])) {
    respond(503, ['error' => 'Configure the Glances API URL on the server.']);
}

// NAS proxy environment variables can route local API requests through a proxy returning 503.
// Public addresses and other hostnames retain the administrator's environment proxy settings.
$upstreamHost = trim($url['host'], '[]');
$bypassEnvironmentProxy = strcasecmp($upstreamHost, 'localhost') === 0
    || (
        filter_var($upstreamHost, FILTER_VALIDATE_IP) !== false
        && filter_var(
            $upstreamHost,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) === false
    );

$multi = curl_multi_init();
$handles = [];
$bodies = [];
$maximumBytes = 2 * 1024 * 1024;
foreach ($plugins as $plugin) {
    $handle = curl_init(rtrim($apiUrl, '/') . '/' . $plugin);
    $bodies[$plugin] = '';
    $headers = ['Accept: application/json'];
    if (!empty($config['token'])) {
        $headers[] = 'Authorization: Bearer ' . $config['token'];
    }
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT => 7,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        // Bound upstream bodies before JSON decoding, including large container lists.
        CURLOPT_WRITEFUNCTION => function ($curl, string $chunk) use (&$bodies, $plugin, $maximumBytes): int {
            if (strlen($bodies[$plugin]) + strlen($chunk) > $maximumBytes) {
                return 0;
            }
            $bodies[$plugin] .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($bypassEnvironmentProxy) {
        // Match only the configured upstream; bracket-free IPv6 also works on older libcurl.
        curl_setopt($handle, CURLOPT_NOPROXY, $upstreamHost);
    }
    if (!empty($config['username']) && isset($config['password'])) {
        curl_setopt($handle, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
        curl_setopt($handle, CURLOPT_USERPWD, $config['username'] . ':' . $config['password']);
    }
    $handles[$plugin] = $handle;
    curl_multi_add_handle($multi, $handle);
}

do {
    $multiStatus = curl_multi_exec($multi, $active);
    if ($active && $multiStatus === CURLM_OK) {
        // Wait on socket readiness instead of spinning a PHP worker at 100% CPU.
        if (curl_multi_select($multi, 0.2) === -1) {
            usleep(10000);
        }
    }
} while ($active && $multiStatus === CURLM_OK);

$data = [];
$errors = [];
foreach ($handles as $plugin => $handle) {
    $status = curl_getinfo($handle, CURLINFO_HTTP_CODE);
    if ($multiStatus !== CURLM_OK || curl_errno($handle) !== 0) {
        $errors[$plugin] = 'Glances 无法连接或响应超时';
    } elseif ($status !== 200) {
        $errors[$plugin] = 'Glances 返回 HTTP ' . $status;
    } else {
        $decoded = json_decode($bodies[$plugin], true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            $errors[$plugin] = 'Glances 未返回有效 JSON';
        } elseif ($plugin === 'uptime') {
            if (is_string($decoded)) {
                $data[$plugin] = $decoded;
            } else {
                $errors[$plugin] = 'Glances 返回格式不正确';
            }
        } elseif (!is_array($decoded)) {
            $errors[$plugin] = 'Glances 返回格式不正确';
        } else {
            $allowedFields = array_flip($fields[$plugin]);
            if (in_array($plugin, $listPlugins, true)) {
                $data[$plugin] = array_values(array_map(
                    function ($row) use ($allowedFields): array {
                        return is_array($row) ? array_intersect_key($row, $allowedFields) : [];
                    },
                    $decoded
                ));
            } else {
                $data[$plugin] = array_intersect_key($decoded, $allowedFields);
            }
        }
    }
    curl_multi_remove_handle($multi, $handle);
    curl_close($handle);
}
curl_multi_close($multi);

// Empty maps must encode as objects to preserve the client snapshot contract.
respond(200, ['data' => (object) $data, 'errors' => (object) $errors, 'collectedAt' => (int) round(microtime(true) * 1000)]);
