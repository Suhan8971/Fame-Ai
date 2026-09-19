import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { Campaign } from "../../types";
import { isCampaignExpired } from "../../services/recruitmentRules";
import { resizeImageToDataUrl } from "../../services/imageUtils";
import { Plus, X, Layers, ToggleLeft, ToggleRight, Pencil, Sparkles, MapPin, Calendar, Clock, Users, ImagePlus, AlertCircle } from "lucide-react";

export const Campaigns: React.FC = () => {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New Campaign Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetGender, setTargetGender] = useState("female");
  const [minHeight, setMinHeight] = useState(175);
  const [maxHeight, setMaxHeight] = useState(185);
  const [targetSize, setTargetSize] = useState("S");
  const [requiredMeasurements, setRequiredMeasurements] = useState<string[]>(["chest", "waist", "hip"]);
  const [formLoading, setFormLoading] = useState(false);

  // Custom Size states
  const [clothingType, setClothingType] = useState("T-shirts/Shirts");
  const [customChest, setCustomChest] = useState(90);
  const [customWaist, setCustomWaist] = useState(70);
  const [customAbdomen, setCustomAbdomen] = useState(74);
  const [customLeftArm, setCustomLeftArm] = useState(60);
  const [customRightArm, setCustomRightArm] = useState(60);
  const [customShoulderWidth, setCustomShoulderWidth] = useState(42);
  const [customHip, setCustomHip] = useState(95);
  const [customLeftThigh, setCustomLeftThigh] = useState(52);
  const [customRightThigh, setCustomRightThigh] = useState(52);

  // Extended campaign details
  const [brandName, setBrandName] = useState(user?.first_name || "");
  const [imageUrl, setImageUrl] = useState("");
  const [location, setLocation] = useState("");
  const [campaignDate, setCampaignDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [applicationDeadline, setApplicationDeadline] = useState("");
  const [modelsRequired, setModelsRequired] = useState(1);
  const [minAge, setMinAge] = useState<number | "">("");
  const [maxAge, setMaxAge] = useState<number | "">("");
  const [instructions, setInstructions] = useState("");
  const [compensation, setCompensation] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState("");

  const availableMeasurements = [
    "chest",
    "waist",
    "hip",
    "shoulder_width",
    "sleeve",
    "neck",
    "inseam",
  ];

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      const data = await api.getCampaigns();
      // Filter by current brand if logged in
      const list = user ? data.filter((c) => c.brand_id === user.id) : data;
      setCampaigns(list);
    } catch (err) {
      console.error("Load campaigns error: ", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      await api.toggleCampaignActive(id);
      setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: !c.is_active } : c)));
    } catch (err) {
      console.error("Toggle campaign status error: ", err);
    }
  };

  const handleCheckboxChange = (measure: string) => {
    setRequiredMeasurements((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  const handleImageFile = async (file?: File) => {
    if (!file) return;
    setFormError("");
    try {
      setImageUrl(await resizeImageToDataUrl(file));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not use that image.");
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setTargetGender("female");
    setMinHeight(175);
    setMaxHeight(185);
    setTargetSize("S");
    setRequiredMeasurements(["chest", "waist", "hip"]);
    setClothingType("T-shirts/Shirts");
    setCustomChest(90);
    setCustomWaist(70);
    setCustomAbdomen(74);
    setCustomLeftArm(60);
    setCustomRightArm(60);
    setCustomShoulderWidth(42);
    setCustomHip(95);
    setCustomLeftThigh(52);
    setCustomRightThigh(52);
    setBrandName(user?.first_name || "");
    setImageUrl("");
    setLocation("");
    setCampaignDate("");
    setStartTime("");
    setEndTime("");
    setApplicationDeadline("");
    setModelsRequired(1);
    setMinAge("");
    setMaxAge("");
    setInstructions("");
    setCompensation("");
    setContactInfo("");
    setIsActive(true);
    setFormError("");
    setEditingId(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  // Loads an existing campaign's data into the form so the brand can edit
  // and resubmit it, instead of re-entering everything from scratch.
  const handleEditClick = (camp: Campaign) => {
    setEditingId(camp.id);
    setTitle(camp.title);
    setDescription(camp.description);
    setTargetGender(camp.target_gender);
    setMinHeight(camp.min_height);
    setMaxHeight(camp.max_height);
    setTargetSize(camp.target_size);
    setRequiredMeasurements(camp.required_measurements);
    setClothingType(camp.clothing_type || "T-shirts/Shirts");
    setCustomChest(camp.custom_measurements?.chest ?? 90);
    setCustomWaist(camp.custom_measurements?.waist ?? 70);
    setCustomAbdomen(camp.custom_measurements?.abdomen ?? 74);
    setCustomLeftArm(camp.custom_measurements?.left_arm ?? 60);
    setCustomRightArm(camp.custom_measurements?.right_arm ?? 60);
    setCustomShoulderWidth(camp.custom_measurements?.shoulder_width ?? 42);
    setCustomHip(camp.custom_measurements?.hip ?? 95);
    setCustomLeftThigh(camp.custom_measurements?.left_thigh ?? 52);
    setCustomRightThigh(camp.custom_measurements?.right_thigh ?? 52);
    setBrandName(camp.brand_name || user?.first_name || "");
    setImageUrl(camp.image_url || "");
    setLocation(camp.location || "");
    setCampaignDate(camp.campaign_date || "");
    setStartTime(camp.start_time || "");
    setEndTime(camp.end_time || "");
    setApplicationDeadline(camp.application_deadline || "");
    setModelsRequired(camp.models_required ?? 1);
    setMinAge(camp.min_age ?? "");
    setMaxAge(camp.max_age ?? "");
    setInstructions(camp.instructions || "");
    setCompensation(camp.compensation || "");
    setContactInfo(camp.contact_info || "");
    setIsActive(camp.is_active);
    setFormError("");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError("");
    if (minHeight > maxHeight) {
      setFormError("Minimum height cannot be greater than maximum height.");
      return;
    }
    if (minAge !== "" && maxAge !== "" && minAge > maxAge) {
      setFormError("Minimum age cannot be greater than maximum age.");
      return;
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (applicationDeadline && applicationDeadline < today) {
      setFormError("The application deadline cannot be in the past.");
      return;
    }
    if (campaignDate && applicationDeadline && applicationDeadline > campaignDate) {
      setFormError("The application deadline must be on or before the campaign date.");
      return;
    }
    if (startTime && endTime && endTime <= startTime) {
      setFormError("The end time must be after the start time.");
      return;
    }
    setFormLoading(true);

    try {
      const customMeasurementsData = targetSize === "Custom Size"
        ? (clothingType === "T-shirts/Shirts" ? {
            chest: customChest,
            waist: customWaist,
            abdomen: customAbdomen,
            left_arm: customLeftArm,
            right_arm: customRightArm,
            shoulder_width: customShoulderWidth
          } : {
            waist: customWaist,
            hip: customHip,
            left_thigh: customLeftThigh,
            right_thigh: customRightThigh
          })
        : undefined;

      const payload = {
        title,
        description,
        target_gender: targetGender,
        min_height: minHeight,
        max_height: maxHeight,
        target_size: targetSize,
        required_measurements: requiredMeasurements,
        clothing_type: clothingType,
        custom_measurements: customMeasurementsData,
        image_url: imageUrl.trim() || null,
        location: location.trim(),
        campaign_date: campaignDate,
        start_time: startTime,
        end_time: endTime,
        application_deadline: applicationDeadline,
        models_required: modelsRequired,
        min_age: minAge === "" ? null : minAge,
        max_age: maxAge === "" ? null : maxAge,
        instructions: instructions.trim(),
        compensation: compensation.trim(),
        contact_info: contactInfo.trim(),
        is_active: isActive,
      };

      if (editingId) {
        await api.updateCampaign(editingId, { ...payload, brand_name: brandName.trim() || user.first_name });
      } else {
        await api.createCampaign(user.id, brandName.trim() || user.first_name, payload);
      }

      resetForm();
      setIsModalOpen(false);
      loadCampaigns();
    } catch (err) {
      console.error(editingId ? "Update campaign error: " : "Create campaign error: ", err);
      setFormError(err instanceof Error ? err.message : `Could not ${editingId ? "update" : "create"} the campaign.`);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-white/5 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Recruitment Campaigns</h1>
          <p className="text-sm text-slate-400 mt-1">Configure casting requirements and monitor applicant matching pipelines.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-semibold text-xs hover:opacity-90 hover:scale-102 transition-all cursor-pointer shadow-lg shadow-purple-500/10"
        >
          <Plus className="w-4 h-4" /> New Campaign
        </button>
      </div>

      {/* Grid list of campaigns */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.length === 0 ? (
            <div className="md:col-span-3 text-center py-16 glass-card rounded-3xl border border-dashed border-white/10 p-8">
              <Layers className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">No Active Campaigns</h3>
              <p className="text-xs text-slate-400 mb-6">Create a recruitment campaign to start matching models with design patterns.</p>
              <button
                onClick={handleOpenCreate}
                className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs"
              >
                Create Campaign
              </button>
            </div>
          ) : (
            campaigns.map((camp) => (
              <div
                key={camp.id}
                className={`glass-card p-6 rounded-2xl border border-white/5 relative overflow-hidden transition-all flex flex-col justify-between ${
                  !camp.is_active ? "opacity-60" : ""
                }`}
              >
                <div>
                  {camp.image_url && (
                    <img src={camp.image_url} alt="" className="w-[calc(100%+3rem)] max-w-none h-32 object-cover -mx-6 -mt-6 mb-4" />
                  )}
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded bg-slate-900 text-[10px] text-brand-purple border border-brand-purple/20 font-bold uppercase tracking-wider">
                      Target Size: {camp.target_size}{camp.clothing_type ? ` (${camp.clothing_type})` : ""}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleEditClick(camp)}
                        className="text-slate-400 hover:text-white transition-all cursor-pointer"
                        title="Edit Campaign"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(camp.id)}
                        className="text-slate-400 hover:text-white transition-all cursor-pointer"
                        title={camp.is_active ? "Deactivate Campaign" : "Activate Campaign"}
                      >
                        {camp.is_active ? (
                          <ToggleRight className="w-6 h-6 text-brand-purple" />
                        ) : (
                          <ToggleLeft className="w-6 h-6 text-slate-500" />
                        )}
                      </button>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-white mb-2 leading-tight">{camp.title}</h3>
                  <p className="text-[10px] text-brand-purple font-bold uppercase tracking-widest -mt-1 mb-2">
                    {camp.brand_name}
                    {isCampaignExpired(camp) && <span className="ml-2 text-red-400">· Applications closed</span>}
                    {!camp.is_active && <span className="ml-2 text-slate-400">· Inactive</span>}
                  </p>
                  <p className="text-xs text-slate-400 line-clamp-3 mb-4 leading-relaxed">{camp.description}</p>

                  {(camp.location || camp.campaign_date || camp.application_deadline || camp.models_required) && (
                    <div className="grid grid-cols-1 gap-1 text-[11px] text-slate-400 mb-4">
                      {camp.location && <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-brand-purple" /> {camp.location}</span>}
                      {camp.campaign_date && (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-brand-purple" /> {camp.campaign_date}
                          {camp.start_time && ` · ${camp.start_time}${camp.end_time ? `–${camp.end_time}` : ""}`}
                        </span>
                      )}
                      {camp.application_deadline && <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-brand-pink" /> Deadline {camp.application_deadline}</span>}
                      {camp.models_required ? <span className="flex items-center gap-1.5"><Users className="w-3 h-3 text-brand-purple" /> {camp.models_required} model(s) required</span> : null}
                    </div>
                  )}

                  {camp.target_size === "Custom Size" && camp.custom_measurements && (
                    <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/5 text-[10px] space-y-1 mb-4">
                      <span className="block font-bold text-slate-500 uppercase tracking-wider mb-1">Custom Sizing Specifications</span>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-400">
                        {Object.entries(camp.custom_measurements).map(([name, val]) => (
                          <div key={name} className="flex justify-between border-b border-white/[0.02] pb-0.5">
                            <span className="capitalize">{name.replace(/_/g, " ")}:</span>
                            <span className="font-semibold text-slate-200">{val} cm</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3.5 border-t border-white/5 pt-4 mt-auto">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Height Span:</span>
                    <span className="font-semibold text-slate-200">
                      {camp.min_height} - {camp.max_height} cm
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Target Category:</span>
                    <span className="font-semibold text-slate-200 capitalize">{camp.target_gender}</span>
                  </div>
                  {(camp.min_age || camp.max_age) ? (
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Age Range:</span>
                      <span className="font-semibold text-slate-200">{camp.min_age ?? "any"} - {camp.max_age ?? "any"}</span>
                    </div>
                  ) : null}
                  {camp.compensation && (
                    <div className="flex justify-between gap-3 text-[11px] text-slate-400">
                      <span>Compensation:</span>
                      <span className="font-semibold text-slate-200 text-right">{camp.compensation}</span>
                    </div>
                  )}
                  
                  {/* Required specifications bubble badges */}
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                      Required Segment Metrics
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {camp.required_measurements.map((m) => (
                        <span key={m} className="text-[9px] px-2 py-0.5 rounded-lg bg-slate-900 text-slate-300 border border-white/5 capitalize">
                          {m.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* New Campaign Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-card max-w-2xl w-full rounded-3xl border border-white/10 shadow-2xl relative p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/5 pb-4 mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-1.5">
                {editingId ? (
                  <Pencil className="w-5 h-5 text-brand-purple" />
                ) : (
                  <Sparkles className="w-5 h-5 text-brand-purple" />
                )}
                {editingId ? "Edit Casting Campaign" : "Establish Casting Campaign"}
              </h2>
              <button
                onClick={handleCloseModal}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg border border-white/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Campaign Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                  placeholder="e.g. Milan Fall Runway 2026"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="glass-input px-3 py-2 w-full rounded-xl text-xs min-h-[80px]"
                  placeholder="Outline casting goals, collection specs, brand alignment guidelines..."
                />
              </div>

              {/* Brand, banner & logistics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Brand Name</label>
                  <input
                    type="text"
                    required
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                    placeholder="e.g. Gucci"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign Location</label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                    placeholder="e.g. Milan, Italy"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign / Banner Image</label>
                <div className="flex flex-col sm:flex-row gap-3 items-start">
                  {imageUrl ? (
                    <div className="relative w-full sm:w-40 h-24 rounded-xl overflow-hidden border border-white/10 shrink-0">
                      <img src={imageUrl} alt="Banner preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImageUrl("")}
                        className="absolute top-1 right-1 p-1 rounded-lg bg-slate-950/80 text-slate-300 hover:text-white cursor-pointer"
                        title="Remove image"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="w-full sm:w-40 h-24 rounded-xl border-2 border-dashed border-white/10 hover:border-brand-purple/40 flex flex-col items-center justify-center text-[10px] text-slate-500 cursor-pointer shrink-0">
                      <ImagePlus className="w-5 h-5 mb-1" /> Upload image
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageFile(e.target.files?.[0])} />
                    </label>
                  )}
                  <input
                    type="url"
                    value={imageUrl.startsWith("data:") ? "" : imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                    placeholder={imageUrl.startsWith("data:") ? "Uploaded image selected" : "…or paste an image URL (https://…)"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign Date</label>
                  <input
                    type="date"
                    required
                    value={campaignDate}
                    onChange={(e) => setCampaignDate(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Application Deadline</label>
                  <input
                    type="date"
                    required
                    value={applicationDeadline}
                    onChange={(e) => setApplicationDeadline(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Models Required</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={modelsRequired}
                    onChange={(e) => setModelsRequired(Number(e.target.value))}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs text-center"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Min Age</label>
                  <input
                    type="number"
                    min={13}
                    max={100}
                    value={minAge}
                    onChange={(e) => setMinAge(e.target.value === "" ? "" : Number(e.target.value))}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs text-center"
                    placeholder="Any"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Max Age</label>
                  <input
                    type="number"
                    min={13}
                    max={100}
                    value={maxAge}
                    onChange={(e) => setMaxAge(e.target.value === "" ? "" : Number(e.target.value))}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs text-center"
                    placeholder="Any"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* Gender */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Gender</label>
                  <select
                    value={targetGender}
                    onChange={(e) => setTargetGender(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    <option value="female" className="bg-slate-950">Female</option>
                    <option value="male" className="bg-slate-950">Male</option>
                    <option value="unisex" className="bg-slate-950">Unisex</option>
                  </select>
                </div>

                {/* Target Size */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Target Size</label>
                  <select
                    value={targetSize}
                    onChange={(e) => setTargetSize(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    {["XXS", "XS", "S", "M", "L", "XL", "XXL", "Custom Size"].map((sz) => (
                      <option key={sz} value={sz} className="bg-slate-950">{sz}</option>
                    ))}
                  </select>
                </div>

                {/* Min Height */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Min Height (cm)</label>
                  <input
                    type="number"
                    required
                    value={minHeight}
                    onChange={(e) => setMinHeight(Number(e.target.value))}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* Max Height Constraint */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Max Height (cm)</label>
                  <input
                    type="number"
                    required
                    value={maxHeight}
                    onChange={(e) => setMaxHeight(Number(e.target.value))}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs text-center"
                  />
                </div>

                {/* Clothing Type */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Clothing Type</label>
                  <select
                    value={clothingType}
                    onChange={(e) => setClothingType(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    <option value="T-shirts/Shirts" className="bg-slate-950">T-shirts/Shirts</option>
                    <option value="Bottoms/Pants" className="bg-slate-950">Bottoms/Pants</option>
                  </select>
                </div>
              </div>

              {/* Custom Size Fields */}
              {targetSize === "Custom Size" && (
                <div className="space-y-4 p-4 bg-slate-900/40 rounded-2xl border border-white/5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Target Body Measurements (cm)</label>
                    {clothingType === "T-shirts/Shirts" ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Chest</label>
                          <input
                            type="number"
                            required
                            value={customChest}
                            onChange={(e) => setCustomChest(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Waist</label>
                          <input
                            type="number"
                            required
                            value={customWaist}
                            onChange={(e) => setCustomWaist(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Abdomen</label>
                          <input
                            type="number"
                            required
                            value={customAbdomen}
                            onChange={(e) => setCustomAbdomen(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Left Arm</label>
                          <input
                            type="number"
                            required
                            value={customLeftArm}
                            onChange={(e) => setCustomLeftArm(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Right Arm</label>
                          <input
                            type="number"
                            required
                            value={customRightArm}
                            onChange={(e) => setCustomRightArm(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Shoulder Width</label>
                          <input
                            type="number"
                            required
                            value={customShoulderWidth}
                            onChange={(e) => setCustomShoulderWidth(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Waist</label>
                          <input
                            type="number"
                            required
                            value={customWaist}
                            onChange={(e) => setCustomWaist(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Hip</label>
                          <input
                            type="number"
                            required
                            value={customHip}
                            onChange={(e) => setCustomHip(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Left Thigh</label>
                          <input
                            type="number"
                            required
                            value={customLeftThigh}
                            onChange={(e) => setCustomLeftThigh(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">Right Thigh</label>
                          <input
                            type="number"
                            required
                            value={customRightThigh}
                            onChange={(e) => setCustomRightThigh(Number(e.target.value))}
                            className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Checkboxes for required measurements */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">
                  Required Anatomy Specifications
                </label>
                <div className="grid grid-cols-2 gap-2 p-3.5 bg-slate-900/40 rounded-2xl border border-white/5">
                  {availableMeasurements.map((measure) => (
                    <label key={measure} className="flex items-center gap-2 text-xs text-slate-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requiredMeasurements.includes(measure)}
                        onChange={() => handleCheckboxChange(measure)}
                        className="h-4 w-4 rounded bg-slate-900 border-white/10 text-brand-purple focus:ring-brand-purple/50 accent-brand-purple cursor-pointer"
                      />
                      <span className="capitalize">{measure.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Instructions, compensation & contact */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Campaign Instructions</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="glass-input px-3 py-2 w-full rounded-xl text-xs min-h-[60px]"
                  placeholder="What to wear, what to bring, arrival details..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Payment / Compensation</label>
                  <input
                    type="text"
                    required
                    value={compensation}
                    onChange={(e) => setCompensation(e.target.value)}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                    placeholder="e.g. €800 per day + travel"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Contact Information</label>
                  <input
                    type="text"
                    required
                    value={contactInfo}
                    onChange={(e) => setContactInfo(e.target.value)}
                    className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                    placeholder="e.g. casting@brand.com, +39 02 000 0000"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/40 border border-white/5 text-xs text-slate-300 cursor-pointer select-none">
                <span>
                  <span className="font-semibold">Campaign status: {isActive ? "Active" : "Inactive"}</span>
                  <span className="block text-[10px] text-slate-500">Active campaigns are visible to models until the application deadline.</span>
                </span>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded accent-brand-purple cursor-pointer"
                />
              </label>

              {formError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2.5 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-3.5 rounded-xl border border-white/5 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-bold text-xs hover:opacity-90 cursor-pointer shadow-md"
                >
                  {formLoading ? (
                    <div className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                  ) : editingId ? (
                    "Save Changes"
                  ) : (
                    "Publish Campaign"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
