import {
  ref,
  get,
  update,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export function nextPowerOf2(n) {
  const value = Number(n) || 1;
  return 2 ** Math.ceil(Math.log2(value));
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

function parseMatchId(matchId) {
  const m = /^(wb|lb|gf)_r(\d+)_m(\d+)$/.exec(matchId);
  if (!m) return null;
  return { bracket: m[1], round: Number(m[2]), position: Number(m[3]) };
}

export function generateBracket(teams, format, slotCount) {
  const slots  = nextPowerOf2(slotCount);
  const seeded = [...teams].slice(0, slots);
  while (seeded.length < slots) seeded.push(null);

  const rounds = Math.log2(slots);
  const lbRoundCount = format === "double" ? Math.max(1, (rounds - 1) * 2) : 0;
  const matches = {};

  // Upper Bracket
  for (let r = 1; r <= rounds; r++) {
    const cnt = slots / 2 ** r;
    for (let p = 0; p < cnt; p++) {
      let team1 = null, team2 = null, status = "waiting", winnerId = null;
      if (r === 1) {
        team1 = seeded[p * 2] || null;
        team2 = seeded[p * 2 + 1] || null;
        status = "upcoming";
        if ((team1 && !team2) || (!team1 && team2)) { status = "bye"; winnerId = team1 || team2; }
        if (!team1 && !team2) status = "waiting";
      }

      let nextMatchId, nextSlot;
      if (r < rounds) {
        nextMatchId = getMatchId("wb", r + 1, Math.floor(p / 2));
        nextSlot    = p % 2 === 0 ? "team1" : "team2";
      } else {
        nextMatchId = format === "double" ? getMatchId("gf", 1, 0) : null;
        nextSlot    = "team1";
      }

      let lbDropMatchId = null, lbDropSlot = null;
      if (format === "double") {
        if (r === 1) {
          lbDropMatchId = getMatchId("lb", 1, Math.floor(p / 2));
          lbDropSlot    = p % 2 === 0 ? "team1" : "team2";
        } else {
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

  // Lower Bracket
  for (let r = 1; r <= lbRoundCount; r++) {
    const cnt = Math.max(1, Math.ceil(slots / 2 ** (Math.floor((r + 1) / 2) + 1)));
    for (let p = 0; p < cnt; p++) {
      let nextMatchId, nextSlot;
      if (r === lbRoundCount) {
        nextMatchId = getMatchId("gf", 1, 0);
        nextSlot    = "team2";
      } else if (r % 2 === 1) {
        nextMatchId = getMatchId("lb", r + 1, p);
        nextSlot    = "team1";
      } else {
        nextMatchId = getMatchId("lb", r + 1, Math.floor(p / 2));
        nextSlot    = p % 2 === 0 ? "team1" : "team2";
      }
      matches[getMatchId("lb", r, p)] = { ...createMatch("lb", r, p), nextMatchId, nextSlot };
    }
  }

  // Grand Final
  matches[getMatchId("gf", 1, 0)] = { ...createMatch("gf", 1, 0), nextMatchId: null, nextSlot: null };

  return matches;
}

async function placeTeam(db, tournamentId, targetMatchId, slotField, teamId, updates) {
  if (!targetMatchId || !teamId) return;
  const snap = await get(ref(db, `tournaments/${tournamentId}/matches/${targetMatchId}`));
  if (!snap.exists()) return;

  const target = snap.val();
  updates[`tournaments/${tournamentId}/matches/${targetMatchId}/${slotField}`] = teamId;
  const other = slotField === "team1" ? "team2" : "team1";
  if (target[other]) {
    updates[`tournaments/${tournamentId}/matches/${targetMatchId}/status`] = "upcoming";
  }
}

export async function advanceBracket(db, tournamentId, matchId, winnerId, loserId, format) {
  const parsed = parseMatchId(matchId);
  if (!parsed) throw new Error("Invalid match ID");

  const updates = {};

  if (parsed.bracket === "gf") {
    updates[`tournaments/${tournamentId}/status`]   = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  const matchSnap = await get(ref(db, `tournaments/${tournamentId}/matches/${matchId}`));
  if (!matchSnap.exists()) throw new Error(`Match ${matchId} not found`);
  const match = matchSnap.val();
  const { nextMatchId, nextSlot, lbDropMatchId, lbDropSlot } = match;

  if (format === "single" && !nextMatchId) {
    updates[`tournaments/${tournamentId}/status`]   = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  if (nextMatchId && winnerId) {
    await placeTeam(db, tournamentId, nextMatchId, nextSlot || "team1", winnerId, updates);
  }

  if (format === "double" && parsed.bracket === "wb" && loserId && lbDropMatchId) {
    await placeTeam(db, tournamentId, lbDropMatchId, lbDropSlot || "team2", loserId, updates);
  }

  if (Object.keys(updates).length) {
    await update(ref(db), updates);
  }
}
