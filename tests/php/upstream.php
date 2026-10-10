<?php
// Disposable test upstream: all credentials and connection metadata are fixtures.
ignore_user_abort(true);
header('Content-Type: application/json');
clearstatcache(true, '/fixtures/mode');
$mode = trim((string) file_get_contents('/fixtures/mode'));
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$endpoint = basename($path);
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
file_put_contents('/fixtures/requests', json_encode(['path' => $path, 'authorization' => $authorization], JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
if ($authorization !== 'Bearer fixture-secret' || $mode === 'unauthorized') {
    http_response_code(401);
    echo '{"error":"unauthorized"}';
    return;
}
if ($endpoint === 'connections') {
    if ($mode === 'oversized') {
        echo str_repeat('x', 2 * 1024 * 1024 + 1);
    } elseif ($mode === 'redirect') {
        header('Location: http://127.0.0.1:9090/forbidden', true, 302);
    } elseif ($mode === 'empty') {
        echo '{"connections":null,"uploadTotal":0,"downloadTotal":0}';
    } elseif ($mode === 'missing') {
        echo '{}';
    } elseif ($mode === 'many') {
        $rows = [];
        for ($index = 0; $index < 601; $index++) {
            $rows[] = ['id' => 'connection-' . $index, 'upload' => 100, 'download' => 200,
                'metadata' => ['host' => 'allowed.example', 'sourceIP' => '192.0.2.10', 'network' => 'tcp', 'credential' => 'discard-me']];
        }
        echo json_encode(['connections' => $rows, 'uploadTotal' => 1024, 'downloadTotal' => 2048]);
    } else {
        // Allowed inspection fields coexist with credential-like metadata that
        // the proxy must still remove from every returned connection.
        echo '{"connections":[{"id":"c1","upload":100,"download":200,"metadata":{"host":"allowed.example","sourceIP":"192.0.2.10","network":"tcp","private":"private-domain.invalid","credential":"fixture-secret"}}],"uploadTotal":1024,"downloadTotal":2048,"secret":"fixture-secret"}';
    }
} elseif ($endpoint === 'version') {
    if ($mode === 'partial') {
        http_response_code(404);
        echo '{"error":"unavailable"}';
    } else {
        echo '{"version":"v1.fixture","meta":true,"private":"discard-me"}';
    }
} elseif ($endpoint === 'memory') {
    // Frames are split across writes to exercise incremental line parsing.
    echo '{"inuse":0,"oslimit":0}' . "\n";
    if (ob_get_level() > 0) { ob_flush(); }
    flush();
    if ($mode === 'incomplete') { return; }
    if ($mode === 'timeout') { sleep(9); return; }
    usleep(50000);
    echo $mode === 'malformed' ? "invalid\n" : '{"in';
    if (ob_get_level() > 0) { ob_flush(); }
    flush();
    if ($mode === 'malformed') { return; }
    usleep(50000);
    echo 'use":12345,"oslimit":0,"private":"discard-me"}' . "\n";
    if (ob_get_level() > 0) { ob_flush(); }
    flush();
    // Keep the stream open until the proxy closes it, instead of helping the
    // proxy by ending the response after its second sample.
    for ($index = 0; $index < 100; $index++) {
        usleep(100000);
        echo '{"inuse":99999}' . "\n";
        if (ob_get_level() > 0) { ob_flush(); }
        flush();
        if (connection_aborted()) { break; }
    }
} else {
    http_response_code(404);
    echo '{}';
}
