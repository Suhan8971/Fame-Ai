// Browser-side camera capture for the guided body scanner. This is what
// lets the scanner work when the Flask backend has no physical camera of
// its own (e.g. deployed on Render): the CANDIDATE'S OWN browser opens
// their camera (getUserMedia), and captured frames are POSTed to
// backend/app.py's /push_frame, which camera_loop() consumes in place of
// cv2.VideoCapture.read(). Everything downstream of "here is one frame"
// (MediaPipe, live guidance, the quality gate, measurement, overlays) is
// unchanged and unaware of where the frame came from.

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export type CameraErrorKind = "permission_denied" | "not_found" | "in_use" | "unsupported" | "insecure_context" | "unknown";

export class CameraAccessError extends Error {
  kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export const isCameraSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === "function";

// getUserMedia only works on HTTPS or localhost. On a plain-HTTP page
// (other than localhost) the API is simply absent, which isCameraSupported()
// already reports as unsupported -- this just gives that specific, more
// actionable message instead of the generic one.
export const isSecureContext = (): boolean =>
  typeof window === "undefined" || window.isSecureContext !== false;

function classifyError(err: unknown): CameraAccessError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CameraAccessError(
      "permission_denied",
      "Camera access was denied. Allow camera permission for this site (check your browser's address-bar/site settings), then retry."
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new CameraAccessError(
      "not_found",
      "No camera was found on this device. Connect a camera, or try a different device."
    );
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new CameraAccessError(
      "in_use",
      "The camera could not be started -- it may already be in use by another app or browser tab. Close it and retry."
    );
  }
  return new CameraAccessError(
    "unknown",
    err instanceof Error ? err.message : "Could not access the camera."
  );
}

/** Video input devices, for a camera picker when more than one is available. */
export async function listCameraDevices(): Promise<CameraDevice[]> {
  if (!isCameraSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * Opens the camera and returns its MediaStream. Prefers the rear/"environment"
 * camera when no specific device is requested -- on a phone that's usually
 * the higher-quality sensor and the natural choice for "prop the phone up
 * and step back"; on a laptop there normally isn't one, so the browser just
 * falls back to whatever camera exists (this is a soft `ideal` constraint,
 * never a hard requirement).
 */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (!isSecureContext()) {
    throw new CameraAccessError(
      "insecure_context",
      "Camera access needs a secure connection (HTTPS). Open this page over https:// (or localhost while developing)."
    );
  }
  if (!isCameraSupported()) {
    throw new CameraAccessError(
      "unsupported",
      "This browser does not support camera access. Use a recent version of Chrome, Safari, Edge or Firefox."
    );
  }

  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    if (deviceId) {
      // The requested device may have disappeared since it was listed
      // (unplugged, permission narrowed, etc.) -- fall back to any camera
      // before giving up, rather than failing on a now-stale device id.
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (err2) {
        throw classifyError(err2);
      }
    }
    throw classifyError(err);
  }
}

export function stopCameraStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Draws the current video frame onto an off-screen canvas and returns it as
 * a JPEG Blob (null if the video has no dimensions yet, e.g. still loading).
 *
 * Not mirrored: the backend flips the frame itself (exactly as it always
 * flipped the physical webcam feed in camera_loop()), so a mirrored PREVIEW
 * on screen is purely a CSS transform on the <video> element and never
 * touches these pixels -- capture and preview are independent.
 */
export function captureFrame(video: HTMLVideoElement, quality = 0.85): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}
