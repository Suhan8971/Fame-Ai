// localStorage "database" for this app. There is no server-side database
// for this part: every browser keeps its own copy of these stores. Login
// credentials themselves are the one exception -- those live server-side in
// backend/data/users.json (see services/authApi.ts) so access can actually
// be admin-gated across devices. STORAGE_KEYS.users below is just a local
// cache of already-authenticated users' public info (name/email/role), read
// by api.ts for candidate/recruiter lookups -- it is never consulted to
// decide whether a login is allowed.
import type { CandidateProfile, User } from "../types";
import { MOCK_PROFILES, MOCK_USERS } from "./mockData";

export const STORAGE_KEYS = {
  user: "aura_user",                         // signed-in user (existing)
  profile: "aura_profile",                   // signed-in candidate's profile (existing)
  users: "aura_db_users",                    // email -> user, local cache for lookups (not auth)
  profiles: "aura_db_profiles",              // user id -> candidate profile
  campaigns: "aura_db_campaigns",            // existing
  garments: "aura_db_garments",              // existing
  applications: "aura_db_applications",      // existing
  predictions: "aura_db_predictions",        // existing
  notifications: "aura_db_notifications",
  selectedModels: "aura_db_selected_models", // incl. availability, recruiter notes, contact status
} as const;

export const readStore = <T>(key: string, defaults: T): T => {
  const item = localStorage.getItem(key);
  if (!item) {
    localStorage.setItem(key, JSON.stringify(defaults));
    return defaults;
  }
  try {
    return JSON.parse(item) as T;
  } catch {
    return defaults;
  }
};

export const writeStore = <T>(key: string, data: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    if (err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22)) {
      throw new Error("Browser storage is full. Use a smaller image or clear old data.");
    }
    throw err;
  }
};

// --- Users: one stable id per email ------------------------------------------

const emailKey = (email: string) => email.trim().toLowerCase();

export const findUserByEmail = (email: string): User | null => {
  const users = readStore<Record<string, User>>(STORAGE_KEYS.users, {});
  return users[emailKey(email)] || MOCK_USERS.find((u) => emailKey(u.email) === emailKey(email)) || null;
};

export const findUserById = (id: string): User | null => {
  const users = readStore<Record<string, User>>(STORAGE_KEYS.users, {});
  return Object.values(users).find((u) => u.id === id) || MOCK_USERS.find((u) => u.id === id) || null;
};

export const saveUserRecord = (user: User): void => {
  const users = readStore<Record<string, User>>(STORAGE_KEYS.users, {});
  users[emailKey(user.email)] = user;
  writeStore(STORAGE_KEYS.users, users);
};

// --- Candidate profiles --------------------------------------------------------

export const getProfileRecord = (userId: string): CandidateProfile | null => {
  const profiles = readStore<Record<string, CandidateProfile>>(STORAGE_KEYS.profiles, {});
  return profiles[userId] || MOCK_PROFILES[userId] || null;
};

export const saveProfileRecord = (userId: string, profile: CandidateProfile): void => {
  const profiles = readStore<Record<string, CandidateProfile>>(STORAGE_KEYS.profiles, {});
  profiles[userId] = { ...profile, user_id: userId };
  writeStore(STORAGE_KEYS.profiles, profiles);
};
