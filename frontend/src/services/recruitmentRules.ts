// Rules shared by the model, brand and recruiter pages: what counts as a
// complete model profile, when a campaign is open, and what a model is
// allowed to see about their application status.
import type { Application, Campaign, CandidateProfile, ContactStatus, ModelAvailability, Prediction, User } from "../types";
import { REJECTION_NOTICE_DELAY_MS, nowMs } from "./clock";

export interface ProfileRequirement {
  key: string;
  label: string;
  done: boolean;
}

export const calculateAge = (birthDate?: string): number | null => {
  if (!birthDate) return null;
  const dob = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date(nowMs());
  let age = today.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
};

// Mandatory before a model may apply. Default values used to pre-fill the
// profile form never count: height/weight only count once the model has
// saved the profile, and body measurements only once they have explicitly
// confirmed them.
export const getProfileRequirements = (
  user: User | null,
  profile: CandidateProfile | null,
  prediction: Prediction | null
): ProfileRequirement[] => {
  const p = profile;
  const saved = !!p?.profile_confirmed_at;
  const age = calculateAge(p?.birth_date);
  return [
    { key: "name", label: "First and last name", done: !!(saved && p?.first_name?.trim() && p?.last_name?.trim()) },
    { key: "email", label: "Account email", done: !!user?.email },
    { key: "phone", label: "Phone number", done: !!(saved && (p?.phone_number || "").replace(/\D/g, "").length >= 7) },
    { key: "gender", label: "Gender", done: !!(saved && p?.gender) },
    { key: "birth_date", label: "Date of birth", done: !!(saved && age !== null && age >= 13 && age <= 100) },
    { key: "height_weight", label: "Height and weight", done: !!(saved && Number(p?.height) > 0 && Number(p?.weight) > 0) },
    { key: "measurements", label: "Confirmed body measurements", done: !!p?.measurements_confirmed_at },
    { key: "scan", label: "Completed 4-view body scan", done: prediction?.status === "completed" },
  ];
};

export const getMissingProfileItems = (
  user: User | null,
  profile: CandidateProfile | null,
  prediction: Prediction | null
): string[] => getProfileRequirements(user, profile, prediction).filter((r) => !r.done).map((r) => r.label);

// --- Campaigns ------------------------------------------------------------------

// A deadline (or, without one, the campaign date) is open until the end of that day.
export const isCampaignExpired = (c: Campaign): boolean => {
  const cutoff = c.application_deadline || c.campaign_date;
  if (!cutoff) return false;
  const end = new Date(`${cutoff}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end.getTime() < nowMs();
};

export const isCampaignOpen = (c: Campaign): boolean => c.is_active && !isCampaignExpired(c);

// --- Application status as the model sees it --------------------------------------

export type CandidateVisibleStatus = "shortlisted" | "under_review" | "not_shortlisted";

const rejectedAtMs = (app: Application): number => {
  const t = new Date(app.rejected_at || app.updated_at).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export const isRejectionNoticeDue = (app: Application): boolean =>
  app.status === "rejected" && nowMs() - rejectedAtMs(app) >= REJECTION_NOTICE_DELAY_MS;

// A rejection is only revealed to the model after the 24-hour notice period;
// until then the application simply shows as under review.
export const getCandidateVisibleStatus = (app: Application): CandidateVisibleStatus => {
  if (app.status === "shortlisted") return "shortlisted";
  if (app.status === "rejected" && isRejectionNoticeDue(app)) return "not_shortlisted";
  return "under_review";
};

export const REJECTION_NOTICE_TITLE = "Application Update";
export const REJECTION_NOTICE_MESSAGE =
  "Thank you for your interest in this campaign. After careful consideration, your application was not shortlisted for this opportunity. We appreciate your time and encourage you to explore other available opportunities.";

// --- Selected models ----------------------------------------------------------------

export const AVAILABILITY_LABELS: Record<ModelAvailability, string> = {
  available: "Available",
  unavailable: "Unavailable",
  pending_confirmation: "Pending Confirmation",
  confirmed: "Confirmed",
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  not_contacted: "Not Contacted",
  contacted: "Contacted",
  responded: "Responded",
  booked: "Booked",
  declined: "Declined",
};
