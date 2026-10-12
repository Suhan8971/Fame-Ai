import React, { createContext, useContext, useState, useEffect } from "react";
import type { User, CandidateProfile, UserRole } from "../types";
import {
  STORAGE_KEYS,
  getProfileRecord,
  saveProfileRecord,
  saveUserRecord,
} from "../services/localDb";
import { authApi } from "../services/authApi";

interface AuthContextType {
  user: User | null;
  profile: CandidateProfile | null;
  loading: boolean;
  login: (email: string, role: UserRole, password: string) => Promise<User>;
  logout: () => void;
  updateProfile: (profileData: Partial<CandidateProfile>) => Promise<CandidateProfile>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Starting values for a brand-new model's profile form -- blank except for
// the name/email already known from their account, so a new account never
// shows another model's (or a shared demo) height/weight/measurements. Real
// values only appear here once this specific user has saved their own
// (profile_confirmed_at) and confirmed their measurements
// (measurements_confirmed_at).
const defaultProfile = (user: User): CandidateProfile => ({
  first_name: user.first_name,
  last_name: user.last_name,
  gender: "",
  birth_date: "",
  height: null,
  weight: null,
  preferred_units: "metric",
  phone_number: "",
  chest: null,
  shoulder: null,
  left_arm: null,
  right_arm: null,
  abdomen: null,
  waist: null,
  hips: null,
  left_thigh: null,
  right_thigh: null,
  user_id: user.id,
  email: user.email,
  profile_confirmed_at: null,
  measurements_confirmed_at: null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Load auth state from localStorage on init. The session itself (which
  // user is signed in) is just cached here after the server already
  // verified the credentials at login time -- this doesn't re-check them.
  useEffect(() => {
    const storedUser = localStorage.getItem(STORAGE_KEYS.user);
    const storedProfile = localStorage.getItem(STORAGE_KEYS.profile);

    if (storedUser) {
      const parsedUser: User = JSON.parse(storedUser);
      setUser(parsedUser);
      // Prefer the per-user profile store, which the recruiter side also reads
      const record = parsedUser.role === "candidate" ? getProfileRecord(parsedUser.id) : null;
      if (record) setProfile(record);
      else if (storedProfile) setProfile(JSON.parse(storedProfile));
    } else if (storedProfile) {
      setProfile(JSON.parse(storedProfile));
    }
    setLoading(false);
  }, []);

  // Make the given candidate's profile the active one (or clear it for other roles).
  const activateProfile = (activeUser: User) => {
    if (activeUser.role !== "candidate") {
      setProfile(null);
      localStorage.removeItem(STORAGE_KEYS.profile);
      return;
    }
    const existing = getProfileRecord(activeUser.id);
    const next: CandidateProfile = existing
      ? { ...existing, email: activeUser.email, user_id: activeUser.id }
      : defaultProfile(activeUser);
    saveProfileRecord(activeUser.id, next);
    setProfile(next);
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(next));
  };

  // The only way to obtain a session: email/password/role must match an
  // account created via the Admin panel (backend/data/users.json). There is
  // no self-registration and no auto-create-on-first-login fallback -- an
  // unrecognized email or wrong password/role is rejected by the server.
  const login = async (email: string, role: UserRole, password: string): Promise<User> => {
    setLoading(true);
    try {
      const authedUser = await authApi.login(email, password, role);
      // Cache the now-authenticated user locally too -- other features
      // (e.g. recruiter/candidate lookups in api.ts) read this local
      // record by id/email; this does not affect who is allowed to log in.
      saveUserRecord(authedUser);
      setUser(authedUser);
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(authedUser));
      activateProfile(authedUser);
      return authedUser;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setProfile(null);
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem(STORAGE_KEYS.profile);
  };

  const updateProfile = async (profileData: Partial<CandidateProfile>): Promise<CandidateProfile> => {
    if (!user) throw new Error("No authenticated user");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const updatedProfile: CandidateProfile = {
      ...(profile || getProfileRecord(user.id) || defaultProfile(user)),
      ...profileData,
      user_id: user.id,
      email: user.email,
      updated_at: new Date().toISOString(),
    };

    saveProfileRecord(user.id, updatedProfile);
    setProfile(updatedProfile);
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(updatedProfile));

    return updatedProfile;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        login,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
