<?php
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const LEADERBOARD_PATH = __DIR__ . '/leaderboard.json';
const MAX_ENTRIES = 10;

function send_json(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function normalize_name(string $name): string {
    $trimmed = trim($name);
    $clean = preg_replace('/[^a-zA-Z0-9 _-]/', '', $trimmed) ?? '';
    return mb_substr($clean, 0, 10);
}

function default_entries(): array {
    return [];
}

function load_entries(): array {
    if (!file_exists(LEADERBOARD_PATH)) {
        file_put_contents(LEADERBOARD_PATH, json_encode(default_entries(), JSON_PRETTY_PRINT), LOCK_EX);
    }

    $raw = file_get_contents(LEADERBOARD_PATH);
    if ($raw === false || trim($raw) === '') {
        return default_entries();
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return default_entries();
    }

    $entries = [];
    foreach ($data as $row) {
        if (!is_array($row)) continue;
        $name = normalize_name((string)($row['name'] ?? ''));
        $score = (int)($row['score'] ?? 0);
        if ($name === '' || $score < 0) continue;
        $entries[] = ['name' => $name, 'score' => $score];
    }

    usort($entries, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($entries, 0, MAX_ENTRIES);
}

function save_entries(array $entries): void {
    $json = json_encode(array_values($entries), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        send_json(500, ['error' => 'Encoding failed']);
    }
    file_put_contents(LEADERBOARD_PATH, $json, LOCK_EX);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    send_json(200, ['entries' => load_entries()]);
}

if ($method === 'POST') {
    $payloadRaw = file_get_contents('php://input');
    $payload = json_decode($payloadRaw ?: '', true);
    if (!is_array($payload)) {
        send_json(400, ['error' => 'Invalid JSON']);
    }

    $name = normalize_name((string)($payload['name'] ?? ''));
    $score = (int)($payload['score'] ?? -1);

    if ($name === '' || mb_strlen($name) > 10) {
        send_json(400, ['error' => 'Name is required and max 10 chars']);
    }
    if ($score < 0) {
        send_json(400, ['error' => 'Score must be >= 0']);
    }

    $entries = load_entries();
    $entries[] = ['name' => $name, 'score' => $score];
    usort($entries, fn($a, $b) => $b['score'] <=> $a['score']);
    $entries = array_slice($entries, 0, MAX_ENTRIES);
    save_entries($entries);

    send_json(200, ['entries' => $entries]);
}

send_json(405, ['error' => 'Method not allowed']);
