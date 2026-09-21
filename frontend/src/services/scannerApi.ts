// Client for the body scanner & virtual try-on API in backend/app.py.
// The requests mirror shirt-new-app-1's static/script.js; the /api/models
// calls are the Fashion-Show addition that links a scan to a model profile.
import type { ScannerStatus, StoredModel, StoredModelSession, TryOnResult } from "../types";

// Empty (the default) = same origin: the Vite dev/preview server proxies the
// scanner paths to the backend (vite.config.ts), which is what lets one public
// share link serve both the UI and the API. Set VITE_SCANNER_API_URL to call a
// backend on another origin directly instead.
export const SCANNER_API_URL = (import.meta.env.VITE_SCANNER_API_URL ?? "").replace(/\/+$/, "");

export const scannerUrl = (path: string) => `${SCANNER_API_URL}${path}`;

export class ScannerApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UNREACHABLE =
  "Cannot connect to the Body Scanner server. Start it with 'python3 app.py' in the backend folder.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(scannerUrl(path), init);
  } catch {
    throw new ScannerApiError(UNREACHABLE, 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page) - handled below.
  }
  if (!res.ok || (data && data.error)) {
    throw new ScannerApiError((data && data.error) || `Server error (${res.status}).`, res.status);
  }
  return data as T;
}

const postJson = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const scannerApi = {
  videoFeedUrl: () => scannerUrl(`/video_feed?t=${Date.now()}`),

  // deviceModel is the exact camera/device name the candidate entered (e.g.
  // "MacBook Air M3"). The backend looks it up by exact match in
  // backend/calibration/camera_profile.json and REFUSES the request (with a
  // clear error) if that device has no saved calibration profile -- it
  // never substitutes a different device's numbers.
  start: (heightCm: number, deviceModel: string, model?: { id: string; name: string; email: string }) =>
    postJson<{ ok: boolean; device_model?: string }>("/start", {
      height_cm: heightCm,
      device_model: deviceModel,
      model_id: model?.id,
      model_name: model?.name,
      model_email: model?.email,
    }),

  status: () => request<ScannerStatus>("/status"),

  // Device names that already have a saved calibration profile, for the
  // scan-setup screen's suggestions. camera_profile.json is the single
  // source of truth -- this list (and /start's own validation) both read
  // straight from it, nothing about specific devices is hardcoded here.
  listCameraDevices: () => request<{ devices: string[] }>("/api/camera_devices").then((r) => r.devices),

  reset: () => postJson<{ ok: boolean }>("/reset"),

  retakeCurrent: () => postJson<{ ok: boolean; view: string }>("/retake_current"),

  stopCamera: () => postJson<{ ok: boolean }>("/stop_camera"),

  // One frame captured from the candidate's own browser camera
  // (services/browserCamera.ts), for backend/app.py's CAMERA_MODE=browser.
  // camera_loop() there consumes this in place of cv2.VideoCapture.read(),
  // which is what lets the scanner work when the Flask backend has no
  // physical camera attached (e.g. deployed on Render). Fire-and-forget by
  // design: the caller polls /status for the actual guidance/result, so a
  // single dropped frame upload is never worth surfacing as an error.
  pushFrame: (blob: Blob) => {
    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    return request<{ ok: boolean }>("/push_frame", { method: "POST", body: formData });
  },

  saveGroundTruth: (tape: Record<string, number>) =>
    postJson<{ ok: boolean; recorded: string[] }>("/ground_truth", { tape }),

  saveModelSession: () =>
    postJson<{ ok: boolean; model_id: string; saved_at: number }>("/api/models/save_session"),

  listModels: () => request<{ models: StoredModel[] }>("/api/models").then((r) => r.models),

  getModel: (modelId: string) =>
    request<StoredModelSession>(`/api/models/${encodeURIComponent(modelId)}`),

  virtualTryOn: (modelId: string, shirt: File) => {
    const formData = new FormData();
    formData.append("shirt_file", shirt);
    formData.append("model_id", modelId);
    return request<TryOnResult>("/api/virtual-try-on", { method: "POST", body: formData });
  },
};
