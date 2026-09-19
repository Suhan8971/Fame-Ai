import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { scannerApi, scannerUrl } from "../../services/scannerApi";
import { AVAILABILITY_LABELS, calculateAge } from "../../services/recruitmentRules";
import { VirtualTryOn } from "../../components/tryon/VirtualTryOn";
import type {
  Application, Campaign, CandidateProfile, Prediction, ScanView, SelectedModel, StoredModel, StoredModelSession, User,
} from "../../types";
import { Search, ArrowUpDown, CheckCircle2, XCircle, Clock, ChevronRight, Eye, MessageSquare, Sparkles, Shirt, RefreshCw, AlertCircle, Check, Mail, Phone, UserCheck, Star } from "lucide-react";

const CAPTURE_VIEWS: ScanView[] = ["front", "left", "right", "back"];

type PipelineTab = "all" | "shortlisted" | "pending" | "rejected" | "selected";

const PIPELINE_TABS: { key: PipelineTab; label: string }[] = [
  { key: "all", label: "All Applicants" },
  { key: "shortlisted", label: "Automatically Shortlisted" },
  { key: "pending", label: "Pending Review" },
  { key: "rejected", label: "Rejected" },
  { key: "selected", label: "Final Selected" },
];

const PROFILE_MEASUREMENT_LABELS: [keyof CandidateProfile, string][] = [
  ["chest", "Chest"], ["shoulder", "Shoulder"], ["waist", "Waist"], ["abdomen", "Abdomen"], ["hips", "Hips"],
  ["left_arm", "Left arm"], ["right_arm", "Right arm"], ["left_thigh", "Left thigh"], ["right_thigh", "Right thigh"],
];

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PipelineTab>("all");
  const [sortBy, setSortBy] = useState<"fit_score" | "created_at">("fit_score");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Selection state for detail view modal
  const [activeApp, setActiveApp] = useState<Application | null>(null);
  const [activePrediction, setActivePrediction] = useState<Prediction | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [activeCaptures, setActiveCaptures] = useState<StoredModelSession | null>(null);
  // Complete model profile for the candidate being inspected
  const [activeProfile, setActiveProfile] = useState<CandidateProfile | null>(null);
  const [activeAccount, setActiveAccount] = useState<User | null>(null);
  const [activeCandidateApps, setActiveCandidateApps] = useState<Application[]>([]);
  const [pickMessage, setPickMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Virtual try-on studio: models with a stored body scan (backend model store)
  const [scanModels, setScanModels] = useState<StoredModel[]>([]);
  const [scanModelsLoading, setScanModelsLoading] = useState(true);
  const [scanModelsError, setScanModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [frontSelected, setFrontSelected] = useState(false);
  const [engineStatus, setEngineStatus] = useState<string | undefined>(undefined);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const activeAppIdRef = useRef<string | null>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<any>({
    total: 0,
    shortlisted: 0,
    rejected: 0,
    pending: 0,
    averageFit: 0,
    sizeDistribution: [],
    fitDistribution: [],
  });

  useEffect(() => {
    loadData();
  }, [selectedCampaignId]);

  const loadScanModels = useCallback(async () => {
    setScanModelsLoading(true);
    setScanModelsError(null);
    try {
      const models = await scannerApi.listModels();
      setScanModels(models);
      setSelectedModelId((prev) => (prev && !models.some((m) => m.model_id === prev) ? null : prev));
      const status = await scannerApi.status();
      setEngineStatus(status.vton_engine?.status);
    } catch (err) {
      setScanModelsError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setScanModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScanModels();
  }, [loadScanModels]);

  const selectedModel = scanModels.find((m) => m.model_id === selectedModelId) || null;

  const selectModel = (modelId: string) => {
    if (modelId !== selectedModelId) setFrontSelected(false);
    setSelectedModelId(modelId);
  };

  const loadData = async () => {
    try {
      const apps = await api.getApplications();
      const camps = await api.getCampaigns();
      setCampaigns(camps);
      setSelectedModels(await api.getSelectedModels());

      // Fetch analytics
      const stats = await api.getRecruiterAnalytics(selectedCampaignId || undefined);
      setAnalytics(stats);

      // Filter local list based on selected campaign
      let list = apps;
      if (selectedCampaignId) {
        list = list.filter((a) => a.campaign_id === selectedCampaignId);
      }
      setApplications(list);
    } catch (err) {
      console.error("Dashboard data load error: ", err);
    }
  };

  const handleSelectApp = async (app: Application) => {
    setActiveApp(app);
    setFeedbackText(app.recruiter_feedback || "");
    setActiveCaptures(null);
    setActivePrediction(null);
    setPickMessage(null);
    activeAppIdRef.current = app.id;
    api.getCandidateProfile(app.candidate_id).then(({ user: account, profile }) => {
      if (activeAppIdRef.current !== app.id) return;
      setActiveAccount(account);
      setActiveProfile(profile);
    });
    api.getCandidateApplications(app.candidate_id).then((apps) => {
      if (activeAppIdRef.current === app.id) setActiveCandidateApps(apps);
    });
    scannerApi
      .getModel(app.candidate_id)
      .then((session) => {
        if (activeAppIdRef.current === app.id) setActiveCaptures(session);
      })
      .catch(() => {}); // no stored scan for this candidate (or server offline)
    try {
      // Find matching prediction in mock DB
      const pred = await api.getLatestPrediction(app.candidate_id);
      setActivePrediction(pred);
    } catch (err) {
      console.error("Error loading prediction: ", err);
    }
  };

  const handleUpdateStatus = async (status: "shortlisted" | "rejected") => {
    if (!activeApp) return;
    setActionLoading(true);
    try {
      const updated = await api.updateApplicationStatus(activeApp.id, status, feedbackText);
      // Update local items
      setApplications((prev) => prev.map((a) => (a.id === activeApp.id ? updated : a)));
      setActiveApp(updated);
      
      // Update analytics
      const stats = await api.getRecruiterAnalytics(selectedCampaignId || undefined);
      setAnalytics(stats);
    } catch (err) {
      console.error("Update application error: ", err);
    } finally {
      setActionLoading(false);
    }
  };

  const closeInspector = () => {
    activeAppIdRef.current = null;
    setActiveApp(null);
    setActivePrediction(null);
    setActiveCaptures(null);
    setActiveProfile(null);
    setActiveAccount(null);
    setActiveCandidateApps([]);
    setPickMessage(null);
  };

  // "Pick Model": save the candidate to Selected Models (no duplicates)
  const handlePickModel = async () => {
    if (!activeApp || !user) return;
    setActionLoading(true);
    try {
      const front = activeCaptures?.views.front;
      const { alreadySaved } = await api.selectModel(activeApp.id, user.id, front ? front.raw_image_url || front.image_url : null);
      setPickMessage({
        ok: true,
        text: alreadySaved
          ? `${activeApp.candidate_name} is already in Selected Models for this campaign.`
          : `${activeApp.candidate_name} was saved to Selected Models.`,
      });
      const apps = await api.getApplications();
      setApplications(selectedCampaignId ? apps.filter((a) => a.campaign_id === selectedCampaignId) : apps);
      setActiveApp(apps.find((a) => a.id === activeApp.id) || activeApp);
      setSelectedModels(await api.getSelectedModels());
      setAnalytics(await api.getRecruiterAnalytics(selectedCampaignId || undefined));
    } catch (err) {
      setPickMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save this model." });
    } finally {
      setActionLoading(false);
    }
  };

  const selectionFor = (app: Application) =>
    selectedModels.find((s) => s.candidate_id === app.candidate_id && s.campaign_id === app.campaign_id);

  const matchesTab = (app: Application, tab: PipelineTab) =>
    tab === "all" ? true : tab === "selected" ? !!selectionFor(app) : app.status === tab;

  // Filter & Search computation
  const filteredApps = applications
    .filter((app) => {
      const matchesSearch = app.candidate_name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = matchesTab(app, statusFilter);
      
      // Fetch size matching prediction
      const matchesSize = true; // Simpler fallback for client filtering
      
      return matchesSearch && matchesStatus && matchesSize;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === "fit_score") {
        comparison = (a.overall_fit_score || 0) - (b.overall_fit_score || 0);
      } else {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

  const toggleSort = (field: "fit_score" | "created_at") => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Recruitment Screening</h1>
          <p className="text-sm text-slate-400 mt-1">
            Review automatically extracted body fit diagnostics from candidate submissions.
          </p>
        </div>

        {/* Campaign Filter Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/recruiter/selected")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-purple/10 border border-brand-purple/25 text-xs font-bold text-brand-purple hover:bg-brand-purple/20 cursor-pointer"
          >
            <Star className="w-3.5 h-3.5" /> Selected Models ({selectedModels.length})
          </button>
          <label className="text-xs text-slate-500 font-bold uppercase tracking-wider">Campaign:</label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="glass-input px-3.5 py-2 rounded-xl text-xs font-semibold select-none cursor-pointer"
          >
            <option value="" className="bg-slate-950">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-950">
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Analytics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-card p-5 rounded-2xl border border-white/5 relative overflow-hidden">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Total Applicants</span>
          <span className="block text-3xl font-extrabold text-white mt-1.5">{analytics.total}</span>
          <div className="absolute top-0 right-0 w-24 h-24 bg-brand-purple/5 rounded-full blur-2xl pointer-events-none" />
        </div>
        <div className="glass-card p-5 rounded-2xl border border-white/5 relative overflow-hidden">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest text-green-400">Shortlisted</span>
          <span className="block text-3xl font-extrabold text-green-400 mt-1.5">{analytics.shortlisted}</span>
          <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full blur-2xl pointer-events-none" />
        </div>
        <div className="glass-card p-5 rounded-2xl border border-white/5 relative overflow-hidden">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest text-red-400">Rejected</span>
          <span className="block text-3xl font-extrabold text-red-400 mt-1.5">{analytics.rejected}</span>
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />
        </div>
        <div className="glass-card p-5 rounded-2xl border border-white/5 relative overflow-hidden">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest text-brand-pink">Average Fit Score</span>
          <span className="block text-3xl font-extrabold text-brand-pink mt-1.5 text-glow">{analytics.averageFit}%</span>
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/5 rounded-full blur-2xl pointer-events-none" />
        </div>
      </div>

      {/* Main List Section */}
      <div className="glass-card rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
        {/* Table Filters & Toolbar */}
        <div className="p-5 border-b border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-950/20">
          <div className="relative w-full md:max-w-xs">
            <Search className="w-4 h-4 text-slate-500 absolute top-1/2 left-3.5 transform -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search candidate name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="glass-input pl-10 pr-4 py-2 w-full rounded-xl text-xs"
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            {/* Sort Toggle Button */}
            <button
              onClick={() => toggleSort("fit_score")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-400 hover:text-white cursor-pointer transition-all"
            >
              Fit Score
              <ArrowUpDown className="w-3 h-3 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Candidate pipeline */}
        <div className="px-5 pt-4 flex gap-2 overflow-x-auto border-b border-white/5 bg-slate-950/10">
          {PIPELINE_TABS.map((tab) => {
            const count = applications.filter((a) => matchesTab(a, tab.key)).length;
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`shrink-0 px-3.5 py-2 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  active ? "border-brand-purple text-white bg-brand-purple/10" : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-brand-purple/30 text-white" : "bg-slate-800 text-slate-400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Candidates Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-950/40 py-3">
                <th className="p-4 pl-6">Candidate Name</th>
                <th className="p-4">Assigned Campaign</th>
                <th className="p-4 text-center">Fit Score</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right pr-6">Audition Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-300">
              {filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-500">
                    No candidates found matching the criteria.
                  </td>
                </tr>
              ) : (
                filteredApps.map((app) => (
                  <tr key={app.id} className="hover:bg-white/[0.01] transition-all group">
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-brand-purple/10 flex items-center justify-center border border-brand-purple/20 text-brand-purple font-bold">
                          {app.candidate_name.charAt(0)}
                        </div>
                        <div>
                          <span className="block font-semibold text-slate-200">{app.candidate_name}</span>
                          <span className="text-[10px] text-slate-500">Applied {new Date(app.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="font-medium text-slate-300 line-clamp-1 max-w-[200px]">{app.campaign_title}</span>
                    </td>
                    <td className="p-4 text-center col-fit">
                      <div className="flex flex-col items-center justify-center">
                        <span className={`text-sm font-extrabold ${
                          app.overall_fit_score >= 90 
                            ? "text-green-400" 
                            : app.overall_fit_score >= 75 
                            ? "text-yellow-400" 
                            : "text-red-400"
                        }`}>
                          {app.overall_fit_score}%
                        </span>
                        {app.recommendation_status && (
                          <span className={`text-[8px] font-bold uppercase tracking-widest mt-0.5 px-1 py-0.2 rounded ${
                            app.recommendation_status === "Highly Recommended"
                              ? "text-green-400 bg-green-500/10"
                              : app.recommendation_status === "Recommended"
                              ? "text-emerald-400 bg-emerald-500/10"
                              : app.recommendation_status === "Review Manually"
                              ? "text-yellow-400 bg-yellow-500/10"
                              : "text-red-400 bg-red-500/10"
                          }`}>
                            {app.recommendation_status.split(" ")[0]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      {app.status === "shortlisted" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-bold uppercase text-[9px] tracking-wide">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Shortlisted
                        </span>
                      )}
                      {app.status === "rejected" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold uppercase text-[9px] tracking-wide">
                          <XCircle className="w-2.5 h-2.5" /> Rejected
                        </span>
                      )}
                      {app.status === "pending" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-bold uppercase text-[9px] tracking-wide">
                          <Clock className="w-2.5 h-2.5" /> Pending
                        </span>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500">
                          {app.status_source === "recruiter" ? "By recruiter" : "Automatic"}
                        </span>
                        {selectionFor(app) && (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-widest text-brand-purple">
                            <Star className="w-2.5 h-2.5" /> Selected
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right pr-6">
                      <button
                        onClick={() => handleSelectApp(app)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-white/5 hover:border-brand-purple/40 text-[11px] font-semibold text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer group-hover:scale-102"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect Fit
                        <ChevronRight className="w-3 h-3 text-slate-500" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Virtual Try-On Studio */}
      <div ref={studioRef} className="glass-card rounded-3xl border border-white/5 shadow-2xl overflow-hidden scroll-mt-24">
        <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950/20">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shirt className="w-5 h-5 text-brand-purple" />
              Virtual Try-On Studio
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Pick a model, select their front capture, then drop any shirt photo to see it replace the outfit they are wearing.
            </p>
          </div>
          <button
            type="button"
            onClick={loadScanModels}
            disabled={scanModelsLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-400 hover:text-white cursor-pointer transition-all disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanModelsLoading ? "animate-spin" : ""}`} />
            Refresh Models
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Step 1: model picker */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">1 · Select a model</h3>
            {scanModelsError ? (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs space-y-3">
                <p className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{scanModelsError}</span>
                </p>
                <button
                  type="button"
                  onClick={loadScanModels}
                  className="px-3 py-1.5 bg-brand-purple hover:bg-brand-purple/90 text-[11px] text-slate-950 rounded-lg font-bold transition-all cursor-pointer"
                >
                  Retry Connecting
                </button>
              </div>
            ) : scanModelsLoading && scanModels.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
              </div>
            ) : scanModels.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-white/5 text-xs text-slate-500 text-center">
                No models have completed a body scan yet. Captures appear here after a model finishes all four views.
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {scanModels.map((m) => {
                  const active = m.model_id === selectedModelId;
                  return (
                    <button
                      key={m.model_id}
                      type="button"
                      onClick={() => selectModel(m.model_id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? "bg-brand-purple/10 border-brand-purple/40"
                          : "bg-slate-900/40 border-white/5 hover:border-brand-purple/25"
                      }`}
                    >
                      <img
                        src={scannerUrl(m.views.front.raw_image_url || m.views.front.image_url)}
                        alt=""
                        className="w-10 h-12 rounded-lg object-cover bg-slate-950 border border-white/5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-slate-200 truncate">{m.name || m.model_id}</span>
                        <span className="block text-[10px] text-slate-500 truncate">
                          Scanned {new Date(m.saved_at * 1000).toLocaleDateString()}
                          {m.height_cm ? ` · ${m.height_cm} cm` : ""}
                        </span>
                      </div>
                      {m.release !== undefined && (
                        <span
                          className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 ${
                            m.release ? "text-green-400 bg-green-500/10" : "text-yellow-400 bg-yellow-500/10"
                          }`}
                        >
                          {m.release ? `${m.overall_confidence_pct ?? ""}%` : "Retake"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {/* Step 2: model's captured images */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                2 · Select the front image{selectedModel ? ` — ${selectedModel.name || selectedModel.model_id}` : ""}
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {CAPTURE_VIEWS.map((view) => {
                  const entry = selectedModel?.views[view];
                  const isFront = view === "front";
                  const selected = isFront && frontSelected && !!selectedModel;
                  return (
                    <button
                      key={view}
                      type="button"
                      disabled={!selectedModel || !isFront}
                      onClick={() => setFrontSelected((prev) => !prev)}
                      title={isFront ? "Use this photo for virtual try-on" : "Virtual try-on uses the front view"}
                      className={`relative aspect-[3/4] rounded-xl overflow-hidden border bg-slate-950 transition-all ${
                        selected
                          ? "border-brand-purple ring-2 ring-brand-purple/40"
                          : isFront && selectedModel
                          ? "border-white/10 hover:border-brand-purple/50 cursor-pointer"
                          : "border-white/5 cursor-default"
                      }`}
                    >
                      {entry ? (
                        <img
                          src={scannerUrl(isFront ? entry.raw_image_url || entry.image_url : entry.image_url)}
                          alt={`${view} view`}
                          className={`w-full h-full object-cover ${!isFront ? "opacity-70" : ""}`}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] font-bold uppercase text-slate-700">
                          {view}
                        </div>
                      )}
                      {selected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-purple flex items-center justify-center shadow-lg">
                          <Check className="w-3 h-3 text-slate-950" />
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1.5 text-[8px] uppercase font-black tracking-widest text-slate-400 bg-slate-950/80 px-1 rounded">
                        {view}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: drop a shirt */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">3 · Drop a shirt</h3>
              <VirtualTryOn
                modelId={selectedModel && frontSelected ? selectedModel.model_id : null}
                modelName={selectedModel?.name}
                beforeImageUrl={
                  selectedModel && frontSelected
                    ? scannerUrl(selectedModel.views.front.raw_image_url || selectedModel.views.front.image_url)
                    : null
                }
                engineStatus={engineStatus}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Candidate Anatomy Detail Inspector Modal */}
      {activeApp && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-card max-w-4xl w-full rounded-3xl border border-white/10 shadow-2xl relative flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-brand-purple tracking-widest">
                  Model Profile &amp; AI Assessment
                </span>
                <h2 className="text-2xl font-bold text-white mt-1">{activeApp.candidate_name}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Current campaign: <span className="text-slate-200 font-semibold">{activeApp.campaign_title}</span>
                  {" · "}Status: <span className="capitalize text-slate-200 font-semibold">{activeApp.status}</span>
                  {" "}({activeApp.status_source === "recruiter" ? "set by recruiter" : "automatic"})
                </p>
              </div>
              <button
                onClick={closeInspector}
                className="p-2 text-slate-400 hover:text-white bg-slate-900/50 hover:bg-slate-900 rounded-xl transition-all border border-white/5 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 max-h-[75vh]">
              {/* Left Column: Profile, Diagnostics, Images and AI Explanation */}
              <div className="space-y-6">
                {/* Complete model profile */}
                {(() => {
                  const email = activeAccount?.email || activeProfile?.email || "";
                  const phone = activeProfile?.phone_number || "";
                  const age = calculateAge(activeProfile?.birth_date);
                  const selection = selectionFor(activeApp);
                  return (
                    <div className="p-4 bg-slate-900/55 rounded-2xl border border-white/5 space-y-3 text-xs">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Model Profile</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <span className="flex items-center gap-1.5 text-slate-300 min-w-0">
                          <Mail className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                          {email ? <a href={`mailto:${email}`} className="truncate hover:text-white underline-offset-2 hover:underline">{email}</a> : <span className="text-slate-500">No email</span>}
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <Phone className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                          {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="hover:text-white hover:underline">{phone}</a> : <span className="text-slate-500">No phone</span>}
                        </span>
                      </div>
                      {activeProfile ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {[
                            ["Gender", activeProfile.gender, true],
                            ["Age", age !== null ? `${age}` : "—", false],
                            ["Date of birth", activeProfile.birth_date || "—", false],
                            ["Height", activeProfile.height ? `${activeProfile.height} cm` : "—", false],
                            ["Weight", activeProfile.weight ? `${activeProfile.weight} kg` : "—", false],
                            ["Units", activeProfile.preferred_units, true],
                          ].map(([label, value, capitalize]) => (
                            <div key={String(label)} className="p-2 rounded-lg bg-slate-950/50 border border-white/[0.03]">
                              <span className="block text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
                              <span className={`text-slate-200 font-semibold ${capitalize ? "capitalize" : ""}`}>{value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-500">This model has not created a profile in this browser.</p>
                      )}
                      {activeProfile && (
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                            Body measurements {activeProfile.measurements_confirmed_at ? "(confirmed by model)" : "(not confirmed)"}
                          </span>
                          {activeProfile.measurements_confirmed_at ? (
                            <div className="grid grid-cols-3 gap-1.5">
                              {PROFILE_MEASUREMENT_LABELS.filter(([k]) => Number(activeProfile[k]) > 0).map(([k, label]) => (
                                <span key={k} className="flex justify-between gap-1 px-2 py-1 rounded-md bg-slate-950/50 text-[10px] text-slate-400">
                                  {label}<strong className="text-slate-200">{String(activeProfile[k])}</strong>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-slate-500">The model has not confirmed manual measurements; use the scan below.</p>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
                        <span className="text-slate-400">
                          Availability:{" "}
                          <strong className="text-slate-200">{selection ? AVAILABILITY_LABELS[selection.availability] : "Not selected yet"}</strong>
                        </span>
                        {selection && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-purple">
                            <Star className="w-3 h-3" /> In Selected Models
                          </span>
                        )}
                      </div>
                      {activeCandidateApps.length > 0 && (
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1">Applied campaigns</span>
                          <div className="space-y-1">
                            {activeCandidateApps.map((a) => (
                              <div
                                key={a.id}
                                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[10px] ${
                                  a.id === activeApp.id ? "bg-brand-purple/10 border border-brand-purple/20" : "bg-slate-950/50"
                                }`}
                              >
                                <span className="text-slate-300 truncate">{a.campaign_title}</span>
                                <span className="shrink-0 text-slate-400">
                                  {a.overall_fit_score}% · <span className="capitalize text-slate-200">{a.status}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Score and Recommendation Status Badge */}
                <div className="p-5 bg-gradient-to-tr from-brand-purple/10 to-brand-pink/10 border border-brand-purple/20 rounded-2xl flex items-center justify-between gap-4">
                  <div>
                    <span className="block text-[10px] font-bold text-brand-purple uppercase tracking-widest leading-none">Matching Fit Rating</span>
                    <span className="text-3xl font-extrabold text-white block mt-1">{activeApp.overall_fit_score}%</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1.5">Rec. Status</span>
                    {activeApp.recommendation_status ? (
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${
                        activeApp.recommendation_status === "Highly Recommended"
                          ? "bg-green-500/10 text-green-400 border-green-500/20 shadow-lg shadow-green-500/5"
                          : activeApp.recommendation_status === "Recommended"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : activeApp.recommendation_status === "Review Manually"
                          ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20 shadow-lg shadow-yellow-500/5"
                          : "bg-red-500/10 text-red-400 border-red-500/20 shadow-lg shadow-red-500/5"
                      }`}>
                        {activeApp.recommendation_status}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-bold text-xs uppercase">Pending Assessment</span>
                    )}
                  </div>
                </div>

                {/* AI Explanation Explanation */}
                {activeApp.ai_explanation && (
                  <div className="p-4 bg-slate-900/55 rounded-2xl border border-white/5 space-y-1.5">
                    <h4 className="text-xs font-bold text-brand-pink uppercase tracking-widest flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-brand-pink animate-pulse" /> AI Fit Match Explanation
                    </h4>
                    <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                      {activeApp.ai_explanation}
                    </p>
                  </div>
                )}

                {/* Standardized Captured Images */}
                <div>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Standardized Body Captures</h3>
                    {activeCaptures && (
                      <button
                        type="button"
                        onClick={() => {
                          selectModel(activeCaptures.model_id);
                          loadScanModels();
                          closeInspector();
                          setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-purple/10 border border-brand-purple/25 text-[10px] font-bold text-brand-purple hover:bg-brand-purple/20 transition-all cursor-pointer"
                      >
                        <Shirt className="w-3 h-3" /> Try On Shirts
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(activeCaptures ? {
                      front: scannerUrl(activeCaptures.views.front.image_url),
                      left: scannerUrl(activeCaptures.views.left.image_url),
                      right: scannerUrl(activeCaptures.views.right.image_url),
                      back: scannerUrl(activeCaptures.views.back.image_url),
                    } : {
                      front: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=60",
                      left: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500&auto=format&fit=crop&q=60",
                      back: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500&auto=format&fit=crop&q=60",
                      right: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&auto=format&fit=crop&q=60",
                    }).map(([viewName, url]) => (
                      <div key={viewName} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-white/5 bg-slate-950">
                        <img src={url} alt={viewName} className="w-full h-full object-cover" />
                        <div className="absolute bottom-1 left-1.5 text-[8px] uppercase font-black tracking-widest text-slate-400 bg-slate-950/80 px-1 rounded">
                          {viewName}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fit Diagnostics details */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Garment Fit Diagnostics</h3>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {Object.entries(activeApp.fit_details).map(([part, match]) => (
                      <div key={part} className="p-2.5 bg-slate-900/40 border border-white/5 rounded-xl flex justify-between items-center">
                        <span className="text-[11px] text-slate-300 capitalize font-medium">{part.replace(/_/g, " ")}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          match === "perfect" || match === "excellent"
                            ? "bg-green-500/10 text-green-400 border border-green-500/20"
                            : match === "good"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                        }`}>
                          {match}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Measurements details list & Action */}
              <div className="space-y-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Latest Scan Measurements</h3>
                    {activePrediction?.confidence_score && (
                      <span className="text-[10px] text-brand-pink font-bold uppercase tracking-widest leading-none">
                        Confidence: {activePrediction.confidence_score}%
                      </span>
                    )}
                  </div>
                  {activePrediction ? (
                    <div className="grid grid-cols-1 gap-1.5 max-h-[360px] overflow-y-auto pr-1">
                      {Object.entries(activePrediction.measurements)
                        .filter(([, val]) => typeof val === "number")
                        .map(([name, val]) => (
                          <div key={name} className="p-2.5 bg-slate-950/50 rounded-xl flex justify-between items-center text-xs border border-white/[0.02]">
                            <span className="text-slate-400 capitalize text-xs">{name.replace(/_/g, " ")}</span>
                            <span className="text-slate-200 font-bold">{val} cm</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No body scan found for this model.
                    </div>
                  )}
                </div>

                {/* Status Decision Controls */}
                <div className="space-y-4 border-t border-white/5 pt-4 mt-auto">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5 text-brand-purple" /> Recruiter Feedback & Remarks
                    </label>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs min-h-[70px]"
                      placeholder="Enter fit evaluation, notes, and guidelines comments..."
                    />
                  </div>

                  {pickMessage && (
                    <div className={`p-2.5 rounded-xl border text-xs ${pickMessage.ok ? "bg-green-500/10 border-green-500/20 text-green-200" : "bg-red-500/10 border-red-500/20 text-red-200"}`}>
                      {pickMessage.text}
                    </div>
                  )}

                  <button
                    onClick={handlePickModel}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-brand-purple to-brand-pink text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <UserCheck className="w-4 h-4" />
                    {selectionFor(activeApp) ? "Saved in Selected Models" : "Pick Model — Save to Selected Models"}
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdateStatus("rejected")}
                      disabled={actionLoading}
                      className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-red-600/10 border border-red-500/30 text-red-400 hover:bg-red-600 hover:text-white transition-all cursor-pointer disabled:opacity-50 text-center"
                    >
                      Reject Application
                    </button>
                    <button
                      onClick={() => handleUpdateStatus("shortlisted")}
                      disabled={actionLoading}
                      className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-green-600/10 border border-green-500/30 text-green-400 hover:bg-green-600 hover:text-white transition-all cursor-pointer disabled:opacity-50 text-center"
                    >
                      Shortlist Candidate
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};
