import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { Prediction, Campaign, Application } from "../../types";
import { getCandidateVisibleStatus, getMissingProfileItems, isCampaignOpen } from "../../services/recruitmentRules";
import { CandidateStatusBadge } from "../../components/candidate/CandidateStatusBadge";
import { ProfileRequirementNotice } from "../../components/candidate/ProfileRequirementNotice";
import { NotificationsPanel } from "../../components/common/NotificationsPanel";
import { Layers, Ruler, ArrowUpRight, AlertCircle } from "lucide-react";

export const Results: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [unitSystem, setUnitSystem] = useState<"cm" | "in">("cm");
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const pred = await api.getLatestPrediction(user.id);
      setPrediction(pred);
      const camp = await api.getCampaigns();
      setCampaigns(camp);
      const apps = await api.getApplications();
      setApplications(apps.filter((a) => a.candidate_id === user.id));
    } catch (err) {
      console.error("Load results error: ", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (campaignId: string) => {
    if (!user) return;
    setApplyingId(campaignId);
    setApplyError(null);
    try {
      await api.applyToCampaign(user.id, `${profile?.first_name || user.first_name} ${profile?.last_name || user.last_name}`.trim(), campaignId);
      // Reload applications
      const apps = await api.getApplications();
      setApplications(apps.filter((a) => a.candidate_id === user.id));
    } catch (err) {
      console.error("Apply campaign error: ", err);
      setApplyError(err instanceof Error ? err.message : "Could not apply to this campaign.");
    } finally {
      setApplyingId(null);
    }
  };

  // Convert measurement to appropriate string
  const formatVal = (valCm: number) => {
    if (unitSystem === "cm") {
      return `${Math.round(valCm * 10) / 10} cm`;
    }
    const inches = valCm / 2.54;
    return `${Math.round(inches * 10) / 10} in`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="max-w-md mx-auto text-center py-12 glass-card p-8 rounded-3xl border border-white/5 shadow-xl">
        <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-4 animate-bounce" />
        <h2 className="text-xl font-bold text-white mb-2">No Body Profile Extracted</h2>
        <p className="text-sm text-slate-400 mb-6">
          You haven't run the 3D body reconstruction scan yet. Upload 4 photos in form-fitting wear.
        </p>
        <button
          onClick={() => navigate("/candidate/upload")}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-semibold text-xs hover:opacity-90 transition-all cursor-pointer shadow-md"
        >
          Begin Audition Upload
        </button>
      </div>
    );
  }

  const getGarmentSpecs = (size: string) => {
    const specs: Record<string, { length: number; chest: number; shoulder: number; sleeveLength: number; sleeveOpen: number }> = {
      "XS": { length: 25, chest: 36, shoulder: 15.5, sleeveLength: 7.5, sleeveOpen: 4.5 },
      "S": { length: 26, chest: 38, shoulder: 16.2, sleeveLength: 7.8, sleeveOpen: 4.8 },
      "M": { length: 27, chest: 40, shoulder: 16.8, sleeveLength: 8.2, sleeveOpen: 5.2 },
      "L": { length: 28, chest: 42, shoulder: 17.5, sleeveLength: 8.5, sleeveOpen: 5.5 },
      "XL": { length: 29, chest: 45, shoulder: 18.2, sleeveLength: 8.8, sleeveOpen: 5.8 },
    };
    return specs[size.toUpperCase()] || specs["M"];
  };

  const garmentSpecs = getGarmentSpecs(prediction.predicted_size);
  const hasFittedSize = ["XS", "S", "M", "L", "XL"].includes(prediction.predicted_size.toUpperCase());

  return (
    <div className="space-y-8">
      {/* Overview Block */}
      <div className="glass-card p-8 rounded-3xl border border-white/5 relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
        <div className="absolute top-0 right-0 w-48 h-48 bg-brand-purple/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div>
          <div className="flex items-center gap-2 mb-2">
            {prediction.release === false ? (
              <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-xs font-semibold tracking-wider">
                Scan Status: Not Accurate Enough — Retake Recommended
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-semibold tracking-wider">
                Scan Status: Fully Calibrated
              </span>
            )}
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">AI Body Dimensions</h1>
          <p className="text-slate-400 text-sm mt-1 leading-relaxed">
            Fused from your Front, Left, Right and Back body scan captures. Fitted size category is estimated below.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Fit Size Card */}
          <div className="p-4 bg-slate-900 border border-white/5 rounded-2xl text-center shadow-inner min-w-[100px]">
            <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-widest">
              Fitted Size
            </span>
            <span className="text-3xl font-extrabold text-brand-purple text-glow">
              {prediction.predicted_size}
            </span>
          </div>

          {/* Unit Toggle */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setUnitSystem("cm")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                unitSystem === "cm" ? "bg-brand-purple text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Metric
            </button>
            <button
              onClick={() => setUnitSystem("in")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                unitSystem === "in" ? "bg-brand-purple text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Imperial
            </button>
          </div>
        </div>
      </div>

      {/* Grid: 3D Measurements table & Applied campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left column taking up 2/3: Anatomy Table & Garment specs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Anatomical Table */}
          <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
              <Ruler className="w-5 h-5 text-brand-purple" />
              Predicted Anatomy Measurements
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5">Segment Name</th>
                    <th className="py-2.5">Predicted Value</th>
                    <th className="py-2.5 text-center">Confidence</th>
                    <th className="py-2.5 text-right">Uncertainty Bound</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm text-slate-300">
                  {Object.entries(prediction.measurements)
                    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
                    .map(([name, val]) => {
                    const capitalized = name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                    const confDetail = prediction.confidence_scores[name] || { conf: 0.94, uncertainty: 0.5 };
                    const confPct = Math.round(confDetail.conf * 100);

                    return (
                      <tr key={name} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 font-medium text-slate-200">{capitalized}</td>
                        <td className="py-3 font-semibold text-brand-purple">{formatVal(val)}</td>
                        <td className="py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`text-xs font-semibold ${
                              confPct >= 95 ? "text-green-400" : "text-yellow-400"
                            }`}>
                              {confPct}%
                            </span>
                            <div className="w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden hidden sm:block">
                              <div 
                                className={`h-full rounded-full ${confPct >= 95 ? "bg-green-400" : "bg-yellow-400"}`} 
                                style={{ width: `${confPct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right text-xs text-slate-500 font-medium">
                          &plusmn;{unitSystem === "cm" ? `${confDetail.uncertainty} cm` : `${Math.round(confDetail.uncertainty / 2.54 * 10) / 10} in`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Garment Fit Flat Specifications */}
          {hasFittedSize && (
          <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
              <Layers className="w-5 h-5 text-brand-pink" />
              Predicted T-Shirt Flat Specifications (Size: {prediction.predicted_size})
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Estimated flat garment dimensions calibrated for a standard polo/T-shirt pattern based on your body profile.
            </p>
            
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
              {[
                { label: "Length", inVal: garmentSpecs.length, desc: "Collar to hem" },
                { label: "Chest Width", inVal: garmentSpecs.chest, desc: "Armpit-to-armpit × 2" },
                { label: "Shoulder", inVal: garmentSpecs.shoulder, desc: "Seam to seam" },
                { label: "Sleeve Length", inVal: garmentSpecs.sleeveLength, desc: "Shoulder seam to hem" },
                { label: "Sleeve Open", inVal: garmentSpecs.sleeveOpen, desc: "Sleeve opening diameter" },
              ].map((spec) => {
                const displayVal = unitSystem === "in" 
                  ? `${spec.inVal} in` 
                  : `${Math.round(spec.inVal * 2.54 * 10) / 10} cm`;
                return (
                  <div key={spec.label} className="p-3 bg-slate-900/60 border border-white/5 rounded-2xl text-center">
                    <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wide truncate">
                      {spec.label}
                    </span>
                    <span className="text-lg font-black text-brand-pink block mt-1">
                      {displayVal}
                    </span>
                    <span className="block text-[8px] text-slate-500 mt-1 italic">
                      {spec.desc}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>

        {/* Campaign Applications sidebar */}
        <div className="space-y-6">
          {user && <NotificationsPanel userId={user.id} onChange={loadData} />}

          {/* Applications list */}
          <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
              <Layers className="w-5 h-5 text-brand-purple" />
              Applied Campaigns
            </h3>

            {applications.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-slate-500 leading-normal">
                  No active submissions. Select a campaign below to apply and trigger the matching engine.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {applications.map((app) => (
                  <div key={app.id} className="h-[124px] p-4 bg-slate-900/60 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col">
                    <div className="flex justify-between items-start gap-2 mb-2 shrink-0">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-slate-200 line-clamp-1">{app.campaign_title}</h4>
                        <span className="text-[10px] text-slate-500">Fit Match: {app.overall_fit_score}%</span>
                      </div>

                      <CandidateStatusBadge app={app} />
                    </div>

                    {/* Rejection feedback stays hidden until the 24-hour notice period has passed.
                        Fixed-height slot (always reserved) keeps every card the same size. */}
                    <div className="flex-1 min-h-0">
                      {app.recruiter_feedback && !(app.status === "rejected" && getCandidateVisibleStatus(app) === "under_review") && (
                        <p className="text-[10px] text-slate-400 leading-normal border-t border-white/5 pt-2 mt-1 italic bg-slate-950/20 p-2 rounded line-clamp-2 h-full">
                          &ldquo;{app.recruiter_feedback}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Apply to New campaigns */}
          <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
              <h3 className="text-sm font-bold text-slate-300">
                Available Audition Campaigns
              </h3>
              <button
                type="button"
                onClick={() => navigate("/candidate/campaigns")}
                className="text-[10px] font-bold text-brand-purple hover:text-white uppercase tracking-wider cursor-pointer"
              >
                View details
              </button>
            </div>

            <ProfileRequirementNotice missing={getMissingProfileItems(user, profile, prediction)} compact />
            {applyError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{applyError}</span>
              </div>
            )}
            
            <div className="space-y-3.5">
              {campaigns
                .filter(isCampaignOpen)
                .filter((camp) => !applications.some((app) => app.campaign_id === camp.id))
                .map((camp) => (
                  <div key={camp.id} className="flex items-center justify-between gap-3 p-3.5 bg-slate-900/30 border border-white/5 rounded-2xl">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200 line-clamp-1">{camp.title}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">{camp.brand_name} &bull; Target: {camp.target_size}</p>
                    </div>
                    <button
                      onClick={() => handleApply(camp.id)}
                      disabled={applyingId === camp.id || getMissingProfileItems(user, profile, prediction).length > 0}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold bg-white text-slate-950 rounded-lg transition-all hover:bg-slate-200 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {applyingId === camp.id ? (
                        <div className="w-3 h-3 border border-slate-900 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          Apply <ArrowUpRight className="w-3 h-3" />
                        </>
                      )}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
