// Client for the login-credentials API in backend/app.py (backed by
// backend/data/users.json via auth_store.py). Reuses the same backend origin
// as scannerApi.ts (VITE_SCANNER_API_URL) since it's the same Flask server --
// see scannerApi.ts's comment for why that env var exists.
import type { User, UserRole } from "../types";
import { scannerUrl, ScannerApiError } from "./scannerApi";

export interface StoredCredential {
  id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  created_at: string;
}

const UNREACHABLE =
  "Cannot reach the login server. Make sure the backend is running (see backend/app.py).";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(scannerUrl(path), {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ScannerApiError(UNREACHABLE, 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body -- handled below.
  }
  if (!res.ok || (data && data.error)) {
    throw new ScannerApiError((data && data.error) || `Server error (${res.status}).`, res.status);
  }
  return data as T;
}

export const authApi = {
  // The only way to obtain a session -- must match an account already
  // created via the Admin panel. No self-registration, no auto-create.
  login: (email: string, password: string, role: UserRole) =>
    request<{ ok: boolean; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, role }),
    }).then((r) => r.user),

  listUsers: () => request<{ users: StoredCredential[] }>("/api/auth/users").then((r) => r.users),

  createUser: (role: UserRole, firstName: string, lastName: string, email: string, password: string) =>
    request<{ ok: boolean; user: StoredCredential }>("/api/auth/users", {
      method: "POST",
      body: JSON.stringify({ role, first_name: firstName, last_name: lastName, email, password }),
    }).then((r) => r.user),

  // password is optional -- omit/empty to leave the account's current password unchanged.
  updateUser: (id: string, role: UserRole, firstName: string, lastName: string, email: string, password?: string) =>
    request<{ ok: boolean; user: StoredCredential }>(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ role, first_name: firstName, last_name: lastName, email, password: password || undefined }),
    }).then((r) => r.user),
};
