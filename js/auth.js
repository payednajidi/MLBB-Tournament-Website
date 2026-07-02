import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  signInWithEmailAndPassword as reSignIn,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  ref,
  set,
  get,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "admin123";

const ADMIN_EMAIL    = "admin@mlbbops.app";
const PLAYER_DOMAIN  = "players.mlbbops.app";

/* ── Helpers ──────────────────────────────────────────── */
function cleanUsername(username) {
  return username.trim().toLowerCase();
}

function usernameToEmail(username) {
  const clean = cleanUsername(username);
  if (clean.includes("@")) return clean;
  return `${clean}@${PLAYER_DOMAIN}`;
}

function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

/** Formats a ms timestamp → "03 Jun 2026, 02:30 PTG" */
function formatDateTime(ms) {
  return new Date(ms).toLocaleString("ms-MY", {
    timeZone:  "Asia/Kuala_Lumpur",
    day:       "2-digit",
    month:     "short",
    year:      "numeric",
    hour:      "2-digit",
    minute:    "2-digit",
    hour12:    true,
  });
}

/** Generates a 12-char secure random password (no ambiguous chars) */
export function generatePassword() {
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower   = "abcdefghjkmnpqrstuvwxyz";
  const digits  = "23456789";
  const special = "@#$%&*";
  const all     = upper + lower + digits + special;

  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);

  // Guarantee at least one of each category
  const pwd = [
    upper[buf[0]   % upper.length],
    lower[buf[1]   % lower.length],
    digits[buf[2]  % digits.length],
    special[buf[3] % special.length],
    ...Array.from(buf.slice(4, 12), b => all[b % all.length]),
  ];

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join("");
}

/** Atomically increments /meta/playerCount and returns MLBB@HC-YYYY-XXXXX */
async function generatePlayerId() {
  const counterRef = ref(db, "meta/playerCount");
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  const count  = result.snapshot.val();
  const year   = new Date().getFullYear();
  return `MLBB@HC-${year}-${String(count).padStart(5, "0")}`;
}

/* ── Auth functions ───────────────────────────────────── */

/**
 * Registers a new player with a user-supplied password.
 * Returns { user, playerId }
 */
export async function registerWithUsername(username, password) {
  const clean = cleanUsername(username);
  if (!validUsername(clean))      throw new Error("invalid-username");
  if (clean === ADMIN_USERNAME)   throw new Error("reserved-username");

  const email = usernameToEmail(clean);
  const now   = Date.now();

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const playerId = await generatePlayerId();

  const userData = {
    username:    clean,
    email,
    role:        "player",
    playerId,
    createdAt:   formatDateTime(now),
    createdAtMs: now,
  };

  await set(ref(db, `users/${cred.user.uid}`), userData);

  await set(ref(db, `playerIndex/${playerId}`), {
    uid:      cred.user.uid,
    username: clean,
  });

  return { user: cred.user, playerId };
}

async function ensureAdminAccount() {
  try {
    const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    await set(ref(db, `users/${cred.user.uid}`), {
      displayName:  "Admin",
      username:     ADMIN_USERNAME,
      email:        ADMIN_EMAIL,
      role:         "organizer",
      createdAt:    formatDateTime(Date.now()),
      createdAtMs:  Date.now(),
    });
    await set(ref(db, `organizers/${cred.user.uid}`), { isOrganizer: true });
    return cred.user;
  } catch (error) {
    if (
      error.code !== "auth/user-not-found" &&
      error.code !== "auth/invalid-credential"
    ) throw error;

    const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    await set(ref(db, `users/${cred.user.uid}`), {
      displayName:  "Admin",
      username:     ADMIN_USERNAME,
      email:        ADMIN_EMAIL,
      role:         "organizer",
      createdAt:    formatDateTime(Date.now()),
      createdAtMs:  Date.now(),
    });
    await set(ref(db, `organizers/${cred.user.uid}`), { isOrganizer: true });
    return cred.user;
  }
}

export async function loginWithCredentials(username, password) {
  const clean = cleanUsername(username);
  if (clean === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return ensureAdminAccount();
  }
  if (clean === ADMIN_USERNAME) throw new Error("invalid-admin-password");
  const cred = await signInWithEmailAndPassword(auth, usernameToEmail(clean), password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  window.location.href = "login.html";
}

export async function getUserRole(uid) {
  const snap = await get(ref(db, `users/${uid}/role`));
  return snap.exists() ? snap.val() : "player";
}

export async function hasTeamSetup(uid) {
  const snap = await get(ref(db, `teams/${uid}`));
  return snap.exists();
}

export function requireAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    callback(user);
  });
}

export function redirectIfLoggedIn() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const role = await getUserRole(user.uid);
    // Honour ?redirect= param if present (e.g. login.html?redirect=team-setup.html)
    const redirectTo = new URLSearchParams(window.location.search).get("redirect");
    window.location.href =
      redirectTo || (role === "organizer" ? "organizer.html" : "schedule.html");
  });
}

export function requireOrganizer(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    const role = await getUserRole(user.uid);
    if (role !== "organizer") { window.location.href = "schedule.html"; return; }
    callback(user);
  });
}

export function requirePlayer(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    const role = await getUserRole(user.uid);
    if (role === "organizer") { window.location.href = "organizer.html"; return; }
    callback(user);
  });
}

export function getCurrentUser() {
  return auth.currentUser;
}

export { onAuthStateChanged, auth };
