import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import { scannerUrl } from "../../services/scannerApi";
import { AVAILABILITY_LABELS, CONTACT_STATUS_LABELS } from "../../services/recruitmentRules";
import type { Campaign, ContactStatus, ModelAvailability, SelectedModel } from "../../types";
import { ArrowLeft, Calendar, Mail, Phone, Save, Star, Trash2, Users } from "lucide-react";

const AVAILABILITY_STYLES: Record<ModelAvailability, string> = {
  available: "bg-green-500/10 text-green-300 border-green-500/25",
  confirmed: "bg-brand-purple/15 text-brand-purple border-brand-purple/30",
  pending_confirmation: "bg-yellow-500/10 text-yellow-300 border-yellow-500/25",
  unavailable: "bg-red-500/10 text-red-300 border-red-500/25",
};

const SelectedModelCard: React.FC<{
  model: SelectedModel;
  onUpdate: (id: string, patch: Partial<Pick<SelectedModel, "availability" | "recruiter_notes" | "contact_status">>) => Promise<void>;
  onRemove: (model: SelectedModel) => void;
}> = ({ model, onUpdate, onRemove }) => {
  const [notes, setNotes] = useState(model.recruiter_notes);
  const [imageFailed, setImageFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setNotes(model.recruiter_notes), [model.recruiter_notes]);

  const saveNotes = async () => {
    setSaving(true);
    await onUpdate(model.id, { recruiter_notes: notes });
    setSaving(false);
  };

  const measurementEntries = Object.entries(model.measurements || {});
  const telHref = model.phone_number ? `tel:${model.phone_number.replace(/[^\d+]/g, "")}` : "";

  return (
    <div className="glass-card rounded-3xl border border-white/5 shadow-xl overflow-hidden flex flex-col">
      <div className="flex gap-4 p-5 border-b border-white/5">
        {model.front_image_url && !imageFailed ? (
          <img
            src={scannerUrl(model.front_image_url)}
            alt={`${model.candidate_name} front capture`}
            onError={() => setImageFailed(true)}
            className="w-20 h-28 rounded-xl object-cover bg-slate-950 border border-white/10 shrink-0"
          />
        ) : (
          <div className="w-20 h-28 rounded-xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-2xl font-bold text-brand-purple shrink-0">
            {model.candidate_name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-white leading-tight">{model.candidate_name}</h3>
            <span className="text-sm font-extrabold text-brand-pink shrink-0">{model.overall_fit_score}%</span>
          </div>
          <p className="text-[11px] text-brand-purple font-semibold truncate">{model.campaign_title}</p>
          <div className="space-y-1 text-[11px] text-slate-300">
            <span className="flex items-center gap-1.5 min-w-0">
              <Mail className="w-3 h-3 text-slate-500 shrink-0" />
              {model.email ? <span className="truncate">{model.email}</span> : <span className="text-slate-500">No email</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="w-3 h-3 text-slate-500 shrink-0" />
              {model.phone_number || <span className="text-slate-500">No phone</span>}
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <Calendar className="w-3 h-3 shrink-0" /> Selected {new Date(model.selected_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 flex-1 flex flex-col">
        {measurementEntries.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {measurementEntries.slice(0, 9).map(([name, val]) => (
              <span key={name} className="px-2 py-1 rounded-md bg-slate-950/50 text-[10px] text-slate-400 flex justify-between gap-1">
                <span className="capitalize truncate">{name.replace(/_/g, " ")}</span>
                <strong className="text-slate-200">{Math.round(val * 10) / 10}</strong>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">No measurements recorded.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Availability
            <select
              value={model.availability}
              onChange={(e) => onUpdate(model.id, { availability: e.target.value as ModelAvailability })}
              className={`mt-1 w-full px-2 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer normal-case tracking-normal ${AVAILABILITY_STYLES[model.availability]} bg-slate-950`}
            >
              {(Object.keys(AVAILABILITY_LABELS) as ModelAvailability[]).map((k) => (
                <option key={k} value={k} className="bg-slate-950 text-slate-200">{AVAILABILITY_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Contact status
            <select
              value={model.contact_status}
              onChange={(e) => onUpdate(model.id, { contact_status: e.target.value as ContactStatus })}
              className="glass-input mt-1 w-full px-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer normal-case tracking-normal"
            >
              {(Object.keys(CONTACT_STATUS_LABELS) as ContactStatus[]).map((k) => (
                <option key={k} value={k} className="bg-slate-950">{CONTACT_STATUS_LABELS[k]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recruiter notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="glass-input px-3 py-2 w-full rounded-xl text-xs min-h-[64px]"
            placeholder="Fitting notes, booking details, follow-ups..."
          />
          <button
            type="button"
            onClick={saveNotes}
            disabled={saving || notes === model.recruiter_notes}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-[10px] font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-3 h-3" /> {saving ? "Saving…" : notes === model.recruiter_notes ? "Notes saved" : "Save notes"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-3 mt-auto border-t border-white/5">
          {model.email && (
            <a
              href={`mailto:${model.email}?subject=${encodeURIComponent(`${model.campaign_title} — casting`)}`}
              onClick={() => model.contact_status === "not_contacted" && onUpdate(model.id, { contact_status: "contacted" })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-slate-950 text-[11px] font-bold hover:bg-slate-200"
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          )}
          {telHref && (
            <a
              href={telHref}
              onClick={() => model.contact_status === "not_contacted" && onUpdate(model.id, { contact_status: "contacted" })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-[11px] font-bold text-slate-200 hover:text-white"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          <button
            type="button"
            onClick={() => onRemove(model)}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/10 border border-red-500/25 text-[11px] font-bold text-red-400 hover:bg-red-600 hover:text-white cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
        </div>
      </div>
    </div>
  );
};

export const SelectedModels: React.FC = () => {
  const navigate = useNavigate();
  const [models, setModels] = useState<SelectedModel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignFilter, setCampaignFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getSelectedModels(), api.getCampaigns()])
      .then(([selected, camps]) => {
        setModels(selected);
        setCampaigns(camps);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleUpdate = async (
    id: string,
    patch: Partial<Pick<SelectedModel, "availability" | "recruiter_notes" | "contact_status">>
  ) => {
    const updated = await api.updateSelectedModel(id, patch);
    setModels((prev) => prev.map((m) => (m.id === id ? updated : m)));
  };

  const handleRemove = async (model: SelectedModel) => {
    if (!confirm(`Remove ${model.candidate_name} from Selected Models for "${model.campaign_title}"?`)) return;
    await api.removeSelectedModel(model.id);
    setModels((prev) => prev.filter((m) => m.id !== model.id));
  };

  const campaignIds = Array.from(new Set(models.map((m) => m.campaign_id)));
  const visible = campaignFilter ? models.filter((m) => m.campaign_id === campaignFilter) : models;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <button
            type="button"
            onClick={() => navigate("/recruiter/dashboard")}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Recruitment Screening
          </button>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Star className="w-7 h-7 text-brand-purple" />
            Selected Models
          </h1>
          <p className="text-sm text-slate-400 mt-1">Your final picks: confirm availability, keep notes and contact each model.</p>
        </div>
        {campaignIds.length > 1 && (
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="glass-input px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          >
            <option value="" className="bg-slate-950">All Campaigns</option>
            {campaignIds.map((id) => (
              <option key={id} value={id} className="bg-slate-950">
                {models.find((m) => m.campaign_id === id)?.campaign_title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Picks per campaign vs. models required */}
      {campaignIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {campaignIds.map((id) => {
            const picked = models.filter((m) => m.campaign_id === id);
            const campaign = campaigns.find((c) => c.id === id);
            const confirmed = picked.filter((m) => m.availability === "confirmed").length;
            return (
              <span key={id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-white/5 text-[11px] text-slate-300">
                <Users className="w-3.5 h-3.5 text-brand-purple" />
                <strong className="text-slate-100">{picked[0].campaign_title}</strong>
                {picked.length}{campaign?.models_required ? ` / ${campaign.models_required}` : ""} selected · {confirmed} confirmed
              </span>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 glass-card rounded-3xl border border-dashed border-white/10 p-8">
          <Star className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">No selected models yet</h3>
          <p className="text-xs text-slate-400 mb-6">Open a candidate in Recruitment Screening and choose "Pick Model".</p>
          <button
            type="button"
            onClick={() => navigate("/recruiter/dashboard")}
            className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs cursor-pointer"
          >
            Review Candidates
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {visible.map((m) => (
            <SelectedModelCard key={m.id} model={m} onUpdate={handleUpdate} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
};
