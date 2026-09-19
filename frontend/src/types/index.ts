export type UserRole = "candidate" | "recruiter" | "brand" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  first_name: string;
  last_name: string;
}

export interface CandidateProfile {
  first_name: string;
  last_name: string;
  gender: string;
  birth_date: string;
  height: number; // always stored in cm
  weight: number; // always stored in kg
  preferred_units: "metric" | "imperial";
  phone_number: string;
  avatar_url?: string | null;
  chest?: number;
  shoulder?: number;
  left_arm?: number;
  right_arm?: number;
  abdomen?: number;
  waist?: number;
  hips?: number;
  left_thigh?: number;
  right_thigh?: number;
  age?: number;
  body_category?: string;
  // Recruitment workflow (all stored in localStorage)
  user_id?: string;
  email?: string;                        // copied from the authenticated account
  profile_confirmed_at?: string | null;  // set when the model saves the profile form
  measurements_confirmed_at?: string | null; // set only when the model confirms their body measurements
  updated_at?: string;
}

export interface Campaign {
  id: string;
  brand_id: string;
  brand_name: string;
  title: string;
  description: string;
  target_gender: string;
  min_height: number;
  max_height: number;
  target_size: string;
  required_measurements: string[];
  is_active: boolean;
  created_at: string;
  clothing_type?: string;
  custom_measurements?: {
    chest?: number;
    waist?: number;
    abdomen?: number;
    left_arm?: number;
    right_arm?: number;
    shoulder_width?: number;
    hip?: number;
    left_thigh?: number;
    right_thigh?: number;
  };
  // Extended campaign details (optional so existing campaigns keep working)
  image_url?: string | null;            // banner: data URL (uploaded) or https URL
  location?: string;
  campaign_date?: string;               // YYYY-MM-DD
  start_time?: string;                  // HH:MM
  end_time?: string;                    // HH:MM
  application_deadline?: string;        // YYYY-MM-DD
  models_required?: number;
  min_age?: number | null;
  max_age?: number | null;
  instructions?: string;
  compensation?: string;
  contact_info?: string;
}

export interface Garment {
  id: string;
  campaign_id?: string | null;
  brand_id: string;
  name: string;
  type: string;
  category: string;
  size: string;
  measurements: {
    chest: number;
    waist: number;
    hip: number;
    sleeve: number;
    shoulder: number;
    neck: number;
    length: number;
  };
  fit_type: "slim" | "regular" | "oversized";
  created_at: string;
}

export interface ImageValidationChecklist {
  blurry: boolean;
  dark: boolean;
  multiple_people: boolean;
  incorrect_posture: boolean;
  tilted_body: boolean;
  face_not_visible: boolean;
  body_not_fully_visible: boolean;
  lighting: "good" | "poor" | "acceptable";
}

export interface CandidateImages {
  id: string;
  user_id: string;
  front_image_url: string;
  back_image_url: string;
  left_image_url: string;
  right_image_url: string;
  validation_status: "pending" | "approved" | "rejected";
  validation_errors?: Partial<ImageValidationChecklist> | null;
  created_at: string;
}

export interface MeasurementDetail {
  val: number;
  conf: number; // 0.0 to 1.0
  uncertainty: number; // in cm
}

// Scanner-produced values are optional: the body scanner only reports what it
// actually measured, and anything it could not measure is left out rather
// than filled in from a proportion formula.
export interface Prediction {
  id: string;
  candidate_image_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  predicted_size: string;
  measurements: {
    height?: number;
    shoulder_width?: number;
    chest?: number;
    waist?: number;
    hip?: number;
    neck?: number;
    sleeve?: number; // arm_length
    forearm?: number;
    thigh?: number;
    calf?: number;
    inseam?: number;
    leg_length?: number;
    torso_length?: number;
    abdomen?: number;
    left_arm?: number;
    right_arm?: number;
    left_thigh?: number;
    right_thigh?: number;
  };
  confidence_scores: Record<string, MeasurementDetail>;
  error_message?: string | null;
  created_at: string;
  completed_at?: string;
  confidence_score?: number;
  recommended_size?: string;
  tailoring_recommendations?: string[];
  release?: boolean; // body scanner quality gate: measurements good enough to use
}

// ---------------------------------------------------------------------------
// Body scanner & virtual try-on API (backend/app.py, from shirt-new-app-1)
// ---------------------------------------------------------------------------

export type ScanView = "front" | "left" | "right" | "back";
export type ScanMode = "idle" | "aligning" | "countdown" | "rejected" | "view_captured" | "summary" | "error";

export interface ScanMeasurement {
  cm: number;
  in: number;
  confidence: number;
  confidence_pct: number;
  uncertainty_cm: number;
  sources?: string[];
  method?: string;
  notes?: string[];
}

export interface ScanCrossCheck {
  front_cm?: number;
  back_cm?: number;
  left_cm?: number;
  right_cm?: number;
  diff_pct?: number | null;
  consistent?: boolean;
}

export interface ScanScaleCheck {
  consistency?: number;
  stature_cm_by_view?: Record<string, number>;
}

export interface ScanRelease {
  release: boolean;
  overall_confidence: number;
  overall_confidence_pct: number;
  reasons: string[];
  recapture_views: string[];
}

export interface ScanSummary {
  body: Record<string, ScanMeasurement>;
  cross_checks: Record<string, ScanCrossCheck> & { scale?: ScanScaleCheck };
  release: ScanRelease;
  warnings: string[];
  ok: boolean;
}

export interface ScanViewEntry {
  image_url: string;
  raw_image_url?: string;
}

export interface ScannerStatus {
  mode: ScanMode;
  message: string;
  countdown_value: number | null;
  view: ScanView;
  view_order: ScanView[];
  views_data: Partial<Record<ScanView, ScanViewEntry>>;
  summary: ScanSummary | null;
  blocking_reasons: string[];
  last_rejection: { view: ScanView; reason: string; at: number } | null;
  model: { id: string; name: string; email: string } | null;
  device_model: string | null;
  vton_engine: { real_model_ready: boolean; status: string; device: string; openai_configured: boolean };
}

export interface StoredModelViews {
  front: ScanViewEntry;
  left: ScanViewEntry;
  right: ScanViewEntry;
  back: ScanViewEntry;
}

export interface StoredModel {
  model_id: string;
  name: string;
  email: string;
  height_cm: number | null;
  saved_at: number;
  views: StoredModelViews;
  release?: boolean;
  overall_confidence_pct?: number;
}

export interface StoredModelSession extends Omit<StoredModel, "release" | "overall_confidence_pct"> {
  summary: ScanSummary;
}

export interface TryOnResult {
  ok: boolean;
  tryon_image_url: string;
  inference_status: string;
  engine: string;
  device_info: string;
  inference_time_sec: number;
}

export interface Application {
  id: string;
  candidate_id: string;
  candidate_name: string;
  campaign_id: string;
  campaign_title: string;
  prediction_id: string;
  overall_fit_score: number; // 0 to 100
  fit_details: Record<string, "perfect" | "excellent" | "good" | "tight" | "loose" | "oversized">;
  status: "pending" | "shortlisted" | "rejected";
  recruiter_feedback?: string;
  created_at: string;
  updated_at: string;
  recommendation_status?: "Highly Recommended" | "Recommended" | "Review Manually" | "Reject";
  ai_explanation?: string;
  status_source?: "auto" | "recruiter";  // who set the current status
  rejected_at?: string | null;           // when the status became "rejected"
  rejection_notified_at?: string | null; // when the delayed rejection notice was issued
}

export interface AuditLog {
  id: string;
  user_id?: string;
  user_email?: string;
  action: string;
  details: any;
  ip_address: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  type?: "application_rejected" | "general";
  application_id?: string;
  campaign_id?: string;
  campaign_title?: string;
}

export type ModelAvailability = "available" | "unavailable" | "pending_confirmation" | "confirmed";
export type ContactStatus = "not_contacted" | "contacted" | "responded" | "booked" | "declined";

// A candidate a recruiter picked for a campaign ("Selected Models").
export interface SelectedModel {
  id: string;
  candidate_id: string;
  candidate_name: string;
  email: string;
  phone_number: string;
  campaign_id: string;
  campaign_title: string;
  application_id: string;
  overall_fit_score: number;
  measurements: Record<string, number>;
  front_image_url?: string | null; // backend capture path (scannerUrl) when the model has a stored scan
  selected_by: string;
  selected_at: string;
  availability: ModelAvailability;
  recruiter_notes: string;
  contact_status: ContactStatus;
  updated_at: string;
}
