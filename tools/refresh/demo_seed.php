<?php
/**
 * Fills a throwaway copy of the site with made-up sample data for the admin demo.
 * Never run this on the real site.
 *
 * Usage: php demo_seed.php <demo-site-dir> <photo-dir>
 */
declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');
$photos = rtrim($argv[2] ?? '', '/');
if ($root === '' || !is_file($root . '/app/bootstrap.php') || !is_dir($photos)) {
    fwrite(STDERR, "Usage: php demo_seed.php <demo-site-dir> <photo-dir>\n");
    exit(1);
}
require $root . '/app/bootstrap.php';
require_once $root . '/app/lib/admin_stats.php';
// refuse to touch a site that holds real requests: every sample uses an @example.com address
$real = (int) q_val("SELECT COUNT(*) FROM requests WHERE email NOT LIKE '%@example.com'");
if ($real > 0) {
    fwrite(STDERR, "This copy has $real real request(s). Use a fresh copy with an empty data/ folder.\n");
    exit(1);
}

mt_srand(20261106);
$pdo = db();
$pdo->exec('DELETE FROM hits; DELETE FROM bot_hits; DELETE FROM request_events; DELETE FROM uploads; DELETE FROM requests; DELETE FROM mail_log; DELETE FROM rate_limits');

function pick(array $weighted): string
{
    $total = array_sum($weighted);
    $r = mt_rand(1, $total);
    foreach ($weighted as $k => $w) {
        $r -= $w;
        if ($r <= 0) {
            return (string) $k;
        }
    }
    return (string) array_key_first($weighted);
}

function lognormal(float $median, float $spread): int
{
    $u1 = max(1e-9, mt_rand() / mt_getrandmax());
    $u2 = mt_rand() / mt_getrandmax();
    $z = sqrt(-2 * log($u1)) * cos(2 * M_PI * $u2);
    return (int) round($median * exp($spread * $z));
}

// ---------------------------------------------------------------- visitors (last 120 days)
$titles = [
    '/' => 'Johnny B Home Construction', '/floor-plans' => 'Floor Plans', '/team' => 'Our Team',
    '/preferred-vendors' => 'Preferred Vendors', '/contact' => 'Contact', '/service' => 'Request Service',
    '/appointment' => 'Set Up an Appointment', '/privacy' => 'Privacy Policy',
];
$hit = $pdo->prepare('INSERT INTO hits (at, day, kind, name, label, path, title, ref_host, ref_path, utm_source, utm_medium, utm_campaign,
    visitor, session, is_new, consent, device, browser, os, screen_w, tz, lang, country, ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
$pdo->beginTransaction();
$returning = [];
for ($d = 120; $d >= 0; $d--) {
    $day = date('Y-m-d', strtotime("-$d days"));
    $dow = (int) date('N', strtotime($day));
    $base = $dow >= 6 ? 21 : 15;
    // a little growth over the months, plus the odd busy day (a Facebook post, a Showcase weekend)
    $visitors = max(4, (int) round($base * (0.8 + (120 - $d) / 300) + mt_rand(-5, 6) + (mt_rand(1, 30) === 1 ? 25 : 0)));
    if ($d === 0) {
        $visitors = (int) round($visitors * (int) date('G') / 24) + 2;
    }
    for ($v = 0; $v < $visitors; $v++) {
        $back = $returning && mt_rand(1, 100) <= 18;
        $vid = $back ? $returning[array_rand($returning)] : bin2hex(random_bytes(8));
        if (!$back && mt_rand(1, 3) === 1) {
            $returning[] = $vid;
        }
        $device = pick(['phone' => 67, 'desktop' => 27, 'tablet' => 6]);
        [$browser, $os] = match ($device) {
            'phone' => explode('|', pick(['Safari|iOS' => 58, 'Chrome|Android' => 30, 'Samsung Internet|Android' => 5, 'Facebook app|iOS' => 5, 'Chrome|iOS' => 2])),
            'tablet' => explode('|', pick(['Safari|iOS' => 80, 'Chrome|Android' => 20])),
            default => explode('|', pick(['Chrome|Windows' => 48, 'Edge|Windows' => 22, 'Safari|macOS' => 22, 'Firefox|Windows' => 5, 'Chrome|macOS' => 3])),
        };
        $screen = (int) match ($device) {
            'phone' => pick(['390' => 30, '393' => 20, '430' => 18, '375' => 14, '414' => 10, '360' => 8]),
            'tablet' => pick(['820' => 50, '768' => 25, '1024' => 25]),
            default => pick(['1920' => 38, '1536' => 22, '1440' => 20, '1366' => 15, '2560' => 5]),
        };
        $ref = pick(['google.com' => 44, '' => 27, 'facebook.com' => 12, 'bing.com' => 7, 'duckduckgo.com' => 2, 'chatgpt.com' => 4, 'perplexity.ai' => 1, 'paradeofhomes.org' => 2, 'bbb.org' => 1]);
        $tz = pick(['America/Chicago' => 88, 'America/New_York' => 4, 'America/Phoenix' => 3, 'America/Denver' => 2, 'America/Los_Angeles' => 2, 'Europe/Berlin' => 1]);
        $path = pick(['/' => 55, '/floor-plans' => 16, '/service' => 9, '/team' => 6, '/contact' => 6, '/preferred-vendors' => 5, '/appointment' => 3]);
        $pages = 1 + (mt_rand(1, 100) <= 55 ? mt_rand(1, 4) : 0);
        $t = strtotime($day . ' ' . sprintf('%02d:%02d:%02d', pick(['7' => 3, '8' => 5, '9' => 7, '10' => 7, '11' => 7, '12' => 8, '13' => 7, '14' => 6, '15' => 6, '16' => 6, '17' => 6, '18' => 7, '19' => 8, '20' => 9, '21' => 7, '22' => 4]), mt_rand(0, 59), mt_rand(0, 59)));
        for ($n = 0; $n < $pages; $n++) {
            $at = date('Y-m-d H:i:s', $t);
            $first = $n === 0;
            $hit->execute([$at, $day, 'view', '', '', $path, $titles[$path], $first ? $ref : '', '', '', '', '', $vid, '', $first && !$back ? 1 : 0, 0,
                           $device, $browser, $os, $screen, $tz, 'en-US', '', 0]);
            $lcp = lognormal($device === 'desktop' ? 950 : 1450, 0.35);
            $hit->execute([$at, $day, 'event', 'web_vitals', 'lcp', $path, '', '', '', '', '', '', $vid, '', 0, 0, $device, $browser, $os, $screen, $tz, 'en-US', '', $lcp]);
            $event = static fn (string $name, string $label) => $hit->execute([$at, $day, 'event', $name, $label, $path, '', '', '', '', '', '', $vid, '', 0, 0, $device, $browser, $os, $screen, $tz, 'en-US', '', 0]);
            if ($path === '/floor-plans' && mt_rand(1, 100) <= 45) {
                $event('tour_open', pick(['The Crescent 3D tour' => 30, 'The Forester 3D tour' => 25, 'The Settlement 3D tour' => 20, 'The Huron 3D tour' => 15, 'The Kennedy 3D tour' => 10]));
            }
            if (in_array($path, ['/service', '/appointment'], true)) {
                $kind = $path === '/service' ? 'service' : 'appointment';
                $event('form_view', $kind);
                if (mt_rand(1, 100) <= 52) {
                    $event('form_start', $kind);
                }
            }
            if ($path === '/' && mt_rand(1, 100) <= 4) {
                $event('directions_click', 'home');
            }
            if ($path === '/contact' && mt_rand(1, 100) <= 9) {
                $event('tel_click', 'contact main');
            }
            if ($path === '/preferred-vendors' && mt_rand(1, 100) <= 25) {
                $event('vendor_click', pick(['Pella Windows and Doors' => 3, 'Ferguson' => 2, 'Bank of Luxemburg' => 2, "Van Vreede's" => 2]));
            }
            $t += mt_rand(25, 160);
            $path = pick(['/floor-plans' => 30, '/team' => 15, '/contact' => 14, '/service' => 12, '/appointment' => 9, '/preferred-vendors' => 12, '/' => 8]);
        }
    }
    foreach (['Google' => 38, 'Bing' => 14, 'ChatGPT' => 6, 'Apple' => 4, 'Claude' => 3, 'Perplexity' => 2, 'DuckDuckGo' => 2, 'Meta AI' => 2] as $bot => $avg) {
        $count = max(0, $avg + mt_rand(-(int) ceil($avg / 3), (int) ceil($avg / 3)));
        for ($i = 0; $i < $count; $i++) {
            q('INSERT INTO bot_hits (at, day, bot, path) VALUES (?,?,?,?)', [$day . ' ' . sprintf('%02d:%02d:00', mt_rand(0, 23), mt_rand(0, 59)), $day, $bot,
              pick(['/' => 30, '/floor-plans' => 18, '/team' => 10, '/llms.txt' => 8, '/contact' => 10, '/preferred-vendors' => 8, '/service' => 8, '/robots.txt' => 8])]);
        }
    }
}
$pdo->commit();

// ---------------------------------------------------------------- sample requests
function stamp(string $when): string
{
    return date('Y-m-d H:i:s', strtotime($when));
}

function sample_photo(string $file): string
{
    $tmp = tempnam(sys_get_temp_dir(), 'demo');
    copy($file, $tmp);
    $r = upload_store(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp, 'name' => basename($file)], 'demo');
    if (empty($r['ok'])) {
        fwrite(STDERR, 'photo failed: ' . json_encode($r) . "\n");
        exit(1);
    }
    return $r['token'];
}

$future = static fn (int $days) => date('Y-m-d', strtotime("+$days weekdays"));
$samples = [
    ['when' => 'today 8:12', 'status' => 'new', 'in' => [
        'kind' => 'service', 'name' => 'Dana Schultz', 'email' => 'dana.schultz@example.com', 'phone' => '920-555-0142', 'contact_pref' => 'text',
        'address' => '1290 Willow Creek Drive, Green Bay, Wisconsin 54311', 'services' => ['Cabinets'], 'urgency' => 'soon',
        'description' => "The bottom drawer of the bathroom vanity won't close all the way, and the door next to it rubs. Photos attached.",
    ], 'photos' => ['vanity-1.jpg', 'vanity-2.jpg'], 'source' => ['page' => '/service', 'landing' => '/', 'referrer' => 'google.com'], 'events' => []],
    ['when' => 'yesterday 19:40', 'status' => 'new', 'in' => [
        'kind' => 'appointment', 'name' => 'Mike and Jen Vandenberg', 'email' => 'vandenbergs@example.com', 'phone' => '920-555-0187', 'contact_pref' => 'call',
        'stage' => 'have_land', 'meet' => 'office', 'plan' => 'The Forester', 'heard' => 'search',
        'slots' => [['date' => $future(2), 'part' => 'morning'], ['date' => $future(4), 'part' => 'afternoon']],
        'message' => 'We bought a lot in Bellevue and love The Forester. Could we talk about a version with a three-car garage?',
    ], 'source' => ['page' => '/appointment', 'landing' => '/floor-plans', 'referrer' => 'google.com'], 'events' => []],
    ['when' => '-3 days 7:05', 'status' => 'contacted', 'in' => [
        'kind' => 'service', 'name' => 'Linda Kowalski', 'email' => 'linda.k@example.com', 'phone' => '920-555-0119', 'contact_pref' => 'call',
        'address' => '845 Ridge Road, Green Bay, Wisconsin 54311', 'services' => ['Heating or Cooling'], 'urgency' => 'urgent',
        'description' => 'The furnace makes a loud bang when it kicks on. It still heats.',
    ], 'source' => ['page' => '/service', 'landing' => '/service', 'referrer' => 'facebook.com'], 'events' => [
        ['+40 minutes', 'status', 'Marked Contacted'],
        ['+45 minutes', 'note', 'Called Linda. The heating tech is going out Thursday morning.'],
    ]],
    ['when' => '-4 days 3:17', 'status' => 'spam', 'in' => [
        'kind' => 'appointment', 'name' => 'Website Ranking Team', 'email' => 'rank@example.com', 'phone' => '+1 555 0100 000', 'contact_pref' => 'email',
        'message' => 'We can put your website on page 1 of Google in 7 days. Reply for our price list.',
    ], 'source' => ['page' => '/appointment'], 'spam' => [12, 'link-heavy message, filled in 2 seconds'], 'events' => []],
    ['when' => '-6 days 12:30', 'status' => 'scheduled', 'in' => [
        'kind' => 'appointment', 'name' => 'Tom and Carrie Herber', 'email' => 'herber.family@example.com', 'phone' => '920-555-0164', 'contact_pref' => 'email',
        'stage' => 'ready', 'meet' => 'office', 'plan' => 'The Huron', 'heard' => 'referral',
        'slots' => [['date' => $future(1), 'part' => 'morning']],
        'message' => "Our neighbors built with you in 2019 and couldn't be happier. We'd like to start next spring.",
    ], 'source' => ['page' => '/appointment', 'landing' => '/'], 'events' => [
        ['+2 hours', 'status', 'Marked Scheduled'],
        ['+2 hours', 'note', 'Meeting at the office Tuesday at 10.'],
    ]],
    ['when' => '-9 days 16:48', 'status' => 'scheduled', 'in' => [
        'kind' => 'service', 'name' => 'Bob and Sue Lemke', 'email' => 'lemkes@example.com', 'phone' => '920-555-0133', 'contact_pref' => 'call',
        'address' => '3317 Bay Ridge Court, Green Bay, Wisconsin 54311', 'services' => ['Flooring'], 'urgency' => 'routine',
        'description' => 'Two boards squeak by the patio door and one has started to lift at the edge.',
    ], 'photos' => ['floor-1.jpg'], 'source' => ['page' => '/service', 'landing' => '/'], 'events' => [
        ['+1 day', 'status', 'Marked Scheduled'],
        ['+1 day', 'note', 'Flooring crew stopping by next Wednesday afternoon.'],
    ]],
    ['when' => '-13 days 10:02', 'status' => 'done', 'in' => [
        'kind' => 'service', 'name' => 'Jessica Nowak', 'email' => 'jnowak@example.com', 'phone' => '920-555-0158', 'contact_pref' => 'text',
        'address' => '2021 Autumn Leaf Lane, Green Bay, Wisconsin 54311', 'services' => ['Siding'], 'urgency' => 'soon',
        'description' => 'A piece of siding came loose on the north side after the storm.',
    ], 'source' => ['page' => '/service', 'landing' => '/service'], 'events' => [
        ['+3 hours', 'status', 'Marked Contacted'],
        ['+5 days', 'status', 'Marked Done'],
        ['+5 days', 'note', 'Siding reattached. Jessica sent a thank-you text.'],
    ]],
    ['when' => '-16 days 20:15', 'status' => 'contacted', 'in' => [
        'kind' => 'appointment', 'name' => 'Greg Pelnar', 'email' => 'gpelnar@example.com', 'phone' => '920-555-0171', 'contact_pref' => 'call',
        'stage' => 'exploring', 'meet' => 'phone', 'plan' => 'Not sure yet', 'heard' => 'showcase', 'flexible' => '1',
        'message' => 'Saw your home at the Showcase. Just starting to think about building in a year or two.',
    ], 'source' => ['page' => '/appointment', 'landing' => '/', 'referrer' => 'paradeofhomes.org'], 'events' => [
        ['+1 day', 'status', 'Marked Contacted'],
        ['+1 day', 'note', 'Talked for 20 minutes. Sending him the floor plan PDFs.'],
    ]],
];

foreach ($samples as $s) {
    $in = $s['in'];
    if (!empty($s['photos'])) {
        $in['uploads'] = array_map(static fn ($f) => sample_photo($photos . '/' . $f), $s['photos']);
    }
    [$d, $err] = request_validate($in);
    if ($err) {
        fwrite(STDERR, $in['name'] . ': ' . json_encode($err) . "\n");
        exit(1);
    }
    $r = request_save($d, ['page' => $s['source']['page'] ?? '']);
    $at = stamp($s['when']);
    [$score, $why] = $s['spam'] ?? [0, ''];
    q('UPDATE requests SET status = ?, source = ?, spam_score = ?, spam_reasons = ?, notify_status = ?, confirm_status = ?, created_at = ?, updated_at = ?, user_agent = ? WHERE id = ?', [
        $s['status'], json_out($s['source']), $score, $why, $score ? 'off' : 'sent', $score ? 'off' : 'sent', $at, $at,
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', $r['id'],
    ]);
    q('UPDATE uploads SET created_at = ? WHERE request_id = ?', [$at, $r['id']]);
    q('DELETE FROM request_events WHERE request_id = ?', [$r['id']]);
    q('INSERT INTO request_events (request_id, at, kind, body) VALUES (?,?,?,?)', [$r['id'], $at, 'system', 'Sent from the website (' . ($s['source']['page'] ?? '/') . ')']);
    if (!$score) {
        q('INSERT INTO request_events (request_id, at, kind, body) VALUES (?,?,?,?)', [$r['id'], date('Y-m-d H:i:s', strtotime($at) + 4), 'email', 'Emailed to ' . notify_to($d['kind'])]);
        q('INSERT INTO mail_log (at, request_id, to_addr, subject, ok, transport) VALUES (?,?,?,?,?,?)', [date('Y-m-d H:i:s', strtotime($at) + 4), $r['id'], notify_to($d['kind']), 'New request', 1, 'mail']);
    }
    foreach ($s['events'] as [$offset, $kind, $body]) {
        q('INSERT INTO request_events (request_id, at, kind, body) VALUES (?,?,?,?)', [$r['id'], date('Y-m-d H:i:s', strtotime($offset, strtotime($at))), $kind, $body]);
    }
    // the form events that go with a real send
    $vid = bin2hex(random_bytes(8));
    $day = substr($at, 0, 10);
    foreach (['form_view', 'form_start', 'form_submit'] as $name) {
        q("INSERT INTO hits (at, day, kind, name, label, path, visitor, device, browser, os) VALUES (?,?,?,?,?,?,?,?,?,?)", [$at, $day, 'event', $name, $d['kind'], '/' . $d['kind'], $vid, 'phone', 'Safari', 'iOS']);
    }
}
// only the newest requests are still unread, like a real inbox
q("UPDATE requests SET read_at = datetime(created_at, '+1 hour') WHERE status != 'new'");
q('DELETE FROM rate_limits');
echo 'requests: ', q_val('SELECT COUNT(*) FROM requests'), ', photos: ', q_val('SELECT COUNT(*) FROM uploads'), ', views: ', q_val("SELECT COUNT(*) FROM hits WHERE kind = 'view'"), "\n";
