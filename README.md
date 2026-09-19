# AURA / Fashion-Show

React frontend (`frontend/`) + Python body scanner & virtual try-on API (`backend/`).
The measurement, 4-view capture and virtual try-on implementation in `backend/` is migrated from **shirt-new-app-1**.

## 1. Backend (body scanner + virtual try-on API)

```bash
cd backend
pip3 install -r requirements.txt
python3 app.py
```

- Runs on http://127.0.0.1:5050. Settings are in `backend/.env` (`OPENAI_API_KEY`, `SCANNER_PORT`, `CAMERA_INDEX`, `CORS_ORIGINS`).
- **Run it from Terminal (or iTerm/VS Code) that has Camera access**: macOS → System Settings → Privacy & Security → Camera. The webcam opens when a model starts a scan and closes when they leave the capture page.
- With `OPENAI_API_KEY` set, try-on uses OpenAI `gpt-image-2` (real clothing replacement, paid per image). Without it, the local pose-guided fallback is used.

## 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173, or 5174 if 5173 is busy).
Vite proxies the backend paths to `SCANNER_BACKEND_URL` (`frontend/.env`, default http://127.0.0.1:5050), so the UI and API share one origin.

## Share with a friend (free public link)

```bash
./share.sh
```

Run it from Terminal (with Camera access). It starts the backend, builds and serves the frontend, opens a free Cloudflare quick tunnel (no account; `cloudflared` is downloaded into `tools/` on first run) and prints a `https://….trycloudflare.com` link. Keep the window open while your friend tests; Ctrl+C stops everything. Logs go to `logs/`.

- Everything runs on your Mac: body scans use **your Mac's webcam**, and anyone with the link can start it and see the live feed. Try-ons from the link use your OpenAI key.
- The link is new every run. If it doesn't open on your own network (a DNS filter can block `trycloudflare.com`), test it on mobile data — your friend is unaffected.
- Your friend signs in with any email/password on the mock login and picks a role (Candidate = model, Recruiter).

## Flows

**Models (candidate role)** → *Audition Upload*: enter height → *Continue to Guided AI Camera* → the scanner guides and auto-captures **Front → Left → Right → Back** (live landmarks, measurement lines, blocking reasons, 3-2-1 countdown, Retake This View / Start Over) → measurement results (quality gate, ± ranges, confidence, cross-view checks, tape comparison). The session is saved to the model's profile for recruiters and to *Fit Results*.

**Recruiters** → *Recruiter Dashboard* → **Virtual Try-On Studio**: select a model → select their FRONT image → drag & drop (or click to choose) a shirt photo → before/after try-on result (Generate Again, Pick Another Shirt, Download). *Inspect Fit* shows a model's real captures when they have scanned.

## Recruitment workflow (demo, stored in localStorage)

Brand creates campaign → campaign appears to models → model completes profile → 4-view scan → applies → automatic fit score & Shortlisted / Pending / Rejected → recruiter reviews, runs virtual try-on, picks the model → Selected Models (phone, email, availability, notes, contact status).

- **Profile** (`/candidate/profile`): account email, contact & body details, a completion checklist, latest scan, applications with status and fit score, notifications. Pre-filled measurement defaults only count once the model ticks "I confirm these body measurements are my own".
- **Apply gate**: name, email, phone, gender, date of birth, height/weight (saved), confirmed measurements and a completed 4-view scan. Until then Apply is disabled and the missing items are listed.
- **Casting Calls** (`/candidate/campaigns`): active campaigns whose application deadline hasn't passed, with banner, location, date/time, requirements, target measurements, compensation, instructions and contact.
- **Campaign creation** (Brand → Campaigns): banner image, brand, location, date, start/end time, deadline, models required, gender, age & height range, target size, clothing type, required/custom measurements, instructions, compensation, contact, active status.
- **Recruiter pipeline**: All Applicants / Automatically Shortlisted / Pending Review / Rejected / Final Selected; the candidate view shows the full model profile, captures, scan, applied campaigns and a **Pick Model** button.
- **Selected Models** (`/recruiter/selected`): no duplicates per candidate + campaign; availability (Available, Unavailable, Pending Confirmation, Confirmed), contact status, notes, email/call links, remove.
- **Rejection notice**: a rejection is stored with `rejected_at`; the model keeps seeing "Under Review" until 24 hours later, when a polite "Application Update" notification is created (checked whenever the profile, results or casting-calls page loads). In `npm run dev` a "Simulate +24 hours" button lets you test this.

localStorage keys: `aura_user`, `aura_profile`, `aura_db_users`, `aura_db_profiles`, `aura_db_campaigns`, `aura_db_garments`, `aura_db_applications`, `aura_db_predictions`, `aura_db_notifications`, `aura_db_selected_models` (availability, notes and contact status live in each selected-model record).

localStorage is per browser: brand, model and recruiter must use the same browser (the role switcher in the navbar) to see each other's data. Scan images are the exception — they're stored by the backend.

## Backend layout

| File | Role |
| --- | --- |
| `app.py` | Flask API, camera loop / 4-view state machine, live guidance, try-on endpoint |
| `measurements.py`, `side_measurements.py`, `measurement_pipeline.py`, `body_segmentation.py`, `capture_validation.py`, `anatomy.py`, `scale_reference.py`, `multiview.py`, `circumference.py`, `measurement_confidence.py`, `calibration_profile.py`, `camera_calibration.py`, `draw_overlay.py`, `shirt_outline_detector.py` | Measurement pipeline (unchanged from shirt-new-app-1) — see `MEASUREMENT_PIPELINE.md` |
| `vton_engine.py`, `openai_vton_engine.py`, `virtual_tryon.py`, `inference_worker.py`, `catvton/` | Virtual try-on engines (unchanged from shirt-new-app-1) |
| `model_store.py` | Fashion-Show addition: saves each model's finished scan under `static/models/<model_id>/` for recruiters |
| `validation.py`, `make_marker.py`, `tests_*.py` | Accuracy validation, printable scale marker, tests (`python3 tests_pipeline.py` etc.) |

`.env` files contain your API key — don't commit or share them.
