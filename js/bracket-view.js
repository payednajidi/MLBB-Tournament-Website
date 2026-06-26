// Shared bracket renderer — produces the same visual bracket as the public
// tournament page. Call renderFullBracket(matches, format, winnerId, names),
// where `names` is a { uid: teamName } map. Returns an HTML string.
let _names = {};
function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

    const BYE = "__BYE__";
    const isBye = (id) => id === BYE;

    function renderTeamRow(uid, score, match) {
      const bye     = isBye(uid) || (match.status === "bye" && !uid);
      const label   = bye ? "BYE" : (_names[uid] || "TBD");
      const state   = (uid && match.winnerId === uid) ? "winner" : (uid && match.loserId === uid) ? "loser" : "";
      const muted   = (!uid || isBye(uid)) ? (bye ? "bye" : "tbd") : "";
      return `<div class="team-row ${state} ${muted}"><span>${escHtml(label)}</span><span class="team-score">${Number(score)||0}</span></div>`;
    }

    // ── Bracket rendering ────────────────────────────────────
    // A "compact" bracket keeps the proven power-of-2 positional layout for ALL
    // matches (so cards never overlap and rounds stay aligned) but only renders
    // the *playable* ones. Bye/skip matches are not drawn — the rested team is
    // shown already seated in its next round. Connectors are routing-based: each
    // visible match draws an elbow to its visible destination, so no connector
    // ever dangles into the blank space left by a hidden bye.
    const CARD_H = 72;
    const CARD_W = 300;
    const CONN_W = 64;
    const R1_GAP = 18;
    const matchKey = (m) => `${m.bracket}_r${m.round}_m${m.position}`;
    // Hidden = a resolved bye/skip, OR a pass-through slot still holding the BYE
    // sentinel (e.g. an LB position whose feeder was a bye). The real team that
    // eventually arrives cascades straight through, so the placeholder match is
    // never shown as "BYE vs TBD".
    const isHidden = (m) => m.status === "bye" || m.status === "skip" || isBye(m.team1) || isBye(m.team2);

    // Elbow connector from a source card to its destination card's vertical
    // centre. `dy` is destTop − srcTop. Drawn relative to the source card.
    function connectorTo(dy) {
      const midY = Math.round(CARD_H / 2) - 1;
      let html = `<div class="bracket-conn" style="left:100%;top:${midY}px;width:${CONN_W}px;height:3px;"></div>`;
      if (dy !== 0) {
        const topB = Math.min(midY, midY + dy);
        html += `<div class="bracket-conn" style="left:calc(100% + ${CONN_W - 1}px);top:${topB}px;width:3px;height:${Math.abs(dy) + 3}px;"></div>`;
      }
      html += `<div class="bracket-conn" style="left:calc(100% + ${CONN_W}px);top:${midY + dy}px;width:${CONN_W}px;height:3px;"></div>`;
      return html;
    }

    function matchCardHtml(m, top, topMap) {
      const isDone   = m.status === "done" || m.status === "walkover";
      const isActive = m.status === "upcoming" || m.status === "pending" || m.status === "live";
      const cardCls  = isDone ? "done" : isActive ? "current" : "waiting";
      const destTop  = m.nextMatchId != null ? topMap[m.nextMatchId] : undefined;
      const conns    = destTop === undefined ? "" : connectorTo(destTop - top);
      return `<div class="match-card ${cardCls}" style="top:${top}px;width:${CARD_W}px;height:${CARD_H}px;">
        ${renderTeamRow(m.team1, m.score1, m)}
        ${renderTeamRow(m.team2, m.score2, m)}
        ${conns}
      </div>`;
    }

    // Positional layout (power-of-2 contraction) over ALL matches in a bracket.
    function computeBracketLayout(grouped, rounds) {
      const topsByRound = {};
      rounds.forEach((r, ri) => {
        const cur = grouped[r];
        if (ri === 0) { topsByRound[r] = cur.map((_, i) => i * (CARD_H + R1_GAP)); return; }
        const prev = grouped[rounds[ri - 1]], prevTops = topsByRound[rounds[ri - 1]];
        topsByRound[r] = cur.map((_, i) => {
          if (prev.length === 2 * cur.length) {
            const t0 = prevTops[i * 2]     ?? prevTops[0];
            const t1 = prevTops[i * 2 + 1] ?? prevTops[prevTops.length - 1];
            return (t0 + t1) / 2;
          }
          return prevTops[i] ?? i * (CARD_H + R1_GAP);
        });
      });
      const maxHeight = Math.max(...rounds.map(r => {
        const tops = topsByRound[r];
        return (tops[tops.length - 1] || 0) + CARD_H;
      }));
      const topMap = {};
      rounds.forEach(r => grouped[r].forEach((m, i) => { topMap[matchKey(m)] = topsByRound[r][i]; }));
      return { topsByRound, maxHeight, topMap };
    }

    function renderBracketSection(title, matches, bracket) {
      const grouped = {};
      Object.values(matches || {})
        .filter(m => m.bracket === bracket)
        .sort((a,b) => a.round - b.round || a.position - b.position)
        .forEach(m => { grouped[m.round] ||= []; grouped[m.round].push(m); });
      // Drop rounds that are entirely byes (e.g. an all-bye lower-bracket round 1)
      // so the bracket doesn't open with a blank column.
      const rounds = Object.keys(grouped).map(Number).sort((a,b) => a-b)
        .filter(r => grouped[r].some(m => !isHidden(m)));
      if (!rounds.length) return "";

      const { topsByRound, maxHeight, topMap } = computeBracketLayout(grouped, rounds);

      const cols = rounds.map((r, ri) => {
        const cur    = grouped[r];
        const tops   = topsByRound[r];
        const isLast = ri === rounds.length - 1;
        const cards  = cur.map((m, i) => isHidden(m) ? "" : matchCardHtml(m, tops[i], topMap)).join("");
        return `<div class="round-col" style="width:${CARD_W}px;height:${maxHeight}px;${isLast ? "" : `margin-right:${CONN_W * 2}px;`}">
          <div class="round-label">Round ${r}</div>
          ${cards}
        </div>`;
      });

      return `<div class="bracket-section">
        <h3 class="bracket-title">${title}</h3>
        <div class="bracket-track">
          ${cols.join("")}
        </div>
      </div>`;
    }

    function renderBracketDouble(matches, winnerId) {
      const CARD_H   = 72;
      const CARD_W   = 300;
      const CONN_W   = 64;
      const R1_GAP   = 18;
      const TRACK_PT = 28;
      const TITLE_H  = 16;
      const TITLE_MB = 6;
      const ROW_GAP  = 36;
      const PAD_TOP  = 12;

      function computeLayout(bracket) {
        const grouped = {};
        Object.values(matches || {})
          .filter(m => m.bracket === bracket)
          .sort((a,b) => a.round - b.round || a.position - b.position)
          .forEach(m => { grouped[m.round] ||= []; grouped[m.round].push(m); });
        // Drop entirely-bye rounds (e.g. an all-bye lower-bracket round 1) so the
        // track doesn't begin with a blank column.
        const rounds = Object.keys(grouped).map(Number).sort((a,b) => a-b)
          .filter(r => grouped[r].some(m => !isHidden(m)));
        if (!rounds.length) return null;

        const topsByRound = {};
        rounds.forEach((r, ri) => {
          const cur = grouped[r];
          if (ri === 0) {
            topsByRound[r] = cur.map((_, i) => i * (CARD_H + R1_GAP));
            return;
          }
          const prev     = grouped[rounds[ri - 1]];
          const prevTops = topsByRound[rounds[ri - 1]];
          topsByRound[r] = cur.map((_, i) => {
            if (prev.length === 2 * cur.length) {
              const t0 = prevTops[i * 2]     ?? prevTops[0];
              const t1 = prevTops[i * 2 + 1] ?? prevTops[prevTops.length - 1];
              return (t0 + t1) / 2;
            }
            return prevTops[i] ?? i * (CARD_H + R1_GAP);
          });
        });

        const maxHeight = Math.max(...rounds.map(r => {
          const tops = topsByRound[r];
          return (tops[tops.length - 1] || 0) + CARD_H;
        }));

        const trackWidth = rounds.reduce((w, _r, ri) => {
          return w + CARD_W + (ri < rounds.length - 1 ? CONN_W * 2 : 0);
        }, 0);

        const lastRound = rounds[rounds.length - 1];
        const lastTops  = topsByRound[lastRound];
        const finalMidY = lastTops[lastTops.length - 1] + CARD_H / 2;

        const topMap = {};
        rounds.forEach(r => grouped[r].forEach((m, i) => { topMap[matchKey(m)] = topsByRound[r][i]; }));

        return { grouped, rounds, topsByRound, maxHeight, trackWidth, finalMidY, topMap };
      }

      function renderMatchCols(layout, opts = {}) {
        const { grouped, rounds, topsByRound, maxHeight, topMap } = layout;
        const { hasLeftStub = false, labelFn = r => `Round ${r}` } = opts;

        return rounds.map((r, ri) => {
          const cur    = grouped[r];
          const tops   = topsByRound[r];
          const isLast = ri === rounds.length - 1;
          const midY   = Math.round(CARD_H / 2) - 1;

          const cards = cur.map((m, i) => {
            if (isHidden(m)) return "";
            // The grand-final card has no outgoing route inside its own track;
            // give it an incoming stub so the cross-bracket rail meets it.
            const stub = (ri === 0 && hasLeftStub)
              ? `<div class="bracket-conn" style="right:100%;top:${midY}px;width:${CONN_W}px;height:3px;"></div>`
              : "";
            const card = matchCardHtml(m, tops[i], topMap);
            return stub ? card.replace(/^(<div class="match-card[^>]*>)/, `$1${stub}`) : card;
          }).join("");

          return `<div class="round-col" style="width:${CARD_W}px;height:${maxHeight}px;${isLast ? "" : `margin-right:${CONN_W * 2}px;`}">
            <div class="round-label">${labelFn(r)}</div>
            ${cards}
          </div>`;
        }).join("");
      }

      const wb = computeLayout("wb");
      const lb = computeLayout("lb");
      const gf = computeLayout("gf");

      if (!wb) return '<p class="text-muted">Bracket belum dijana.</p>';

      const titleBlock     = TITLE_H + TITLE_MB;
      const wbTop          = PAD_TOP;
      const wbTrackStart   = wbTop + titleBlock + TRACK_PT;
      const wbFinalAbsMidY = wb ? (wbTrackStart + wb.finalMidY) : 0;
      const wbSectionH     = titleBlock + TRACK_PT + (wb?.maxHeight || 0);

      const lbTop          = wbTop + wbSectionH + ROW_GAP;
      const lbTrackStart   = lbTop + titleBlock + TRACK_PT;
      const lbFinalAbsMidY = lb ? (lbTrackStart + lb.finalMidY) : wbFinalAbsMidY;

      const gfCardAbsMidY   = lb ? Math.round((wbFinalAbsMidY + lbFinalAbsMidY) / 2) : wbFinalAbsMidY;
      const gfFirstCardMidY = gf ? ((gf.topsByRound[gf.rounds[0]][0] || 0) + CARD_H / 2) : CARD_H / 2;
      const gfTrackContentY = gfCardAbsMidY - gfFirstCardMidY;
      const gfTop           = Math.max(PAD_TOP, gfTrackContentY - TRACK_PT - titleBlock);

      const mainW  = Math.max(wb?.trackWidth || 0, lb?.trackWidth || 0);
      const railX  = mainW + CONN_W;
      const gfLeft = mainW + CONN_W * 2;

      const connectors = [];
      if (wb && gf) {
        connectors.push(`<div class="bracket-conn" style="position:absolute;left:${wb.trackWidth}px;top:${Math.round(wbFinalAbsMidY) - 1}px;width:${railX - wb.trackWidth}px;height:3px;"></div>`);
      }
      if (lb && gf) {
        connectors.push(`<div class="bracket-conn" style="position:absolute;left:${lb.trackWidth}px;top:${Math.round(lbFinalAbsMidY) - 1}px;width:${railX - lb.trackWidth}px;height:3px;"></div>`);
        const vTop = Math.min(wbFinalAbsMidY, lbFinalAbsMidY);
        const vH   = Math.abs(lbFinalAbsMidY - wbFinalAbsMidY);
        connectors.push(`<div class="bracket-conn" style="position:absolute;left:${railX - 1}px;top:${Math.round(vTop)}px;width:3px;height:${Math.round(vH)}px;"></div>`);
      }

      const lbBottom = lb ? (lbTop + titleBlock + TRACK_PT + lb.maxHeight) : 0;
      const gfBottom = gf ? (gfTop + titleBlock + TRACK_PT + gf.maxHeight) : 0;
      const totalH   = Math.max(wbTop + wbSectionH, lbBottom, gfBottom) + 24;
      const totalW   = gfLeft + (gf?.trackWidth || CARD_W) + 24;

      const champion = `<div class="champion-box">🏆 Champion: ${winnerId ? escHtml(_names[winnerId]||"—") : "Belum ditentukan"}</div>`;

      const wbLabelFn = r => {
        if (r === wb.rounds[wb.rounds.length - 1]) return "UB Final";
        return `Round ${r}`;
      };
      const lbLabelFn = lb ? r => {
        if (r === lb.rounds[lb.rounds.length - 1]) return "LB Final";
        if (r === lb.rounds[lb.rounds.length - 2]) return "LB Semi-Final";
        return `Round ${r}`;
      } : null;

      return `<div class="bracket-unified" style="position:relative;height:${totalH}px;width:${totalW}px;">
        ${wb ? `<div style="position:absolute;top:${wbTop}px;left:0;">
          <div class="bracket-subtitle">Upper Bracket</div>
          <div class="bracket-track">${renderMatchCols(wb, { labelFn: wbLabelFn })}</div>
        </div>` : ""}
        ${lb ? `<div style="position:absolute;top:${lbTop}px;left:0;">
          <div class="bracket-subtitle">Lower Bracket</div>
          <div class="bracket-track">${renderMatchCols(lb, { labelFn: lbLabelFn })}</div>
        </div>` : ""}
        ${connectors.join("")}
        ${gf ? `<div style="position:absolute;top:${gfTop}px;left:${gfLeft}px;">
          <div class="bracket-subtitle bracket-subtitle--gf">Grand Final</div>
          <div class="bracket-track">${renderMatchCols(gf, { hasLeftStub: true, labelFn: () => "Grand Final" })}</div>
        </div>` : ""}
      </div>
      ${champion}`;
    }

export function renderFullBracket(matches, format, winnerId, names) {
  _names = names || {};
  const all = Object.values(matches || {});
  if (!all.length) return '<p style="padding:1rem 0;color:var(--txt3);font-size:13px">Bracket belum dijana.</p>';
  // Render strictly by the tournament's format — identical to the public
  // tournament-detail page, so the two views never diverge.
  if (format === "double") return renderBracketDouble(matches, winnerId);
  const champion = `<div class="champion-box">🏆 Champion: ${winnerId ? escHtml(_names[winnerId] || "—") : "Belum ditentukan"}</div>`;
  return renderBracketSection("Upper Bracket", matches, "wb") + champion;
}
