import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { calculateAge, getMissingProfileItems, isCampaignOpen } from "../../services/recruitmentRules";
import { ProfileRequirementNotice } from "../../components/candidate/ProfileRequirementNotice";
import { CandidateStatusBadge } from "../../components/candidate/CandidateStatusBadge";
import { NotificationsPanel } from "../../components/common/NotificationsPanel";
import type { Application, Campaign, Prediction } from "../../types";
import {
  AlertCircle, ArrowUpRight, Calendar, Check, Clock, DollarSign, Megaphone, MapPin, Ruler, Users, X,
} from "lucide-react";

const formatDate = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

const formatTime = (t?: string) => {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
};

const formatTimeRange = (start?: string, end?: string) => {
  if (start && end) return `${formatTime(start)} – ${formatTime(end)}`;
  return formatTime(start) || formatTime(end);
};

export const CampaignBoard: React.FC = () => {
  const { user, profile } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<{ id: string; message: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [camps, apps, pred] = await Promise.all([
        api.getCampaigns(),
        api.getCandidateApplications(user.id),
        api.getLatestPrediction(user.id),
      ]);
      setCampaigns(camps);
      setApplications(apps);
      setPrediction(pred);
    } catch (err) {
      console.error("Load campaigns error: ", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const missing = getMissingProfileItems(user, profile, prediction);
  const canApply = missing.length === 0;

  const handleApply = async (campaignId: string) => {
    if (!user || !canApply) return;
    setApplyingId(campaignId);
    setApplyError(null);
    try {
      await api.applyToCampaign(user.id, `${profile?.first_name || user.first_name} ${profile?.last_name || user.last_name}`.trim(), campaignId);
      setApplications(await api.getCandidateApplications(user.id));
    } catch (err) {
      setApplyError({ id: campaignId, message: err instanceof Error ? err.message : "Could not apply." });
    } finally {
      setApplyingId(null);
    }
  };

  if (!user) return null;

  const openCampaigns = campaigns.filter(isCampaignOpen);
  const age = calculateAge(profile?.birth_date);
  const heightCm = prediction?.measurements.height ?? (profile?.profile_confirmed_at ? profile.height : undefined);

  // Requirement checks against the model's own data (informational only; the
  // matching engine makes the actual recommendation).
  const requirementChecks = (c: Campaign) => {
    const checks: { label: string; ok: boolean | null }[] = [];
    checks.push({
      label: `Gender: ${c.target_gender}`,
      ok: c.target_gender === "unisex" || !profile?.profile_confirmed_at ? null : profile.gender === c.target_gender,
    });
    checks.push({
      label: `Height: ${c.min_height}–${c.max_height} cm`,
      ok: heightCm === undefined ? null : heightCm >= c.min_height && heightCm <= c.max_height,
    });
    if (c.min_age || c.max_age) {
      const range = `${c.min_age ?? "any"}–${c.max_age ?? "any"}`;
      checks.push({
        label: `Age: ${range}`,
        ok: age === null ? null : (!c.min_age || age >= c.min_age) && (!c.max_age || age <= c.max_age),
      });
    }
    return checks;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Megaphone className="w-7 h-7 text-brand-purple" />
            Casting Calls
          </h1>
          <p className="text-sm text-slate-400 mt-1">Open campaigns from brands. Apply once your profile and body scan are complete.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <ProfileRequirementNotice missing={missing} />

          {loading ? (
            <div className="flex items-center justify-center min-h-[30vh]">
              <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
            </div>
          ) : openCampaigns.length === 0 ? (
            <div className="text-center py-16 glass-card rounded-3xl border border-dashed border-white/10 p-8">
              <Megaphone className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">No open casting calls right now</h3>
              <p className="text-xs text-slate-400">New campaigns appear here as soon as a brand publishes them.</p>
            </div>
          ) : (
            openCampaigns.map((c) => {
              const app = applications.find((a) => a.campaign_id === c.id);
              const checks = requirementChecks(c);
              const customEntries = Object.entries(c.custom_measurements || {}).filter(([, v]) => v !== undefined && v !== null);
              return (
                <div key={c.id} className="glass-card rounded-3xl border border-white/5 overflow-hidden shadow-xl">
                  {c.image_url ? (
                    <img src={c.image_url} alt="" className="w-full h-48 object-cover bg-slate-950" />
                  ) : (
                    <div className="w-full h-24 bg-gradient-to-r from-brand-purple/20 via-brand-pink/10 to-brand-cyan/10" />
                  )}
                  <div className="p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold text-brand-purple uppercase tracking-widest">{c.brand_name}</span>
                        <h2 className="text-xl font-bold text-white leading-tight mt-0.5">{c.title}</h2>
                      </div>
                      {app ? (
                        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
                          <CandidateStatusBadge app={app} />
                          <span className="text-[10px] text-slate-400">Fit score: <strong className="text-slate-200">{app.overall_fit_score}%</strong></span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleApply(c.id)}
                          disabled={!canApply || applyingId === c.id}
                          title={canApply ? "Apply to this campaign" : `Complete your profile first: ${missing.join(", ")}`}
                          className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold bg-white text-slate-950 rounded-xl transition-all hover:bg-slate-200 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {applyingId === c.id ? (
                            <div className="w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              Apply <ArrowUpRight className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {applyError?.id === c.id && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        <span>{applyError.message}</span>
                      </div>
                    )}

                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{c.description}</p>

                    {(c.application_deadline || c.campaign_date || c.start_time || c.end_time) && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {c.application_deadline && (
                          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                            <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                              <Clock className="w-3 h-3 text-brand-pink" /> Application Deadline
                            </span>
                            <span className="text-[12px] font-semibold text-slate-200">{formatDate(c.application_deadline)}</span>
                          </div>
                        )}
                        {(c.start_time || c.end_time) && (
                          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                            <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                              <Clock className="w-3 h-3 text-brand-purple" /> Time
                            </span>
                            <span className="text-[12px] font-semibold text-slate-200">{formatTimeRange(c.start_time, c.end_time)}</span>
                          </div>
                        )}
                        {c.campaign_date && (
                          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                            <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                              <Calendar className="w-3 h-3 text-brand-purple" /> Campaign Date
                            </span>
                            <span className="text-[12px] font-semibold text-slate-200">{formatDate(c.campaign_date)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                      {c.location && (
                        <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-brand-purple" /> {c.location}</span>
                      )}
                      {c.models_required ? (
                        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-brand-purple" /> {c.models_required} model{c.models_required > 1 ? "s" : ""} needed</span>
                      ) : null}
                      {c.compensation && (
                        <span className="flex items-center gap-1.5 sm:col-span-2"><DollarSign className="w-3.5 h-3.5 text-green-400" /> {c.compensation}</span>
                      )}
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 space-y-3">
                      <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Requirements</span>
                      <div className="flex flex-wrap gap-1.5">
                        {checks.map((chk) => (
                          <span
                            key={chk.label}
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border capitalize ${
                              chk.ok === null
                                ? "bg-slate-900 text-slate-300 border-white/5"
                                : chk.ok
                                ? "bg-green-500/10 text-green-300 border-green-500/20"
                                : "bg-red-500/10 text-red-300 border-red-500/20"
                            }`}
                          >
                            {chk.ok === true && <Check className="w-3 h-3" />}
                            {chk.ok === false && <X className="w-3 h-3" />}
                            {chk.label}
                          </span>
                        ))}
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-900 text-slate-300 border border-white/5">
                          Size: {c.target_size}
                        </span>
                        {c.clothing_type && (
                          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-900 text-slate-300 border border-white/5">{c.clothing_type}</span>
                        )}
                      </div>
                      {c.required_measurements.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <Ruler className="w-3.5 h-3.5 text-slate-500" />
                          {c.required_measurements.map((m) => (
                            <span key={m} className="text-[9px] px-2 py-0.5 rounded-lg bg-slate-950 text-slate-400 border border-white/5 capitalize">
                              {m.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      {customEntries.length > 0 && (
                        <div>
                          <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Target Measurements</span>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                            {customEntries.map(([name, val]) => (
                              <div key={name} className="flex justify-between border-b border-white/[0.03] pb-0.5">
                                <span className="capitalize">{name.replace(/_/g, " ")}</span>
                                <span className="font-semibold text-slate-200">{val} cm</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {(c.instructions || c.contact_info) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                        {c.instructions && (
                          <div className="p-3 rounded-xl bg-slate-900/30 border border-white/5">
                            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Instructions</span>
                            <p className="text-slate-300 whitespace-pre-line">{c.instructions}</p>
                          </div>
                        )}
                        {c.contact_info && (
                          <div className="p-3 rounded-xl bg-slate-900/30 border border-white/5">
                            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Contact</span>
                            <p className="text-slate-300 whitespace-pre-line">{c.contact_info}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-6">
          <NotificationsPanel userId={user.id} onChange={loadData} />
        </div>
      </div>
    </div>
  );
};
