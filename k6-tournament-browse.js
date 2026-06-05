/**
 * MLBB OPS — k6 Load Test Script
 *
 * Simulates real user behaviour: browse schedule → view tournament details →
 * optionally browse standings.
 *
 * USAGE
 * ─────
 * Install k6:  https://k6.io/docs/get-started/installation/
 * Run locally: k6 run k6-tournament-browse.js
 *
 * Run against Firebase emulator (recommended first):
 *   firebase emulators:start --only database,auth
 *   k6 run --env BASE_URL=http://localhost:5000 \
 *           --env DB_URL=http://localhost:9000/mlbb-tournament-ee7d3-default-rtdb \
 *           k6-tournament-browse.js
 *
 * Run against production (use sparingly — counts against Firebase quota):
 *   k6 run --env BASE_URL=https://mlbb-tournament-ee7d3.web.app \
 *           --env DB_URL=https://mlbb-tournament-ee7d3-default-rtdb.asia-southeast1.firebasedatabase.app \
 *           k6-tournament-browse.js
 *
 * LOAD STAGES
 * ───────────
 * The default stages ramp from 10 → 100 → 500 → 1000 VUs then back down.
 * Adjust the `options.stages` array below to match your test scenario.
 *
 * THRESHOLDS (pass/fail criteria)
 * ────────────────────────────────
 * p95 response time < 1500ms, error rate < 1%
 */

import http from "k6/http";
import { sleep, check, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Configuration ──────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const DB_URL   = __ENV.DB_URL   ||
  "https://mlbb-tournament-ee7d3-default-rtdb.asia-southeast1.firebasedatabase.app";

// ── Custom metrics ─────────────────────────────────────────────────────────
const errorRate   = new Rate("error_rate");
const dbReadTime  = new Trend("db_read_ms", true);
const pageLoadTime = new Trend("page_load_ms", true);

// ── Load stages ────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s",  target: 10   },   // warm-up
    { duration: "60s",  target: 100  },   // ramp to 100 concurrent users
    { duration: "60s",  target: 100  },   // hold at 100
    { duration: "30s",  target: 500  },   // ramp to 500
    { duration: "60s",  target: 500  },   // hold at 500
    { duration: "30s",  target: 1000 },   // ramp to 1,000
    { duration: "60s",  target: 1000 },   // hold at 1,000
    { duration: "30s",  target: 0    },   // ramp down
  ],
  thresholds: {
    "http_req_duration":        ["p(95)<1500"],   // 95% of requests under 1.5s
    "http_req_duration{type:db}": ["p(95)<800"],  // DB reads under 800ms
    "error_rate":               ["rate<0.01"],    // under 1% errors
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function firebaseGet(path, params = {}) {
  const qs = Object.entries({ orderBy: '"$key"', ...params })
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const url = `${DB_URL}/${path}.json?${qs}`;
  const start = Date.now();
  const res = http.get(url, { tags: { type: "db" } });
  dbReadTime.add(Date.now() - start);
  return res;
}

function staticGet(path) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/${path}`);
  pageLoadTime.add(Date.now() - start);
  return res;
}

// ── Scenario: anonymous visitor browses schedule ───────────────────────────
function scenarioAnonymousBrowse() {
  group("Static: schedule.html", () => {
    const res = staticGet("schedule.html");
    const ok = check(res, { "status 200": r => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(1);

  group("DB: fetch tournaments list", () => {
    const res = firebaseGet("tournaments", {
      orderBy: '"startDate"',
      limitToLast: "20",
    });
    const ok = check(res, {
      "db status 200":  r => r.status === 200,
      "has json body":  r => r.body && r.body.length > 2,
    });
    errorRate.add(!ok);
  });

  sleep(2);

  group("Static: tournament-details.html", () => {
    const res = staticGet("tournament-details.html?id=placeholder");
    const ok = check(res, { "status 200": r => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(1);
}

// ── Scenario: player views standings ──────────────────────────────────────
function scenarioStandings() {
  group("Static: standing.html", () => {
    const res = staticGet("standing.html");
    const ok = check(res, { "status 200": r => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(1);

  group("DB: fetch all teams", () => {
    const res = firebaseGet("teams");
    const ok = check(res, { "teams status 200": r => r.status === 200 });
    errorRate.add(!ok);
  });

  group("DB: fetch completed tournaments", () => {
    const res = firebaseGet("tournaments", {
      orderBy: '"status"',
      equalTo: '"done"',
    });
    const ok = check(res, { "done tournaments 200": r => r.status === 200 });
    errorRate.add(!ok);
  });

  group("DB: fetch seasons config", () => {
    const res = firebaseGet("seasons");
    check(res, { "seasons 200": r => r.status === 200 });
  });

  sleep(3);
}

// ── Main virtual user flow ─────────────────────────────────────────────────
export default function () {
  // 70% of users browse schedule, 30% check standings
  const roll = Math.random();
  if (roll < 0.70) {
    scenarioAnonymousBrowse();
  } else {
    scenarioStandings();
  }

  // Random think-time between 1–5 seconds (mimics real user behaviour)
  sleep(1 + Math.random() * 4);
}

// ── Summary report ─────────────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    "k6-results-summary.json": JSON.stringify(data, null, 2),
  };
}
