import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { scannerApi, scannerUrl } from "../../services/scannerApi";
import {
  openCamera, stopCameraStream, captureFrame,
  listCameraDevices as listBrowserCameras, type CameraDevice,
} from "../../services/browserCamera";
import { MeasurementResults } from "../../components/scanner/MeasurementResults";
import type { ScannerStatus, ScanSummary, ScanView, ScanViewEntry } from "../../types";
import {
  X, Check, AlertCircle, AlertTriangle, RefreshCw,
  Camera, BookOpen, RotateCcw, ArrowRight, CheckCircle2, Video
} from "lucide-react";

// How often a captured frame is pushed to POST /push_frame while
// CAMERA_MODE=browser. Deliberately well below the ~20-30fps the physical
// webcam path reads at: the live guidance (skeleton, HUD, countdown) only
// needs to feel responsive, not look like a full-motion video, and every
// pushed frame is a real network upload -- see ALIGN_HOLD_SECONDS in
// backend/app.py for why the hold-still timer no longer assumes any
// particular frame rate.
const FRAME_PUSH_INTERVAL_MS = 130;

// Capture sequence and live guidance come from the body scanner backend
// (backend/app.py, migrated from shirt-new-app-1). This page only renders its
// state: the annotated camera stream, the current message, what is blocking a
// capture, and the fused result once all four views are in.
const VIEW_ORDER: ScanView[] = ["front", "left", "right", "back"];

const VIEW_HINTS: Record<ScanView, string> = {
  front: "Face the camera directly. Step back so your entire body — head to feet — is visible (~2m/6.5ft), arms relaxed at your sides.",
  left: "Turn 90° so your LEFT side faces the camera. Step back so your entire body, head to feet, is visible.",
  right: "Turn 90° so your RIGHT side faces the camera. Step back so your entire body, head to feet, is visible.",
  back: "Turn all the way around — back facing the camera. Step back so your entire body, head to feet, is visible.",
};

const SPOKEN_VIEW_HINTS: Record<ScanView, string> = {
  front: "Front view. Face the camera directly, stand on your marked spot, and keep your whole body in frame.",
  left: "Left view. Turn 90 degrees so your left side faces the camera. Stay on the same spot.",
  right: "Right view. Turn 90 degrees so your right side faces the camera. Stay on the same spot.",
  back: "Back view. Turn all the way around so your back faces the camera. Stay on the same spot.",
};

const spokenCorrection = (message: string) => {
  const text = message.trim();
  if (/head.{0,30}cut off|top of your head.{0,30}cut off/i.test(text)) {
    return "Your head is cut off. Please move slightly farther back.";
  }
  if (/feet.{0,30}cut off/i.test(text)) {
    return "Your feet are cut off. Please move farther back.";
  }
  if (/too far from the camera|too far away|step closer|move closer/i.test(text)) {
    return "Please move closer to the camera.";
  }
  if (/too close|step back|move farther away/i.test(text)) {
    return "Please move farther away from the camera.";
  }
  if (/move to the cent(?:re|er)|move in toward the centre/i.test(text)) {
    return "Please move toward the center of the camera frame.";
  }
  if (/move to your left|move to your right/i.test(text)) {
    return `${text.replace(/\.$/, "")}.`;
  }
  if (/shoulder|stand up straight|torso.{0,20}lean|straighten/i.test(text)) {
    return "Please level your shoulders and stand straight.";
  }
  if (/relax your arms|arms.{0,20}clear/i.test(text)) {
    return "Please relax your arms down by your sides.";
  }
  if (/no person detected|step into the frame/i.test(text)) {
    return "No person is visible. Please step into the camera frame.";
  }
  return text;
};

const POLL_INTERVAL_MS = 400;
// /status failures tolerated before the "cannot connect" card is shown; the
// original UI kept polling silently, which hid a stopped server entirely.
const MAX_POLL_FAILURES = 5;

const WEBCAM_ERROR =
  "Could not open the webcam. Make sure no other app is using it and that the terminal running the backend has Camera access (macOS: System Settings → Privacy & Security → Camera), then retry.";

type Phase = "setup" | "camera" | "results";

export const ImageUpload: React.FC = () => {
  const { user, profile, updateProfile } = useAuth();
  const navigate = useNavigate();

  // Pre-capture states
  const [phase, setPhase] = useState<Phase>("setup");
  const [heightVal, setHeightVal] = useState(profile?.height || 175);
  const [weightVal, setWeightVal] = useState(profile?.weight || 65);
  const [ageVal, setAgeVal] = useState<number | "">("");
  const [bodyCategory, setBodyCategory] = useState("Hourglass");
  const [clothingType, setClothingType] = useState<"T-shirts/Shirts" | "Bottoms/Pants">("T-shirts/Shirts");
  const [deviceModel, setDeviceModel] = useState("");
  const [knownDevices, setKnownDevices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Live scanner state (mirrors GET /status)
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  // Result
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [viewsData, setViewsData] = useState<Partial<Record<ScanView, ScanViewEntry>>>({});
  const [profileSave, setProfileSave] = useState<{ ok: boolean; text: string } | null>(null);

  // Browser-side camera (CAMERA_MODE=browser, i.e. the backend has no
  // physical camera of its own -- see backend/app.py). The visible preview
  // stays exactly what it always was: the backend's own annotated
  // /video_feed MJPEG stream (skeleton, guidance HUD, countdown baked in
  // server-side). This <video> is only a hidden frame SOURCE for capture.
  const [browserCameras, setBrowserCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushingRef = useRef(false);
  const browserCameraStartedRef = useRef(false);

  const pollFailures = useRef(0);
  const finished = useRef(false);
  const lastGuidanceView = useRef<ScanView | null>(null);
  const lastSpokenGuidance = useRef("");
  const pendingGuidance = useRef("");
  const guidanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenAt = useRef(0);

  const speak = useCallback((text: string, signature: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    if (guidanceTimer.current !== null) {
      clearTimeout(guidanceTimer.current);
      guidanceTimer.current = null;
    }
    pendingGuidance.current = "";
    if (signature === lastSpokenGuidance.current && Date.now() - lastSpokenAt.current < 12000) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
    lastSpokenGuidance.current = signature;
    lastSpokenAt.current = Date.now();
  }, []);

  const announceStatus = useCallback((data: ScannerStatus) => {
    if (data.view !== lastGuidanceView.current) {
      lastGuidanceView.current = data.view;
      speak(SPOKEN_VIEW_HINTS[data.view], `view:${data.view}`);
      return;
    }

    const reasons = data.blocking_reasons?.length
      ? data.blocking_reasons
      : data.mode === "aligning" && data.message && data.message !== "Hold still..."
      ? [data.message]
      : [];
    if (!reasons.length) {
      pendingGuidance.current = "";
      lastSpokenGuidance.current = "";
      if (guidanceTimer.current !== null) {
        clearTimeout(guidanceTimer.current);
        guidanceTimer.current = null;
      }
      return;
    }

    const signature = `${data.view}:${reasons.join("|")}`;
    if (signature === lastSpokenGuidance.current || signature === pendingGuidance.current) return;
    pendingGuidance.current = signature;
    if (guidanceTimer.current !== null) clearTimeout(guidanceTimer.current);
    guidanceTimer.current = setTimeout(() => {
      if (Date.now() - lastSpokenAt.current < 1600) {
        guidanceTimer.current = setTimeout(() => {
          speak(reasons.map(spokenCorrection).join(" "), signature);
        }, 1600 - (Date.now() - lastSpokenAt.current));
        return;
      }
      speak(reasons.map(spokenCorrection).join(" "), signature);
    }, 700);
  }, [speak]);

  useEffect(() => () => {
    if (guidanceTimer.current !== null) clearTimeout(guidanceTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // Pre-fill fields if profile loaded
  useEffect(() => {
    if (profile) {
      if (profile.height) setHeightVal(profile.height);
      if (profile.weight) setWeightVal(profile.weight);
    }
  }, [profile]);

  // Device names that already have a saved calibration profile, offered as
  // suggestions only -- the backend (the source of truth) is what actually
  // rejects an unsupported device when the form is submitted.
  useEffect(() => {
    scannerApi.listCameraDevices().then(setKnownDevices).catch(() => {});
  }, []);

  // Stops the BROWSER's own camera stream (releases the camera light) and
  // the frame-push loop. Independent of scannerApi.stopCamera(), which only
  // tells the backend to stop its processing thread -- in CAMERA_MODE=browser
  // the backend never held the physical device to begin with, so the browser
  // must release it itself.
  const stopBrowserCamera = useCallback(() => {
    if (pushTimerRef.current !== null) {
      clearInterval(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    stopCameraStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    browserCameraStartedRef.current = false;
  }, []);

  const startBrowserCamera = useCallback(async (deviceId?: string) => {
    stopBrowserCamera();
    try {
      const stream = await openCamera(deviceId);
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      browserCameraStartedRef.current = true;
      setCameraError(null);

      pushTimerRef.current = setInterval(async () => {
        if (pushingRef.current) return; // don't stack uploads if one is slow
        const video = videoRef.current;
        if (!video) return;
        pushingRef.current = true;
        try {
          const blob = await captureFrame(video);
          if (blob) await scannerApi.pushFrame(blob);
        } catch {
          // A single dropped/failed frame upload is not worth surfacing --
          // /status polling is what actually reports a dead feed
          // (mode: "error") if uploads stop working altogether.
        } finally {
          pushingRef.current = false;
        }
      }, FRAME_PUSH_INTERVAL_MS);

      listBrowserCameras().then(setBrowserCameras).catch(() => {});
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Could not access the camera.");
    }
  }, [stopBrowserCamera]);

  // Release the webcam whenever this page is left, including closing the tab.
  useEffect(() => {
    const onPageHide = () => {
      navigator.sendBeacon?.(scannerUrl("/stop_camera"));
      stopCameraStream(mediaStreamRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      scannerApi.stopCamera().catch(() => {});
      stopBrowserCamera();
    };
  }, [stopBrowserCamera]);

  // Start the browser's own camera once we know the backend actually needs
  // it (CAMERA_MODE=browser -- i.e. it has no physical camera of its own,
  // as on a Render deployment). CAMERA_MODE=local (a developer's laptop
  // running the Flask server against its own webcam) never triggers this;
  // /video_feed alone is enough there, exactly as it always was.
  useEffect(() => {
    if (phase !== "camera") {
      if (browserCameraStartedRef.current) stopBrowserCamera();
      return;
    }
    if (status?.camera_mode === "browser" && !browserCameraStartedRef.current) {
      startBrowserCamera();
    }
  }, [phase, status?.camera_mode, startBrowserCamera, stopBrowserCamera]);

  const modelIdentity = useCallback(
    () =>
      user
        ? { id: user.id, name: `${user.first_name} ${user.last_name}`.trim(), email: user.email }
        : undefined,
    [user]
  );

  const finishScan = useCallback(
    async (s: ScannerStatus) => {
      if (finished.current || !s.summary) return;
      finished.current = true;
      setSummary(s.summary);
      setViewsData(s.views_data);
      setPhase("results");
      scannerApi.stopCamera().catch(() => {});

      if (!user) return;
      // Fit Results / campaign matching read the prediction store; recruiters
      // read the backend's stored session.
      await api.savePredictionFromScan(user.id, s.summary, heightVal);
      try {
        await scannerApi.saveModelSession();
        setProfileSave({ ok: true, text: "Saved to your candidate profile. Recruiter try-on access requires a campaign application and shortlist." });
      } catch (e) {
        setProfileSave({
          ok: false,
          text: `Captures were not saved to your model profile: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
    },
    [user, heightVal]
  );

  // Poll the scanner while the camera panel is shown (script.js pollStatus).
  useEffect(() => {
    if (phase !== "camera") return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      // The server holds its state lock while it measures a captured view,
      // so /status can stall for seconds; don't stack requests behind it.
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await scannerApi.status();
        if (cancelled) return;
        const recovered = pollFailures.current >= MAX_POLL_FAILURES;
        pollFailures.current = 0;
        setStatus(data);
        announceStatus(data);
        if (data.mode === "error") {
          // The backend now says WHY (no physical webcam vs. lost the
          // browser's feed vs. never got a first frame) -- show that
          // instead of a message that assumed a server-side camera.
          setCameraError(data.message || WEBCAM_ERROR);
        } else if (recovered) {
          // Server is reachable again: drop the error and reopen the stream.
          setCameraError(null);
          setVideoSrc(scannerApi.videoFeedUrl());
        }
        if (data.mode === "summary" && data.summary) {
          finishScan(data);
        }
      } catch (e) {
        if (cancelled) return;
        pollFailures.current = Math.min(pollFailures.current + 1, MAX_POLL_FAILURES);
        if (pollFailures.current >= MAX_POLL_FAILURES) {
          setCameraError(e instanceof Error ? e.message : "Could not reach the server.");
        }
      } finally {
        inFlight = false;
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, finishScan, announceStatus]);

  const beginSession = async () => {
    speak(SPOKEN_VIEW_HINTS.front, "view:front");
    await scannerApi.start(heightVal, deviceModel.trim(), modelIdentity());
    finished.current = false;
    pollFailures.current = 0;
    setStatus(null);
    setSummary(null);
    setViewsData({});
    setProfileSave(null);
    setCameraError(null);
    setVideoSrc(scannerApi.videoFeedUrl());
    setPhase("camera");
  };

  const handleDemographicsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!heightVal || heightVal < 100 || heightVal > 230) {
      setSetupError("Please enter a realistic height in cm (100–230).");
      return;
    }
    if (!deviceModel.trim()) {
      setSetupError("Please enter the camera device you're using to capture these photos.");
      return;
    }
    setLoading(true);
    setSetupError(null);

    try {
      // Save height and weight to candidate profile
      await updateProfile({
        height: heightVal,
        weight: weightVal,
        age: ageVal ? Number(ageVal) : undefined,
        body_category: bodyCategory,
      });
      await beginSession();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setActionBusy(true);
    try {
      // Two independent things can have failed here: the backend session
      // (mode: "error"/unreachable /status) or, in CAMERA_MODE=browser, the
      // browser's OWN camera (permission denied, device busy, etc.) -- retry
      // whichever is actually down rather than always restarting the whole
      // session, which would otherwise needlessly re-prompt for camera
      // permission even when the backend was the only thing that dropped.
      if (status?.camera_mode === "browser" && !mediaStreamRef.current) {
        await startBrowserCamera(selectedCameraId || undefined);
      } else {
        await beginSession();
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setActionBusy(false);
    }
  };

  // "Retake This View" (script.js retakeLiveBtn)
  const handleRetakeCurrent = async () => {
    setActionBusy(true);
    try {
      await scannerApi.retakeCurrent();
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setActionBusy(false);
    }
  };

  // "Start Over" on the camera panel (script.js cancelBtn): back to setup.
  const handleCancel = async () => {
    setActionBusy(true);
    try {
      await scannerApi.reset();
      await scannerApi.stopCamera();
    } catch {
      // The server may already be gone; returning to setup is still correct.
    }
    setVideoSrc("");
    setStatus(null);
    setCameraError(null);
    setPhase("setup");
    setActionBusy(false);
  };

  // "Start Over" on the result panel (script.js retakeAllBtn): straight back to the camera.
  const handleRetakeAll = async () => {
    setActionBusy(true);
    try {
      await scannerApi.reset();
      finished.current = false;
      pollFailures.current = 0;
      setStatus(null);
      setSummary(null);
      setViewsData({});
      setProfileSave(null);
      setCameraError(null);
      setVideoSrc(scannerApi.videoFeedUrl());
      setPhase("camera");
    } catch (err) {
      setProfileSave({ ok: false, text: err instanceof Error ? err.message : "Could not reach the server." });
    } finally {
      setActionBusy(false);
    }
  };

  const mode = status?.mode;
  const currentView: ScanView = status?.view || "front";
  const liveViews = status?.views_data || {};
  const blockingReasons = status?.blocking_reasons || [];
  const capturedCount = VIEW_ORDER.filter((v) => liveViews[v]).length;

  const trackerColor =
    mode === "rejected" || blockingReasons.length > 0
      ? "red"
      : mode === "countdown" || mode === "aligning" || mode === "view_captured"
      ? "green"
      : "yellow";

  const modeLabel: Record<string, string> = {
    idle: "Waiting",
    aligning: blockingReasons.length ? "Adjust position" : "Aligned",
    rejected: "Photo not taken",
    view_captured: "Captured",
    summary: "Complete",
    error: "Camera error",
  };

  return (
    <div className="max-w-5xl mx-auto py-4">
      {phase === "setup" ? (
        // Pre-Capture demographic inputs & guidelines step
        <div className="glass-card max-w-2xl mx-auto p-8 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/10 rounded-full blur-3xl pointer-events-none" />

          <div className="mb-6 border-b border-white/5 pb-4">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-brand-purple" />
              AI-Assisted Scan Setup
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Provide your anthropometric profile metrics to calibrate the 3D landmark tracking engines.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleDemographicsSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Height (cm) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  required
                  min={100}
                  max={230}
                  value={heightVal}
                  onChange={(e) => setHeightVal(Number(e.target.value))}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="e.g. 175"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Weight (kg) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  required
                  min={30}
                  max={180}
                  value={weightVal}
                  onChange={(e) => setWeightVal(Number(e.target.value))}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="e.g. 65"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Age (Optional)</label>
                <input
                  type="number"
                  min={16}
                  max={90}
                  value={ageVal}
                  onChange={(e) => setAgeVal(e.target.value === "" ? "" : Number(e.target.value))}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="e.g. 24"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Anatomy Framing Silhouette</label>
                <select
                  value={bodyCategory}
                  onChange={(e) => setBodyCategory(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs cursor-pointer select-none"
                >
                  <option value="Hourglass" className="bg-slate-950">Hourglass Frame</option>
                  <option value="Athletic" className="bg-slate-950">Athletic Frame</option>
                  <option value="Rectangular" className="bg-slate-950">Rectangular Frame</option>
                  <option value="Inverted Triangle" className="bg-slate-950">Inverted Triangle</option>
                  <option value="Pear" className="bg-slate-950">Pear Frame</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1">Garment Casting Audition Category</label>
                <select
                  value={clothingType}
                  onChange={(e) => setClothingType(e.target.value as any)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs cursor-pointer select-none"
                >
                  <option value="T-shirts/Shirts" className="bg-slate-950">Shirts & Tops (Upper Body Silhouette)</option>
                  <option value="Bottoms/Pants" className="bg-slate-950">Pants & Bottoms (Lower Body Silhouette)</option>
                </select>
              </div>
            </div>

            {/* Instruction Bulletins (the scanner's capture standard) */}
            <div className="p-4 bg-slate-900/50 rounded-2xl border border-white/5 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">Standard Capture Instructions</h3>
              <ul className="text-[11px] text-slate-400 space-y-1.5 list-disc list-inside">
                <li>Mark your standing spot on the floor and use the same spot for all four views.</li>
                <li>Put the camera at chest height, level, 2.5–3.5 m away, and don't change the zoom between views.</li>
                <li>Your whole body — top of head to the floor under your feet — must stay inside the frame.</li>
                <li>Hold your arms about 15–20 cm clear of your sides and stand up straight.</li>
                <li>Wear fitted clothing, take your shoes off, and use a bright, evenly lit room.</li>
              </ul>
            </div>

            {/* Camera/device model -- picks which saved calibration profile
                (backend/calibration/camera_profile.json) this session uses.
                The backend is the source of truth: it rejects any device
                name that has no saved profile rather than falling back to a
                default or another device's numbers. */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Which device are you using to capture your photos? <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                list="camera-device-options"
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                placeholder="e.g., MacBook Air M5, MacBook Air M3, iPhone 16 Plus"
              />
              <datalist id="camera-device-options">
                {knownDevices.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>

              <div className="mt-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-[11px] leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Important:</strong> Please enter the correct laptop or phone model. Entering
                  an incorrect device model may cause the wrong camera calibration parameters to be
                  used, which can affect the accuracy of your measured body values and may impact your
                  application process.
                </span>
              </div>
            </div>

            {setupError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{setupError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-purple to-brand-pink hover:opacity-90 transition-all cursor-pointer shadow-lg disabled:opacity-60"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Continue to Guided AI Camera <Camera className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      ) : phase === "results" && summary ? (
        // Measurement result (script.js showResult)
        <div className="glass-card p-8 rounded-3xl border border-white/5 relative shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-brand-purple" />
                Multi-View Scan Complete
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Front, Left, Right and Back views fused into one body model.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRetakeAll}
                disabled={actionBusy}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900/50 border border-white/5 hover:border-brand-purple/40 text-xs font-semibold text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Start Over
              </button>
              <button
                type="button"
                onClick={() => navigate("/candidate/results")}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-brand-purple to-brand-pink text-xs font-bold text-white rounded-xl hover:opacity-90 transition-all cursor-pointer shadow-lg"
              >
                Continue to Fit Results <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {profileSave && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                profileSave.ok
                  ? "bg-green-500/10 border-green-500/20 text-green-200"
                  : "bg-yellow-500/10 border-yellow-500/20 text-yellow-200"
              }`}
            >
              {profileSave.ok ? (
                <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              )}
              <span>{profileSave.text}</span>
            </div>
          )}

          <MeasurementResults summary={summary} viewsData={viewsData} />
        </div>
      ) : (
        // Live Guided AI Camera capture page
        <div className="glass-card p-4 sm:p-8 rounded-3xl border border-white/5 relative shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <Camera className="w-6 h-6 text-brand-purple" />
                Guided Multi-View Image Extraction
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Front, Left, Right and Back views are detected and captured automatically. Hold the position until the countdown finishes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Only shown when the browser actually reports more than one
                  camera (CAMERA_MODE=browser) -- e.g. a laptop with both a
                  built-in and an external webcam, or a phone's front/back
                  pair not already resolved by the environment-facing default. */}
              {status?.camera_mode === "browser" && browserCameras.length > 1 && (
                <div className="flex items-center gap-1.5 px-2 bg-slate-900/50 border border-white/5 rounded-xl">
                  <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={selectedCameraId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedCameraId(id);
                      startBrowserCamera(id || undefined);
                    }}
                    className="bg-transparent text-xs font-semibold text-slate-300 py-2 pr-1 cursor-pointer focus:outline-none"
                    title="Switch camera"
                  >
                    <option value="" className="bg-slate-950">Default camera</option>
                    {browserCameras.map((d) => (
                      <option key={d.deviceId} value={d.deviceId} className="bg-slate-950">
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={handleRetakeCurrent}
                disabled={actionBusy || !!cameraError}
                className="flex items-center gap-1.5 p-2 px-3 bg-slate-900/50 border border-white/5 hover:border-brand-purple/40 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Retake This View
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={actionBusy}
                className="flex items-center gap-1.5 p-2 px-3 bg-slate-900/50 border border-white/5 hover:border-red-500/40 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Start Over
              </button>
            </div>
          </div>

          {/* View Steps Indicators (script.js renderProgressSteps) */}
          <div className="grid grid-cols-4 gap-2">
            {(status?.view_order || VIEW_ORDER).map((v) => {
              const completed = !!liveViews[v];
              const active = !completed && currentView === v;

              return (
                <div
                  key={v}
                  className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                    active
                      ? "bg-brand-purple/10 border-brand-purple/40 text-white"
                      : completed
                      ? "bg-slate-900/40 border-green-500/20 text-slate-300"
                      : "bg-slate-950/20 border-white/5 text-slate-500"
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider">{v} View</span>
                  {completed ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-bold border border-green-500/20">
                      CAPTURED
                    </span>
                  ) : active ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand-purple/20 text-brand-purple font-bold border border-brand-purple/30 animate-pulse">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-600 font-semibold">PENDING</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Guided camera preview */}
            <div className="lg:col-span-2 space-y-4">
              {/* The stream keeps its native aspect ratio: the scanner draws its
                  guidance (landmarks, measurement lines, READY / blocking HUD,
                  countdown) across the whole frame, so cropping would hide it. */}
              <div className="relative w-full rounded-3xl bg-slate-950 border border-white/5 overflow-hidden flex items-center justify-center shadow-inner min-h-[260px]">
                {/* Hidden frame SOURCE only (CAMERA_MODE=browser) -- never
                    shown directly. The visible preview stays the backend's
                    own annotated /video_feed <img> below, which already has
                    the skeleton/HUD/countdown baked in server-side; this
                    <video> just feeds captureFrame() -> POST /push_frame. */}
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="hidden"
                  aria-hidden="true"
                />
                {cameraError ? (
                  <div className="p-8 text-center max-w-sm space-y-3">
                    <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-1" />
                    <p className="text-xs text-slate-300 font-semibold leading-relaxed">{cameraError}</p>
                    <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={actionBusy}
                        className="px-4 py-2 bg-brand-purple hover:bg-brand-purple/90 text-xs text-slate-950 rounded-lg font-bold transition-all cursor-pointer disabled:opacity-50"
                      >
                        Retry Connecting
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-10 h-10 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
                    </div>
                    {videoSrc && (
                      <img
                        src={videoSrc}
                        alt="AI Body Scanner Stream"
                        className="relative w-full h-auto block"
                        onError={() => {
                          pollFailures.current = MAX_POLL_FAILURES;
                          setCameraError(
                            "Cannot connect to the Body Scanner server. Start it with 'python3 app.py' in the backend folder."
                          );
                        }}
                      />
                    )}

                    {/* Captured -> next view pause (VIEW_CAPTURED_PAUSE_SECONDS on the server) */}
                    {mode === "view_captured" && (
                      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
                        <RefreshCw className="w-12 h-12 text-brand-purple animate-spin mb-4" />
                        <h3 className="text-sm font-bold text-white mb-2">{status?.message}</h3>
                        <p className="text-xs text-slate-400">Get ready for the next view…</p>
                      </div>
                    )}

                    {/* Display current view instructions indicator */}
                    <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg bg-slate-950/80 backdrop-blur-md text-[10px] uppercase font-bold text-brand-purple tracking-widest border border-white/5 z-10">
                      Current Pose: <span className="text-white">{currentView} View</span>
                    </div>
                  </>
                )}
              </div>

              {/* Pose Tracking HUD (script.js statusBadge) */}
              {!cameraError && (
                <div className="p-4 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-white/5 flex items-center justify-between gap-4 shadow-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-3.5 h-3.5 shrink-0 rounded-full ${
                      trackerColor === "green"
                        ? "bg-green-500 shadow-lg shadow-green-500/50"
                        : trackerColor === "yellow"
                        ? "bg-yellow-500 shadow-lg shadow-yellow-500/50"
                        : "bg-red-500 shadow-lg shadow-red-500/50"
                    }`} />
                    <div className="min-w-0">
                      <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">
                        Pose Tracker
                      </span>
                      <span className="text-[11px] text-slate-200 font-semibold mt-0.5 block">
                        {status?.message || "Waiting..."}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {mode === "countdown" && status?.countdown_value != null ? (
                      <span className="text-xl font-black text-brand-pink text-glow animate-ping pr-2">
                        {status.countdown_value}s
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-slate-400">
                        {mode ? modeLabel[mode] || "" : "Connecting…"}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!cameraError && (
                <p className="text-xs text-slate-400 leading-relaxed">{VIEW_HINTS[currentView]}</p>
              )}

              {/* Everything currently preventing a capture (script.js renderBlockers) */}
              {!cameraError && mode === "rejected" && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                  <h4 className="font-bold flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 text-red-400" /> Photo not taken
                  </h4>
                </div>
              )}
              {!cameraError && mode !== "rejected" && blockingReasons.length > 0 && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                  <h4 className="font-bold flex items-center gap-1 mb-1.5">
                    <AlertCircle className="w-4 h-4 text-red-400" /> Fix this before the photo can be taken
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {blockingReasons.slice(0, 4).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!cameraError && blockingReasons.length === 0 && (mode === "countdown" || mode === "aligning") && (
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-200 text-xs">
                  <h4 className="font-bold flex items-center gap-1">
                    <Check className="w-4 h-4 text-green-400" /> Position looks good — hold still
                  </h4>
                </div>
              )}
            </div>

            {/* Captures Previews list */}
            <div className="glass-card p-4 rounded-2xl border border-white/5 flex flex-col justify-between">
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-white/5 pb-2">
                  Captured Snapshots
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  {VIEW_ORDER.map((v) => {
                    const entry = liveViews[v];

                    return (
                      <div
                        key={v}
                        className={`relative aspect-[3/4] rounded-xl overflow-hidden border transition-all ${
                          !entry && currentView === v
                            ? "border-brand-purple bg-slate-950/40"
                            : entry
                            ? "border-green-500/25 bg-slate-900/30"
                            : "border-white/5 bg-slate-950/20"
                        }`}
                      >
                        {entry ? (
                          <img src={scannerUrl(entry.image_url)} alt={v} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-center p-1 opacity-40">
                            <Camera className="w-4 h-4 text-slate-500 mb-1" />
                            <span className="text-[9px] font-bold capitalize text-slate-500">{v}</span>
                          </div>
                        )}
                        <div className="absolute bottom-1 left-1.5 text-[8px] uppercase font-black tracking-widest text-slate-400 bg-slate-950/80 px-1 rounded">
                          {v}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Capture progress */}
              <div className="border-t border-white/5 pt-4 mt-6 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>Views captured</span>
                  <span className="text-slate-200">{capturedCount} / 4</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-purple to-brand-pink transition-all duration-500"
                    style={{ width: `${(capturedCount / 4) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Measurements are computed automatically once all four views are captured.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
