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

function metricNumber(mixed $value): int|float|null
{
    return (is_int($value) || is_float($value)) && is_finite((float) $value) && $value >= 0 ? $value : null;
}

function connectionText(mixed $value): string
{
    return is_string($value) || is_int($value) ? substr((string) $value, 0, 512) : '';
}

// Connection inspection is explicitly read-only. Forward only fields the three
// dashboard pages display, never arbitrary metadata, inbound users or credentials.
function connectionDetails(mixed $row): ?array
{
    if (!is_object($row) || !is_string($row->id ?? null) || $row->id === '') {
        return null;
    }
    $metadata = is_object($row->metadata ?? null) ? $row->metadata : new stdClass();
    $result = [
        'id' => substr($row->id, 0, 128),
        'upload' => metricNumber($row->upload ?? null),
        'download' => metricNumber($row->download ?? null),
        'start' => connectionText($row->start ?? null),
        'rule' => connectionText($row->rule ?? null),
        'rulePayload' => connectionText($row->rulePayload ?? null),
        'chains' => array_values(array_map('connectionText', array_slice(
            is_array($row->chains ?? null) ? $row->chains : [], 0, 16
        ))),
    ];
    foreach (['network', 'type', 'sourceIP', 'sourcePort', 'destinationIP', 'destinationPort',
        'host', 'process', 'processPath', 'inboundName'] as $field) {
        $result[$field] = connectionText($metadata->$field ?? null);
    }
    return $result;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'Only GET requests are supported.']);
}
if (!extension_loaded('curl')) {
    respond(503, ['error' => 'Enable the PHP curl extension in Web Station.']);
}

// Controller address and Secret are administrator-owned and never come from a query.
$configPath = getenv('MIHOMO_CONFIG') ?: dirname(__DIR__, 2) . '/config/mihomo.php';
$config = is_file($configPath) ? require $configPath : [];
if (!is_array($config)) {
    respond(503, ['error' => 'Invalid mihomo server configuration.']);
}
$apiUrl = getenv('MIHOMO_API_URL') ?: ($config['api_url'] ?? '');
$secretEnv = getenv('MIHOMO_SECRET');
$secret = $secretEnv !== false ? $secretEnv : ($config['secret'] ?? '');
$url = is_string($apiUrl) ? parse_url($apiUrl) : false;
if (!$url || !isset($url['host'], $url['scheme']) || !in_array($url['scheme'], ['http', 'https'], true)
    || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment'])
    || !is_string($secret) || strpbrk($secret, "\r\n") !== false) {
    respond(503, ['error' => 'Configure the mihomo API URL and Secret on the server.']);
}

// Match the Glances proxy policy for localhost and literal private/reserved IPs.
$upstreamHost = trim($url['host'], '[]');
$bypassEnvironmentProxy = strcasecmp($upstreamHost, 'localhost') === 0
    || (filter_var($upstreamHost, FILTER_VALIDATE_IP) !== false
        && filter_var($upstreamHost, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false);

// This fixed read-only allowlist deliberately excludes all control operations.
$endpoints = ['connections', 'memory', 'version'];
$multi = curl_multi_init();
$handles = [];
$bodies = [];
$receivedBytes = [];
$tooLarge = [];
$maximumBytes = 2 * 1024 * 1024;
$memoryBuffer = '';
$memoryFrames = 0;
$memoryComplete = false;
$memoryMalformed = false;
foreach ($endpoints as $endpoint) {
    $handle = curl_init(rtrim($apiUrl, '/') . '/' . $endpoint);
    $bodies[$endpoint] = '';
    $receivedBytes[$endpoint] = 0;
    $headers = ['Accept: application/json'];
    if ($secret !== '') {
        $headers[] = 'Authorization: Bearer ' . $secret;
    }
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT => 7,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => function ($curl, string $chunk) use (
            $endpoint, &$bodies, &$receivedBytes, &$tooLarge, $maximumBytes,
            &$memoryBuffer, &$memoryFrames, &$memoryComplete, &$memoryMalformed
        ): int {
            $receivedBytes[$endpoint] += strlen($chunk);
            if ($receivedBytes[$endpoint] > $maximumBytes) {
                $tooLarge[$endpoint] = true;
                return 0;
            }
            if ($endpoint !== 'memory') {
                $bodies[$endpoint] .= $chunk;
                return strlen($chunk);
            }
            // /memory is NDJSON, not a finite JSON document. The first frame is
            // a synthetic zero in mihomo; stop immediately after the second.
            $memoryBuffer .= $chunk;
            while (($newline = strpos($memoryBuffer, "\n")) !== false) {
                $line = trim(substr($memoryBuffer, 0, $newline));
                $memoryBuffer = substr($memoryBuffer, $newline + 1);
                if ($line === '') {
                    continue;
                }
                $frame = json_decode($line);
                if (json_last_error() !== JSON_ERROR_NONE || !is_object($frame)) {
                    $memoryMalformed = true;
                    return 0;
                }
                $memoryFrames++;
                if ($memoryFrames === 2) {
                    $bodies[$endpoint] = $line;
                    $memoryComplete = true;
                    // CURLE_WRITE_ERROR is expected only for this completed sample.
                    return 0;
                }
            }
            return strlen($chunk);
        },
    ]);
    if ($bypassEnvironmentProxy) {
        curl_setopt($handle, CURLOPT_NOPROXY, $upstreamHost);
    }
    $handles[$endpoint] = $handle;
    curl_multi_add_handle($multi, $handle);
}
do {
    $multiStatus = curl_multi_exec($multi, $active);
    if ($active && $multiStatus === CURLM_OK && curl_multi_select($multi, 0.2) === -1) {
        usleep(10000);
    }
} while ($active && $multiStatus === CURLM_OK);

// curl_multi_info_read carries the transfer's actual result; curl_errno alone
// can remain zero for a multi-handle timeout after response headers arrived.
$transferResults = [];
while (($completed = curl_multi_info_read($multi)) !== false) {
    $transferResults[spl_object_id($completed['handle'])] = $completed['result'];
}

$data = [];
$errors = [];
foreach ($handles as $endpoint => $handle) {
    $status = curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $errno = $transferResults[spl_object_id($handle)] ?? curl_errno($handle);
    $sampleStopped = $endpoint === 'memory' && $memoryComplete && $errno === CURLE_WRITE_ERROR;
    if ($status === 401 || $status === 403) {
        $errors[$endpoint] = 'mihomo 认证失败，请检查服务端 Secret';
    } elseif (isset($tooLarge[$endpoint])) {
        $errors[$endpoint] = 'mihomo 响应超过大小限制';
    } elseif ($endpoint === 'memory' && $memoryMalformed) {
        $errors[$endpoint] = 'mihomo 未返回有效内存 JSON';
    } elseif ($multiStatus !== CURLM_OK || ($errno !== 0 && !$sampleStopped)) {
        $errors[$endpoint] = 'mihomo 无法连接或响应超时';
    } elseif ($status !== 200) {
        $errors[$endpoint] = 'mihomo 返回 HTTP ' . $status;
    } elseif ($endpoint === 'memory' && !$memoryComplete) {
        $errors[$endpoint] = 'mihomo 未提供完整内存采样';
    } else {
        $decoded = json_decode($bodies[$endpoint]);
        if (json_last_error() !== JSON_ERROR_NONE || !is_object($decoded)) {
            $errors[$endpoint] = 'mihomo 未返回有效 JSON 对象';
        } elseif ($endpoint === 'connections') {
            // Go encodes a nil connection slice as null: it means zero active
            // connections, whereas a missing field is an unknown reading.
            $hasConnections = property_exists($decoded, 'connections');
            $connections = $decoded->connections ?? null;
            if ($hasConnections && $connections !== null && !is_array($connections)) {
                $errors[$endpoint] = 'mihomo 返回连接格式不正确';
            } else {
                $items = [];
                foreach (array_slice($connections ?? [], 0, 500) as $row) {
                    $detail = connectionDetails($row);
                    if ($detail !== null) { $items[] = $detail; }
                }
                $data[$endpoint] = [
                    'count' => $hasConnections ? ($connections === null ? 0 : count($connections)) : null,
                    'uploadTotal' => metricNumber($decoded->uploadTotal ?? null),
                    'downloadTotal' => metricNumber($decoded->downloadTotal ?? null),
                    'items' => $hasConnections ? $items : null,
                    'truncated' => is_array($connections) && count($items) < count($connections),
                ];
            }
        } elseif ($endpoint === 'memory') {
            $data[$endpoint] = ['inuse' => metricNumber($decoded->inuse ?? null)];
        } else {
            $data[$endpoint] = [
                'version' => is_string($decoded->version ?? null) ? $decoded->version : '',
                'meta' => is_bool($decoded->meta ?? null) ? $decoded->meta : null,
            ];
        }
    }
    curl_multi_remove_handle($multi, $handle);
    curl_close($handle);
}
curl_multi_close($multi);

// Summary plus bounded allowlisted details; controller credentials stay private.
respond(200, ['data' => (object) $data, 'errors' => (object) $errors, 'collectedAt' => (int) round(microtime(true) * 1000)]);
