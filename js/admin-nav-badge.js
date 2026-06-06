/**
 * admin-nav-badge.js
 * Attaches a real-time pending-action counter to every
 * .admin-nav-badge span on the current page.
 *
 * Usage (organizer pages only):
 *   import { initAdminNavBadge, cleanupAdminNavBadge } from "./js/admin-nav-badge.js";
 *   // call once role === "organizer" is confirmed:
 *   initAdminNavBadge(db);
 *
 * Pending sources tracked:
 *   • tournamentApplications  – status "pending_review" | "payment_submitted"
 *   • teamModRequests          – status "change_requested" | "pending_review"
 */

import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

let _unsubs = [];

/**
 * Start real-time listeners and update all .admin-nav-badge elements.
 * @param {import("firebase/database").Database} db
 */
export function initAdminNavBadge(db) {
  let appCount = 0;
  let modCount = 0;

  function refresh() {
    const total = appCount + modCount;
    document.querySelectorAll(".admin-nav-badge").forEach(el => {
      el.textContent = total > 99 ? "99+" : String(total);
      el.style.display = total > 0 ? "inline-flex" : "none";
    });
  }

  // ── Tournament applications ─────────────────────────────
  // Structure: applications/{tournamentId}/{teamUid} → { status, … }
  const unsubApps = onValue(ref(db, "applications"), snap => {
    let count = 0;
    if (snap.exists()) {
      snap.forEach(tourney => {
        tourney.forEach(app => {
          const s = app.val()?.status;
          if (s === "pending_review" || s === "payment_submitted") count++;
        });
      });
    }
    appCount = count;
    refresh();
  });

  // ── Team modification requests ──────────────────────────
  // Structure: teamModRequests/{uid} → { status, … }
  const unsubMods = onValue(ref(db, "teamModRequests"), snap => {
    let count = 0;
    if (snap.exists()) {
      snap.forEach(req => {
        const s = req.val()?.status;
        if (s === "change_requested" || s === "pending_review") count++;
      });
    }
    modCount = count;
    refresh();
  });

  _unsubs = [unsubApps, unsubMods];
}

/**
 * Detach listeners (call on page unload / sign-out if needed).
 */
export function cleanupAdminNavBadge() {
  _unsubs.forEach(fn => fn());
  _unsubs = [];
}
