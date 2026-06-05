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

export function generateBracket(teams, format, slotCount) {
  const slots = nextPowerOf2(slotCount);
  const seededTeams = [...teams].slice(0, slots);
  while (seededTeams.length < slots) seededTeams.push(null);

  const rounds = Math.log2(slots);
  const matches = {};

  for (let round = 1; round <= rounds; round++) {
    const matchCount = slots / 2 ** round;
    for (let position = 0; position < matchCount; position++) {
      let team1 = null;
      let team2 = null;
      let status = "waiting";
      let winnerId = null;

      if (round === 1) {
        team1 = seededTeams[position * 2] || null;
        team2 = seededTeams[position * 2 + 1] || null;
        status = "upcoming";

        if ((team1 && !team2) || (!team1 && team2)) {
          status = "bye";
          winnerId = team1 || team2;
        }
        if (!team1 && !team2) status = "waiting";
      }

      matches[getMatchId("wb", round, position)] = createMatch("wb", round, position, team1, team2, status, winnerId);
    }
  }

  if (format === "double") {
    const lbRoundCount = Math.max(1, (rounds - 1) * 2);
    for (let round = 1; round <= lbRoundCount; round++) {
      const matchCount = Math.max(1, Math.ceil(slots / 2 ** (Math.floor((round + 1) / 2) + 1)));
      for (let position = 0; position < matchCount; position++) {
        matches[getMatchId("lb", round, position)] = createMatch("lb", round, position);
      }
    }
    matches[getMatchId("gf", 1, 0)] = createMatch("gf", 1, 0);
  }

  return matches;
}

function parseMatchId(matchId) {
  const match = /^(wb|lb|gf)_r(\d+)_m(\d+)$/.exec(matchId);
  if (!match) return null;
  return {
    bracket: match[1],
    round: Number(match[2]),
    position: Number(match[3]),
  };
}

export function getNextMatchId(matchId, format) {
  const parsed = parseMatchId(matchId);
  if (!parsed) return null;
  const { bracket, round, position } = parsed;

  if (bracket === "gf") return null;
  if (bracket === "lb") return getMatchId("gf", 1, 0);
  if (format === "single") return getMatchId("wb", round + 1, Math.floor(position / 2));
  return getMatchId("wb", round + 1, Math.floor(position / 2));
}

export function getLBDropMatchId(matchId) {
  const parsed = parseMatchId(matchId);
  if (!parsed || parsed.bracket !== "wb") return null;
  const lbRound = (parsed.round - 1) * 2 + 1;
  return getMatchId("lb", lbRound, Math.floor(parsed.position / 2));
}

export function getSlotField(matchId, format) {
  const parsed = parseMatchId(matchId);
  if (!parsed) return "team1";
  if (format === "double" && parsed.bracket === "lb") return "team2";
  return parsed.position % 2 === 0 ? "team1" : "team2";
}

async function placeTeam(db, tournamentId, targetMatchId, slotField, teamId, updates) {
  if (!targetMatchId || !teamId) return;
  const targetRef = ref(db, `tournaments/${tournamentId}/matches/${targetMatchId}`);
  const snap = await get(targetRef);
  if (!snap.exists()) return;

  const target = snap.val();
  updates[`tournaments/${tournamentId}/matches/${targetMatchId}/${slotField}`] = teamId;
  const otherField = slotField === "team1" ? "team2" : "team1";
  if (target[otherField]) {
    updates[`tournaments/${tournamentId}/matches/${targetMatchId}/status`] = "upcoming";
  }
}

export async function advanceBracket(db, tournamentId, matchId, winnerId, loserId, format) {
  const parsed = parseMatchId(matchId);
  if (!parsed) throw new Error("Invalid match ID");

  const updates = {};

  if (parsed.bracket === "gf") {
    updates[`tournaments/${tournamentId}/status`] = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  let nextMatchId = getNextMatchId(matchId, format);
  let nextSnap = nextMatchId ? await get(ref(db, `tournaments/${tournamentId}/matches/${nextMatchId}`)) : null;

  if (format === "single" && parsed.bracket === "wb" && (!nextSnap || !nextSnap.exists())) {
    updates[`tournaments/${tournamentId}/status`] = "done";
    updates[`tournaments/${tournamentId}/winnerId`] = winnerId;
    await update(ref(db), updates);
    return;
  }

  if (format === "double" && parsed.bracket === "wb" && (!nextSnap || !nextSnap.exists())) {
    nextMatchId = getMatchId("gf", 1, 0);
    nextSnap = await get(ref(db, `tournaments/${tournamentId}/matches/${nextMatchId}`));
  }

  const winnerSlot = parsed.bracket === "wb" && nextMatchId === getMatchId("gf", 1, 0)
    ? "team1"
    : getSlotField(matchId, format);
  await placeTeam(db, tournamentId, nextMatchId, winnerSlot, winnerId, updates);

  if (format === "double" && parsed.bracket === "wb" && loserId) {
    const lbMatchId = getLBDropMatchId(matchId);
    await placeTeam(db, tournamentId, lbMatchId, getSlotField(matchId, format), loserId, updates);
  }

  if (Object.keys(updates).length) {
    await update(ref(db), updates);
  }
}
