import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initTournamentBanner(db) {
  const el = document.getElementById("tournamentBanner");
  if (!el) return;

  onValue(ref(db, "tournaments"), (snap) => {
    const all = snap.val() || {};

    const active = Object.entries(all)
      .map(([id, t]) => ({ id, ...t }))
      .filter(t => t.status === "live" || t.status === "registration")
      .sort((a, b) => {
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        return (b.startDate || 0) - (a.startDate || 0);
      });

    if (!active.length) {
      el.hidden = true;
      return;
    }

    const t = active[0];
    const isLive = t.status === "live";
    const statusLabel = isLive ? "SEDANG BERLANGSUNG" : "PENDAFTARAN DIBUKA";
    const stCls = isLive ? "tb-live" : "tb-reg";
    const format = t.format === "double" ? "Double Elimination"
                 : t.format === "single" ? "Single Elimination"
                 : (t.format || "—");
    const prizeVal = Number(t.prizePool) || 0;
    const prizeStr = prizeVal > 0 ? `RM ${prizeVal.toLocaleString("en-MY")}` : null;
    const maxT = Number(t.maxTeams) || 0;
    const curT = Number(t.teamCount) || 0;
    const cta = isLive ? "LIHAT BRACKET" : "DAFTAR SEKARANG";
    const href = `tournament-details?id=${encodeURIComponent(t.id)}`;

    const prizeHtml = prizeStr
      ? `<span class="tb-sep"></span><span class="tb-meta">Hadiah: <b>${esc(prizeStr)}</b></span>`
      : "";

    const slotsHtml = maxT
      ? `<span class="tb-sep"></span><span class="tb-meta">${isLive
          ? `${maxT} Pasukan`
          : `${curT}/${maxT} Berdaftar`}</span>`
      : "";

    el.hidden = false;
    el.className = `tournament-banner ${stCls}`;
    el.innerHTML = `<a class="tb-link" href="${esc(href)}">
      <span class="tb-badge"><span class="tb-dot"></span>${statusLabel}</span>
      <span class="tb-name">${esc(t.name || "")}</span>
      <span class="tb-sep"></span>
      <span class="tb-meta">${esc(format)}</span>
      ${prizeHtml}${slotsHtml}
      <span class="tb-cta">${cta} <span class="tb-arr">→</span></span>
    </a>`;
  });
}
