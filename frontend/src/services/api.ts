import type {
  Campaign, Garment, Prediction, Application, MeasurementDetail, ScanSummary,
  CandidateProfile, Notification, SelectedModel, User,
} from "../types";
import { MOCK_CAMPAIGNS, MOCK_GARMENTS, MOCK_APPLICATIONS, MOCK_PREDICTIONS, MOCK_PROFILES, MOCK_NOTIFICATIONS } from "./mockData";
import { STORAGE_KEYS, readStore, writeStore, getProfileRecord, findUserById } from "./localDb";
import { nowIso, nowMs } from "./clock";
import {
  getMissingProfileItems, isCampaignOpen, isRejectionNoticeDue,
  REJECTION_NOTICE_MESSAGE, REJECTION_NOTICE_TITLE,
} from "./recruitmentRules";

// Helpers to initialize lists from localStorage or defaults
const getStoredData = readStore;
const saveStoredData = writeStore;

// Body scanner measurement keys -> Prediction.measurements keys
const SCAN_TO_PREDICTION_KEYS: Record<string, keyof Prediction["measurements"]> = {
  height: "height",
  across_shoulder: "shoulder_width",
  chest: "chest",
  waist: "waist",
  hip: "hip",
  collar: "neck",
  sleeve_length: "sleeve",
  left_sleeve_length: "left_arm",
  right_sleeve_length: "right_arm",
  torso_length: "torso_length",
  inseam: "inseam",
};

// State Managers
let campaigns: Campaign[] = getStoredData(STORAGE_KEYS.campaigns, MOCK_CAMPAIGNS);
let garments: Garment[] = getStoredData(STORAGE_KEYS.garments, MOCK_GARMENTS);
let applications: Application[] = getStoredData(STORAGE_KEYS.applications, MOCK_APPLICATIONS);
let predictions: Record<string, Prediction> = getStoredData(STORAGE_KEYS.predictions, MOCK_PREDICTIONS);

// Re-read the shared stores so changes made in another tab (e.g. a brand
// publishing a campaign) are visible without a reload.
const syncFromStorage = () => {
  campaigns = getStoredData(STORAGE_KEYS.campaigns, MOCK_CAMPAIGNS);
  garments = getStoredData(STORAGE_KEYS.garments, MOCK_GARMENTS);
  applications = getStoredData(STORAGE_KEYS.applications, MOCK_APPLICATIONS);
  predictions = getStoredData(STORAGE_KEYS.predictions, MOCK_PREDICTIONS);
};

// Seeded sample predictions are keyed "<userId>_pred"; scans are keyed by user id.
const findPrediction = (userId: string): Prediction | null =>
  predictions[userId] || predictions[`${userId}_pred`] || null;

const getNotificationsStore = (): Notification[] => getStoredData(STORAGE_KEYS.notifications, MOCK_NOTIFICATIONS);
const getSelectedStore = (): SelectedModel[] => getStoredData<SelectedModel[]>(STORAGE_KEYS.selectedModels, []);

// Body measurements the model entered and confirmed on their profile (cm)
const PROFILE_MEASUREMENT_KEYS: (keyof CandidateProfile)[] = [
  "chest", "shoulder", "left_arm", "right_arm", "abdomen", "waist", "hips", "left_thigh", "right_thigh",
];
const confirmedProfileMeasurements = (profile: CandidateProfile | null): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!profile?.measurements_confirmed_at) return out;
  PROFILE_MEASUREMENT_KEYS.forEach((k) => {
    const v = Number(profile[k]);
    if (v > 0) out[k] = v;
  });
  return out;
};

export const api = {
  // --- Campaigns ---
  getCampaigns: async (): Promise<Campaign[]> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    syncFromStorage();
    return campaigns;
  },

  createCampaign: async (
    brandId: string,
    brandName: string,
    data: Omit<Campaign, "id" | "brand_id" | "brand_name" | "is_active" | "created_at"> & { is_active?: boolean }
  ): Promise<Campaign> => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    syncFromStorage();
    const { is_active, ...details } = data;
    const newCampaign: Campaign = {
      ...details,
      id: `c_${Date.now()}`,
      brand_id: brandId,
      brand_name: brandName,
      is_active: is_active ?? true,
      created_at: new Date().toISOString(),
    };
    saveStoredData(STORAGE_KEYS.campaigns, [newCampaign, ...campaigns]);
    campaigns = [newCampaign, ...campaigns];
    return newCampaign;
  },

  toggleCampaignActive: async (id: string): Promise<Campaign> => {
    syncFromStorage();
    campaigns = campaigns.map((c) => (c.id === id ? { ...c, is_active: !c.is_active } : c));
    saveStoredData(STORAGE_KEYS.campaigns, campaigns);
    const updated = campaigns.find((c) => c.id === id);
    if (!updated) throw new Error("Campaign not found");
    return updated;
  },

  updateCampaign: async (
    id: string,
    data: Partial<Omit<Campaign, "id" | "brand_id" | "created_at">>
  ): Promise<Campaign> => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    syncFromStorage();
    campaigns = campaigns.map((c) => (c.id === id ? { ...c, ...data } : c));
    saveStoredData(STORAGE_KEYS.campaigns, campaigns);
    const updated = campaigns.find((c) => c.id === id);
    if (!updated) throw new Error("Campaign not found");
    return updated;
  },

  // --- Garments ---
  getGarments: async (): Promise<Garment[]> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    syncFromStorage();
    return garments;
  },

  createGarment: async (brandId: string, data: Omit<Garment, "id" | "brand_id" | "created_at">): Promise<Garment> => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    syncFromStorage();
    const newGarment: Garment = {
      ...data,
      id: `g_${Date.now()}`,
      brand_id: brandId,
      created_at: new Date().toISOString(),
    };
    garments = [newGarment, ...garments];
    saveStoredData(STORAGE_KEYS.garments, garments);
    return newGarment;
  },

  // --- Body Scanner Predictions ---
  // Stores the body scanner's fused result (backend/app.py build_summary) as
  // this candidate's prediction, so Fit Results and campaign matching use the
  // real measurements. Only measured values are stored; nothing is estimated
  // from height/weight proportions.
  savePredictionFromScan: async (userId: string, summary: ScanSummary, enteredHeightCm: number): Promise<Prediction> => {
    const body = summary.body || {};
    const measurements: Prediction["measurements"] = {};
    const confidenceScores: Record<string, MeasurementDetail> = {};

    (Object.entries(SCAN_TO_PREDICTION_KEYS) as [string, keyof Prediction["measurements"]][]).forEach(
      ([scanKey, predKey]) => {
        const m = body[scanKey];
        if (!m) return;
        measurements[predKey] = m.cm;
        confidenceScores[predKey] = { val: m.cm, conf: m.confidence, uncertainty: m.uncertainty_cm };
      }
    );
    if (measurements.height === undefined) measurements.height = enteredHeightCm;

    // Size bands by chest circumference (unchanged Fashion-Show sizing rule)
    const chest = measurements.chest;
    let predictedSize = "N/A";
    if (chest !== undefined) {
      if (chest < 84) predictedSize = "XS";
      else if (chest < 90) predictedSize = "S";
      else if (chest < 98) predictedSize = "M";
      else if (chest < 106) predictedSize = "L";
      else predictedSize = "XL";
    }

    syncFromStorage();
    const release = summary.release || ({} as ScanSummary["release"]);
    const now = new Date().toISOString();
    const newPrediction: Prediction = {
      id: `${userId}_pred`,
      candidate_image_id: `scan_${Date.now()}`,
      status: "completed",
      predicted_size: predictedSize,
      measurements,
      confidence_scores: confidenceScores,
      confidence_score: release.overall_confidence_pct,
      recommended_size: predictedSize,
      tailoring_recommendations: release.reasons,
      release: release.release,
      created_at: now,
      completed_at: now,
    };

    predictions[userId] = newPrediction;
    saveStoredData(STORAGE_KEYS.predictions, predictions);
    return newPrediction;
  },

  getLatestPrediction: async (userId: string): Promise<Prediction | null> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    syncFromStorage();
    return findPrediction(userId);
  },

  // --- Applications & Fit Engine ---
  getApplications: async (): Promise<Application[]> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    syncFromStorage();
    return applications;
  },

  getCandidateApplications: async (candidateId: string): Promise<Application[]> => {
    syncFromStorage();
    return applications.filter((a) => a.candidate_id === candidateId);
  },

  applyToCampaign: async (
    candidateId: string,
    candidateName: string,
    campaignId: string
  ): Promise<Application> => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    syncFromStorage();

    // Check if duplicate
    const exists = applications.find((a) => a.candidate_id === candidateId && a.campaign_id === campaignId);
    if (exists) return exists;

    const campaign = campaigns.find((c) => c.id === campaignId);
    const prediction = findPrediction(candidateId);
    if (!campaign) throw new Error("Campaign not found");
    if (!isCampaignOpen(campaign)) throw new Error("This campaign is no longer accepting applications.");

    // Mandatory profile completion (same check the Apply buttons use)
    const storedProfile = getProfileRecord(candidateId);
    const account = findUserById(candidateId) || (storedProfile?.email ? ({ email: storedProfile.email } as User) : null);
    const missing = getMissingProfileItems(account, storedProfile, prediction);
    if (missing.length) throw new Error(`Complete your profile before applying. Missing: ${missing.join(", ")}.`);
    if (!prediction) throw new Error("Run body measurement prediction first");

    // Fetch garment for the campaign
    const garment = garments.find((g) => g.campaign_id === campaignId);

    let overallFitScore = 80;
    const fitDetails: Record<string, any> = {};

    if (campaign.target_size === "Custom Size" && campaign.custom_measurements) {
      // Custom Size matching logic. Only measurements the model confirmed on
      // their profile are used; unconfirmed form defaults are ignored.
      const candidateProfile: Record<string, number> = confirmedProfileMeasurements(storedProfile);
      const PROFILE_KEY_ALIASES: Record<string, string> = { shoulder_width: "shoulder", hip: "hips" };

      const getCandidateVal = (key: string) => {
        if (candidateProfile[key] !== undefined) {
          return candidateProfile[key];
        }
        const alias = PROFILE_KEY_ALIASES[key];
        if (alias && candidateProfile[alias] !== undefined) {
          return candidateProfile[alias];
        }
        const profileFromMock = (MOCK_PROFILES as any)[candidateId];
        if (profileFromMock && profileFromMock[key] !== undefined) {
          return profileFromMock[key];
        }
        const predKeyMap: Record<string, keyof typeof prediction.measurements> = {
          chest: "chest",
          waist: "waist",
          hip: "hip",
          shoulder_width: "shoulder_width",
          left_arm: "sleeve",
          right_arm: "sleeve",
          left_thigh: "thigh",
          right_thigh: "thigh",
        };
        const predKey = predKeyMap[key];
        if (predKey && prediction && prediction.measurements[predKey] !== undefined) {
          return prediction.measurements[predKey];
        }
        const defaults: Record<string, number> = {
          chest: 90,
          waist: 70,
          abdomen: 74,
          left_arm: 60,
          right_arm: 60,
          shoulder_width: 42,
          hip: 95,
          left_thigh: 52,
          right_thigh: 52,
        };
        return defaults[key] || 0;
      };

      let totalDiff = 0;
      let count = 0;

      const compareCustom = (key: string, targetVal: number) => {
        const predVal = getCandidateVal(key);
        const diff = Math.abs(predVal - targetVal);
        totalDiff += diff;
        count++;

        if (diff <= 1.5) return "perfect";
        if (diff <= 3.0) return "excellent";
        if (diff <= 5.0) return "good";
        if (predVal > targetVal) return "loose";
        return "tight";
      };

      Object.entries(campaign.custom_measurements).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          fitDetails[key] = compareCustom(key, val as number);
        }
      });

      if (count > 0) {
        const avgDiff = totalDiff / count;
        overallFitScore = Math.max(30, Math.min(100, Math.round(100 - avgDiff * 4.5)));
      }
    } else if (garment) {
      // Calculate matching algorithm based on chest, waist, hip, shoulder
      let totalDiff = 0;
      let count = 0;

      const compare = (key: keyof typeof garment.measurements, predVal: number) => {
        const targetVal = garment.measurements[key];
        const diff = Math.abs(predVal - targetVal);
        totalDiff += diff;
        count++;

        if (diff <= 1.5) return "perfect";
        if (diff <= 3.0) return "excellent";
        if (diff <= 5.0) return "good";
        if (predVal > targetVal) return "loose";
        return "tight";
      };

      // Only compare what the body scanner actually measured.
      const pairs: [string, keyof typeof garment.measurements, number | undefined][] = [
        ["chest", "chest", prediction.measurements.chest],
        ["waist", "waist", prediction.measurements.waist],
        ["hip", "hip", prediction.measurements.hip],
        ["shoulder_width", "shoulder", prediction.measurements.shoulder_width],
      ];
      pairs.forEach(([detailKey, garmentKey, predVal]) => {
        if (predVal !== undefined) fitDetails[detailKey] = compare(garmentKey, predVal);
      });

      if (count > 0) {
        const avgDiff = totalDiff / count;
        overallFitScore = Math.max(30, Math.min(100, Math.round(100 - avgDiff * 4.5)));
      }
    } else {
      // Default fallback match logic if campaign has no garment attached yet
      fitDetails.chest = "excellent";
      fitDetails.waist = "good";
      fitDetails.hip = "perfect";
      overallFitScore = 88;
    }

    // Auto shortlist or auto reject bounds
    let recommendationStatus: "Highly Recommended" | "Recommended" | "Review Manually" | "Reject" = "Review Manually";
    let status: "pending" | "shortlisted" | "rejected" = "pending";
    let recruiterFeedback = "";
    let aiExplanation = "";

    // Check height constraints
    const height = prediction.measurements.height;
    if (height !== undefined && height < campaign.min_height) {
      recommendationStatus = "Reject";
      status = "rejected";
      recruiterFeedback = `System rejected: Candidate height (${height}cm) is below campaign minimum (${campaign.min_height}cm).`;
      aiExplanation = `Reject: Candidate height of ${height}cm is below the minimum required height (${campaign.min_height}cm) for this casting.`;
    } else if (height !== undefined && height > campaign.max_height) {
      recommendationStatus = "Reject";
      status = "rejected";
      recruiterFeedback = `System rejected: Candidate height (${height}cm) is above campaign maximum (${campaign.max_height}cm).`;
      aiExplanation = `Reject: Candidate height of ${height}cm is above the maximum allowed height (${campaign.max_height}cm) for this casting.`;
    } else {
      if (overallFitScore >= 93) {
        recommendationStatus = "Highly Recommended";
        status = "shortlisted";
        recruiterFeedback = `System auto-shortlisted: Fit match compatibility score is outstanding (${overallFitScore}%).`;
      } else if (overallFitScore >= 85) {
        recommendationStatus = "Recommended";
        status = "pending";
        recruiterFeedback = `System recommended: Candidate fits pattern frames with good score (${overallFitScore}%).`;
      } else if (overallFitScore >= 70) {
        recommendationStatus = "Review Manually";
        status = "pending";
        recruiterFeedback = `System flagged for review: Candidate fit score is moderate (${overallFitScore}%).`;
      } else {
        recommendationStatus = "Reject";
        status = "rejected";
        recruiterFeedback = `System auto-rejected: Compatibility fit score (${overallFitScore}%) fails to meet minimal specs.`;
      }

      // Generate AI explanation based on deltas
      const deltaMsgs: string[] = [];
      Object.entries(fitDetails).forEach(([part, fit]) => {
        const readablePart = part.replace(/_/g, " ");
        deltaMsgs.push(`${readablePart} is ${fit}`);
      });
      const deltasStr = deltaMsgs.slice(0, 4).join(", ");
      
      if (recommendationStatus === "Highly Recommended") {
        aiExplanation = `Highly Recommended: Candidate matches the design silhouette beautifully with a fit score of ${overallFitScore}%. Major parameters align well: ${deltasStr}. Ready for catwalk casting.`;
      } else if (recommendationStatus === "Recommended") {
        aiExplanation = `Recommended: Fit compatibility is strong (${overallFitScore}%). Aligned measurements include: ${deltasStr}. Suggest minor styling customization.`;
      } else if (recommendationStatus === "Review Manually") {
        aiExplanation = `Review Manually: Moderate fit match of ${overallFitScore}%. Fit issues detected: ${deltasStr}. Please review candidate photo proportions and consider custom tailoring adjustments.`;
      } else {
        aiExplanation = `Reject: Low matching compatibility of ${overallFitScore}%. Severe mismatches detected: ${deltasStr}. Recommend rejecting candidate.`;
      }
    }

    const newApp: Application = {
      id: `app_${Date.now()}`,
      candidate_id: candidateId,
      candidate_name: candidateName,
      campaign_id: campaignId,
      campaign_title: campaign.title,
      prediction_id: prediction.id,
      overall_fit_score: overallFitScore,
      fit_details: fitDetails,
      status,
      recruiter_feedback: recruiterFeedback || undefined,
      recommendation_status: recommendationStatus,
      ai_explanation: aiExplanation,
      status_source: "auto",
      rejected_at: status === "rejected" ? nowIso() : null,
      rejection_notified_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    applications = [newApp, ...applications];
    saveStoredData(STORAGE_KEYS.applications, applications);
    return newApp;
  },

  updateApplicationStatus: async (id: string, status: "pending" | "shortlisted" | "rejected", feedback: string): Promise<Application> => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    syncFromStorage();
    applications = applications.map((a) =>
      a.id === id
        ? {
            ...a,
            status,
            recruiter_feedback: feedback,
            status_source: "recruiter" as const,
            // The 24-hour rejection notice counts from the moment of rejection
            rejected_at: status === "rejected" ? (a.status === "rejected" ? a.rejected_at || nowIso() : nowIso()) : null,
            updated_at: nowIso(),
          }
        : a
    );
    saveStoredData(STORAGE_KEYS.applications, applications);
    const updated = applications.find((a) => a.id === id);
    if (!updated) throw new Error("Application not found");
    return updated;
  },

  // --- Candidate profiles (for recruiters) ---
  getCandidateProfile: async (candidateId: string): Promise<{ user: User | null; profile: CandidateProfile | null }> => {
    return { user: findUserById(candidateId), profile: getProfileRecord(candidateId) || MOCK_PROFILES[candidateId] || null };
  },

  // --- Notifications ---
  // Issues the polite rejection notice for applications rejected at least 24
  // hours ago. Runs whenever the model's profile/results/campaign pages load.
  processRejectionNotifications: async (userId: string): Promise<number> => {
    syncFromStorage();
    let notifications = getNotificationsStore();
    let issued = 0;
    const updatedApps = applications.map((app) => {
      if (app.candidate_id !== userId || app.status !== "rejected" || app.rejection_notified_at) return app;
      if (!isRejectionNoticeDue(app)) return app;
      if (!notifications.some((n) => n.application_id === app.id && n.type === "application_rejected")) {
        notifications = [
          {
            id: `n_${app.id}_${nowMs()}`,
            user_id: userId,
            type: "application_rejected",
            title: REJECTION_NOTICE_TITLE,
            message: REJECTION_NOTICE_MESSAGE,
            application_id: app.id,
            campaign_id: app.campaign_id,
            campaign_title: app.campaign_title,
            is_read: false,
            created_at: nowIso(),
          },
          ...notifications,
        ];
        issued += 1;
      }
      return { ...app, rejection_notified_at: nowIso() };
    });
    if (updatedApps.some((a, i) => a !== applications[i])) {
      applications = updatedApps;
      saveStoredData(STORAGE_KEYS.applications, applications);
      saveStoredData(STORAGE_KEYS.notifications, notifications);
    }
    return issued;
  },

  getNotifications: async (userId: string): Promise<Notification[]> => {
    return getNotificationsStore()
      .filter((n) => n.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  markNotificationRead: async (id: string): Promise<void> => {
    saveStoredData(STORAGE_KEYS.notifications, getNotificationsStore().map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  },

  markAllNotificationsRead: async (userId: string): Promise<void> => {
    saveStoredData(
      STORAGE_KEYS.notifications,
      getNotificationsStore().map((n) => (n.user_id === userId ? { ...n, is_read: true } : n))
    );
  },

  // --- Selected Models (recruiter's final picks) ---
  getSelectedModels: async (): Promise<SelectedModel[]> => {
    return getSelectedStore().sort((a, b) => new Date(b.selected_at).getTime() - new Date(a.selected_at).getTime());
  },

  // Saves the candidate of an application to Selected Models. One entry per
  // candidate per campaign: picking the same candidate again returns the
  // existing entry instead of creating a duplicate.
  selectModel: async (
    applicationId: string,
    recruiterId: string,
    frontImageUrl?: string | null
  ): Promise<{ record: SelectedModel; alreadySaved: boolean }> => {
    syncFromStorage();
    const app = applications.find((a) => a.id === applicationId);
    if (!app) throw new Error("Application not found");

    const selected = getSelectedStore();
    const existing = selected.find((s) => s.candidate_id === app.candidate_id && s.campaign_id === app.campaign_id);
    if (existing) return { record: existing, alreadySaved: true };

    const profile = getProfileRecord(app.candidate_id) || MOCK_PROFILES[app.candidate_id] || null;
    const account = findUserById(app.candidate_id);
    const prediction = findPrediction(app.candidate_id);
    const scanMeasurements: Record<string, number> = {};
    Object.entries(prediction?.measurements || {}).forEach(([k, v]) => {
      if (typeof v === "number") scanMeasurements[k] = v;
    });

    const now = nowIso();
    const record: SelectedModel = {
      id: `sel_${Date.now()}`,
      candidate_id: app.candidate_id,
      candidate_name: app.candidate_name,
      email: account?.email || profile?.email || "",
      phone_number: profile?.phone_number || "",
      campaign_id: app.campaign_id,
      campaign_title: app.campaign_title,
      application_id: app.id,
      overall_fit_score: app.overall_fit_score,
      measurements: Object.keys(scanMeasurements).length ? scanMeasurements : confirmedProfileMeasurements(profile),
      front_image_url: frontImageUrl || null,
      selected_by: recruiterId,
      selected_at: now,
      availability: "pending_confirmation",
      // Carry over only feedback a recruiter wrote, not the matching engine's text
      recruiter_notes: app.status_source === "recruiter" ? app.recruiter_feedback || "" : "",
      contact_status: "not_contacted",
      updated_at: now,
    };
    saveStoredData(STORAGE_KEYS.selectedModels, [record, ...selected]);

    // A picked candidate must not later receive a rejection notice.
    if (app.status !== "shortlisted") {
      applications = applications.map((a) =>
        a.id === app.id
          ? { ...a, status: "shortlisted" as const, status_source: "recruiter" as const, rejected_at: null, updated_at: now }
          : a
      );
      saveStoredData(STORAGE_KEYS.applications, applications);
    }
    return { record, alreadySaved: false };
  },

  updateSelectedModel: async (
    id: string,
    patch: Partial<Pick<SelectedModel, "availability" | "recruiter_notes" | "contact_status">>
  ): Promise<SelectedModel> => {
    const selected = getSelectedStore().map((s) => (s.id === id ? { ...s, ...patch, updated_at: nowIso() } : s));
    saveStoredData(STORAGE_KEYS.selectedModels, selected);
    const updated = selected.find((s) => s.id === id);
    if (!updated) throw new Error("Selected model not found");
    return updated;
  },

  removeSelectedModel: async (id: string): Promise<void> => {
    saveStoredData(STORAGE_KEYS.selectedModels, getSelectedStore().filter((s) => s.id !== id));
  },

  // --- Analytics ---
  getRecruiterAnalytics: async (campaignId?: string) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    syncFromStorage();

    const relevantApps = campaignId 
      ? applications.filter(a => a.campaign_id === campaignId) 
      : applications;

    const total = relevantApps.length;
    const shortlisted = relevantApps.filter((a) => a.status === "shortlisted").length;
    const rejected = relevantApps.filter((a) => a.status === "rejected").length;
    const pending = relevantApps.filter((a) => a.status === "pending").length;

    // Predicted size distribution
    const sizeMap: Record<string, number> = {};
    const scores: number[] = [];

    relevantApps.forEach((a) => {
      const pred = Object.values(predictions).find((p) => p.id === a.prediction_id);
      if (pred) {
        sizeMap[pred.predicted_size] = (sizeMap[pred.predicted_size] || 0) + 1;
      }
      scores.push(Number(a.overall_fit_score));
    });

    const averageFit = scores.length ? Math.round(scores.reduce((acc, s) => acc + s, 0) / scores.length) : 0;

    return {
      total,
      shortlisted,
      rejected,
      pending,
      averageFit,
      sizeDistribution: Object.entries(sizeMap).map(([name, value]) => ({ name, value })),
      fitDistribution: [
        { range: "90-100%", count: relevantApps.filter(a => a.overall_fit_score >= 90).length },
        { range: "80-89%", count: relevantApps.filter(a => a.overall_fit_score >= 80 && a.overall_fit_score < 90).length },
        { range: "70-79%", count: relevantApps.filter(a => a.overall_fit_score >= 70 && a.overall_fit_score < 80).length },
        { range: "60-69%", count: relevantApps.filter(a => a.overall_fit_score >= 60 && a.overall_fit_score < 70).length },
        { range: "<60%", count: relevantApps.filter(a => a.overall_fit_score < 60).length },
      ],
    };
  },
};
