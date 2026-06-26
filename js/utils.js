import {
  ref,
  get,
  update,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export function nextPowerOf2(n) {
  const value = Number(n) || 1;
  return 2 ** Math.ceil(Math.log2(value));
}

// ── BYE sentinel ────────────────────────────────────────────────────────────
// Stored in team1/team2 to mark a *permanent* empty slot (a real opponent will
// never arrive). This is deliberately distinct from `null`, which means "still
// awaiting a feeder result". Consuming code must resolve it to the label "BYE"
// and never look it up as a real team.
export const BYE = "__BYE__";
export function isBye(id) {
  return id === BYE;
}

// Standard single-elimination seed order for a power-of-2 bracket size.
// Returns an array (length = size) of 1-indexed seed numbers in slot order, so
// that top seeds are spread apart and meet as late as possible.
//   size 4  -> [1,4,2,3]
//   size 8  -> [1,8,4,5,2,7,3,6]
export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const s of order) { next.push(s); next.push(sum - s); }
    order = next;
  }
  return order;
}

// Map a team list onto `full` slots using standard seeding. Slots whose seed
// number exceeds the team count become the BYE sentinel (a distributed bye),
// which keeps the first round balanced and pushes byes to the strongest lines.
export function seedSlots(teams, full) {
  const order = seedOrder(full);
  const count = teams.length;
  return order.map((seed) => (seed <= count ? teams[seed - 1] : BYE));
}

export function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function formatDate(timestamp) {
  if (!timestamp) return "Belum ditetapkan";
  return new Intl.DateTimeFormat("ms-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestamp));
}

export function formatPrize(amount) {
  const value = Number(amount) || 0;
  return `RM ${value.toLocaleString("en-MY")}`;
}

export function showToast(message, type = "info") {
  let wrap = document.querySelector(".toast-stack");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-stack";
    wrap.style.position = "fixed";
    wrap.style.right = "18px";
    wrap.style.bottom = "18px";
    wrap.style.zIndex = "9999";
    wrap.style.display = "grid";
    wrap.style.gap = "10px";
    wrap.style.maxWidth = "340px";
    document.body.appendChild(wrap);
  }

  const toast = document.createElement("div");
  const color = type === "success" ? "var(--green)" : type === "error" ? "var(--red)" : "var(--blue2)";
  toast.className = `alert alert-${type === "error" ? "error" : type === "success" ? "success" : "info"} show`;
  toast.textContent = message;
  toast.style.display = "block";
  toast.style.margin = "0";
  toast.style.borderColor = color;
  wrap.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    if (!wrap.children.length) wrap.remove();
  }, 3000);
}

export function setLoading(btn, isLoading, originalHTML) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Loading...';
    return;
  }
  btn.innerHTML = originalHTML;
  btn.disabled = false;
}

export function getMatchId(bracket, round, position) {
  return `${bracket}_r${round}_m${position}`;
}

function createMatch(bracket, round, position, team1 = null, team2 = null, status = "waiting", winnerId = null) {
  return {
    bracket,
    round,
    position,
    team1,
    team2,
    score1: 0,
    score2: 0,
    winnerId,
    loserId: null,
    status,
    confirmedBy: null,
    submittedAt: null,
    completedAt: null,
  };
}

// ── Bracket ID helpers ─────────────────────────────────────────────────────

function parseMatchId(matchId) {
  const m = /^(wb|lb|gf)_r(\d+)_m(\d+)$/.exec(matchId);
  if (!m) return null;
  return { bracket: m[1], round: Number(m[2]), position: Number(m[3]) };
}

// ── Bracket generation ──────────────────────────────────────────────────────
//
// Each match stores its own routing so advancement never relies on formulas:
//   nextMatchId / nextSlot  — where the winner goes
//   lbDropMatchId / lbDropSlot — where the WB loser drops (WB matches only, double)
//
// Standard double-elimination routing for 2^rounds teams:
//
//   WB R1 loser  →  LB R1  (each pair of R1 losers fills one LB R1 match)
//   WB R2 loser  →  LB R2  (cross round — faces LB R1 winner, team2 slot)
//   WB Final loser → LB Final  (=LB R{(rounds-1)*2}, team2 slot)
//
//   LB odd rounds  (R1, R3 …) — no halving, same position, team1 slot
//   LB even rounds (R2, R4-2…) — halving, position/2, slot by parity
//   LB Final winner → GF team2
//   WB Final winner → GF team1

export function generateBracket(teams, format, slotCount) {
  const slots  = nextPowerOf2(slotCount);
  // Standard seeding distributes byes to the strongest lines (was sequential,
  // which clustered teams and left lopsided empty matches). Empty slots hold the
  // BYE sentinel rather than null.
  const seeded = seedSlots([...teams].slice(0, slots), slots);

  const rounds = Math.log2(slots);
  const lbRoundCount = format === "double" ? Math.max(1, (rounds - 1) * 2) : 0;
  const matches = {};

  // ── Upper Bracket ─────────────────────────────────────────────────────────
  for (let r = 1; r <= rounds; r++) {
    const cnt = slots / 2 ** r;
    for (let p = 0; p < cnt; p++) {

      // ── Seed first-round teams ──
      let team1 = null, team2 = null, status = "waiting", winnerId = null;
      if (r === 1) {
        team1 = seeded[p * 2] ?? BYE;
        team2 = seeded[p * 2 + 1] ?? BYE;
        if (isBye(team1) && isBye(team2)) status = "skip";
        else if (isBye(team1) || isBye(team2)) { status = "bye"; winnerId = isBye(team1) ? team2 : team1; }
        else status = "upcoming";
      }

      // ── Winner routing ──
      let nextMatchId, nextSlot;
      if (r < rounds) {
        nextMatchId = getMatchId("wb", r + 1, Math.floor(p / 2));
        nextSlot    = p % 2 === 0 ? "team1" : "team2";
      } else {
        // WB Final
        nextMatchId = format === "double" ? getMatchId("gf", 1, 0) : null;
        nextSlot    = "team1";
      }

      // ── Loser routing (double only) ──
      let lbDropMatchId = null, lbDropSlot = null;
      if (format === "double") {
        if (r === 1) {
          // Pair up R1 losers into LB R1
          lbDropMatchId = getMatchId("lb", 1, Math.floor(p / 2));
          lbDropSlot    = p % 2 === 0 ? "team1" : "team2";
        } else {
          // WB Rk (k≥2) → LB R{2*(k-1)}, same position, team2 slot
          lbDropMatchId = getMatchId("lb", 2 * (r - 1), p);
          lbDropSlot    = "team2";
        }
      }

      matches[getMatchId("wb", r, p)] = {
        ...createMatch("wb", r, p, team1, team2, status, winnerId),
        nextMatchId,
        nextSlot,
        ...(lbDropMatchId ? { lbDropMatchId, lbDropSlot } : {}),
      };
    }
  }

  if (format !== "double") return matches;

  // ── Lower Bracket ─────────────────────────────────────────────────────────
  for (let r = 1; r <= lbRoundCount; r++) {
    const cnt = Math.max(1, Math.ceil(slots / 2 ** (Math.floor((r + 1) / 2) + 1)));
    for (let p = 0; p < cnt; p++) {

      let nextMatchId, nextSlot;
      if (r === lbRoundCount) {
        // LB Final winner → GF team2
        nextMatchId = getMatchId("gf", 1, 0);
        nextSlot    = "team2";
      } else if (r % 2 === 1) {
        // Odd round: no halving — LB survivor advances to same position, team1
        nextMatchId = getMatchId("lb", r + 1, p);
        nextSlot    = "team1";
      } else {
        // Even round: halving — two LB survivors merge into one match
        nextMatchId = getMatchId("lb", r + 1, Math.floor(p / 2));
        nextSlot    = p % 2 === 0 ? "team1" : "team2";
      }

      matches[getMatchId("lb", r, p)] = {
        ...createMatch("lb", r, p),
        nextMatchId,
        nextSlot,
      };
    }
  }

  // ── Grand Final ───────────────────────────────────────────────────────────
  matches[getMatchId("gf", 1, 0)] = {
    ...createMatch("gf", 1, 0),
    nextMatchId: null,
    nextSlot:    null,
  };

  return matches;
}

// ── Flexible seeding: shuffle teams + auto-resolve BYEs ────────────────────

// Propagate byes through the freshly generated bracket. A slot advances ONLY
// when its sibling is the BYE sentinel — never on a plain null, which means the
// slot is still awaiting a feeder result. This keeps a rested round-2 team
// (real team + null sibling) waiting for its play-in opponent instead of being
// wrongly fast-forwarded.
function resolveByes(matches) {
  // 1. Pre-mark lower-bracket slots whose upper-bracket feeder is a bye/skip
  //    (no loser will ever drop in) with the BYE sentinel so they can cascade.
  for (const m of Object.values(matches)) {
    if (m.bracket === "wb" && (m.status === "bye" || m.status === "skip") && m.lbDropMatchId) {
      const lb = matches[m.lbDropMatchId];
      if (lb && lb[m.lbDropSlot] == null) lb[m.lbDropSlot] = BYE;
    }
  }

  const forward = (m, value) => {
    if (!m.nextMatchId || !matches[m.nextMatchId]) return false;
    const nxt = matches[m.nextMatchId];
    if (nxt[m.nextSlot] != null) return false;          // slot already taken
    nxt[m.nextSlot] = value;
    if (nxt.team1 != null && nxt.team2 != null && !isBye(nxt.team1) && !isBye(nxt.team2) && nxt.status === "waiting") {
      nxt.status = "upcoming";
    }
    return true;
  };

  // 2. Iteratively forward bye winners and cascade phantom (BYE-vs-BYE) matches.
  let changed = true, iters = 0;
  while (changed && iters < 500) {
    changed = false; iters++;
    for (const m of Object.values(matches)) {
      if (m.status === "done" || m.status === "walkover") continue;
      const t1 = m.team1, t2 = m.team2;
      const oneReal = (t1 != null && !isBye(t1) && isBye(t2)) || (t2 != null && !isBye(t2) && isBye(t1));
      const bothBye = isBye(t1) && isBye(t2);

      if (oneReal) {                                      // real team + sentinel → bye
        const winner = (t1 != null && !isBye(t1)) ? t1 : t2;
        if (!(m.status === "bye" && m.winnerId === winner)) {
          m.status = "bye"; m.winnerId = winner; m.loserId = null; changed = true;
        }
        if (forward(m, winner)) changed = true;
      } else if (bothBye) {                               // pure phantom → skip
        if (m.status !== "skip") { m.status = "skip"; m.winnerId = BYE; changed = true; }
        if (forward(m, BYE)) changed = true;
      }
    }
  }

  // 3. Mark fully-seated real matches ready.
  for (const m of Object.values(matches)) {
    if (m.status === "waiting" && m.team1 != null && m.team2 != null && !isBye(m.team1) && !isBye(m.team2)) {
      m.status = "upcoming";
    }
  }
}

export function seedAndLockBracket(approvedTeamUids, format, maxSlots) {
  // Fisher-Yates shuffle for random seeding
  const teams = [...approvedTeamUids];
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  // Bracket size = next power of 2 from actual team count, capped at maxSlots
  const actualSize = nextPowerOf2(Math.max(teams.length, 2));
  const bracketSize = Math.min(actualSize, nextPowerOf2(maxSlots));
  const matches = generateBracket(teams, format, bracketSize);
  resolveByes(matches);
  return { matches, bracketSize };
}

// Rebuild a compact, balanced bracket from the actual registered teams. Used by
// the "Rearrange Bracket" admin action. Identical seeding to seedAndLockBracket
// but named for clarity at the call site; safe to re-run on a live tournament
// to collapse a sparse bracket down to its registered-team size.
export function rearrangeBracket(teamUids, format, maxSlots) {
  return seedAndLockBracket(teamUids, format, maxSlots);
}

// ── Bracket advancement ─────────────────────────────────────────────────────

async function placeTeam(db, tournamentId, targetMatchId, slotField, teamId, updates) {
  if (!targetMatchId || !teamId || isBye(teamId)) return;
  const snap = await get(ref(db, `tournaments/${tournamentId}/matches/${targetMatchId}`));
  if (!snap.exists()) return;

  const target = snap.val();
  const base = `tournaments/${tournamentId}/matches/${targetMatchId}`;
  updates[`${base}/${slotField}`] = teamId;
  const otherField = slotField === "team1" ? "team2" : "team1";
  const other = target[otherField];

  if (isBye(other)) {
    // Phantom sibling — this team gets a free pass. Mark the slot as a resolved
    // bye and cascade the team onward (chains through consecutive LB byes).
    updates[`${base}/status`]   = "bye";
    updates[`${base}/winnerId`] = teamId;
    updates[`${base}/loserId`]  = null;
    await placeTeam(db, tournamentId, target.nextMatchId, target.nextSlot || "team1", teamId, updates);
  } else if (other != null) {
    updates[`${base}/status`] = "upcoming";
  }
}

export async function advanceBracket(db, tournamentId, matchId, winnerId, loserId, format) {
  const parsed = parseMatchId(matchId);
  if (!parsed) throw new Error("Invalid match ID");

  const updates = {};

  // Grand Final completed → tournament done
  if (parsed.bracket === "gf") {
    updates[`tournaments/${tournamentId}/status`]   = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  // Read routing from the match record itself
  const matchSnap = await get(ref(db, `tournaments/${tournamentId}/matches/${matchId}`));
  if (!matchSnap.exists()) throw new Error(`Match ${matchId} not found`);
  const match = matchSnap.val();

  const { nextMatchId, nextSlot, lbDropMatchId, lbDropSlot } = match;

  // Single elim: WB Final winner → tournament done
  if (format === "single" && !nextMatchId) {
    updates[`tournaments/${tournamentId}/status`]   = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  // Advance winner
  if (nextMatchId && winnerId) {
    await placeTeam(db, tournamentId, nextMatchId, nextSlot || "team1", winnerId, updates);
  }

  // Drop WB loser into LB (double elim only)
  if (format === "double" && parsed.bracket === "wb" && loserId && lbDropMatchId) {
    await placeTeam(db, tournamentId, lbDropMatchId, lbDropSlot || "team2", loserId, updates);
  }

  if (Object.keys(updates).length) {
    await update(ref(db), updates);
  }
}
