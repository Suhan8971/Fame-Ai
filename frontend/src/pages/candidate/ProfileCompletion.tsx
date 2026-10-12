import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { getProfileRequirements } from "../../services/recruitmentRules";
import { NotificationsPanel } from "../../components/common/NotificationsPanel";
import { CandidateStatusBadge } from "../../components/candidate/CandidateStatusBadge";
import type { Application, Prediction } from "../../types";
import { ArrowRight, User, Sliders, Mail, CheckCircle2, Circle, Ruler, Layers, Megaphone, Camera } from "lucide-react";

export const ProfileCompletion: React.FC = () => {
  const { user, profile, updateProfile } = useAuth();
  const navigate = useNavigate();

  // Recruitment workflow: latest scan, applications and measurement confirmation
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [measurementsConfirmed, setMeasurementsConfirmed] = useState(false);

  const loadWorkflowData = useCallback(async () => {
    if (!user) return;
    const [pred, apps] = await Promise.all([api.getLatestPrediction(user.id), api.getCandidateApplications(user.id)]);
    setPrediction(pred);
    setApplications(apps);
  }, [user]);

  useEffect(() => {
    loadWorkflowData();
  }, [loadWorkflowData]);

  // A new candidate's own fields start blank ("") -- not pre-filled with
  // another model's or a shared demo's values -- until this account's saved
  // profile (if any) loads in the sync effect below, or the model types
  // their own values in.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [height, setHeight] = useState<number | "">(""); // stored in cm
  const [weight, setWeight] = useState<number | "">("");  // stored in kg
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [phone, setPhone] = useState("");

  // New anatomical fields (in cm)
  const [chest, setChest] = useState<number | "">("");
  const [shoulder, setShoulder] = useState<number | "">("");
  const [leftArm, setLeftArm] = useState<number | "">("");
  const [rightArm, setRightArm] = useState<number | "">("");
  const [abdomen, setAbdomen] = useState<number | "">("");
  const [waist, setWaist] = useState<number | "">("");
  const [hips, setHips] = useState<number | "">("");
  const [leftThigh, setLeftThigh] = useState<number | "">("");
  const [rightThigh, setRightThigh] = useState<number | "">("");

  // Imperial units states
  const [heightFt, setHeightFt] = useState<number | "">("");
  const [heightIn, setHeightIn] = useState<number | "">("");
  const [weightLbs, setWeightLbs] = useState<number | "">("");

  const [chestIn, setChestIn] = useState<number | "">("");
  const [shoulderIn, setShoulderIn] = useState<number | "">("");
  const [leftArmIn, setLeftArmIn] = useState<number | "">("");
  const [rightArmIn, setRightArmIn] = useState<number | "">("");
  const [abdomenIn, setAbdomenIn] = useState<number | "">("");
  const [waistIn, setWaistIn] = useState<number | "">("");
  const [hipsIn, setHipsIn] = useState<number | "">("");
  const [leftThighIn, setLeftThighIn] = useState<number | "">("");
  const [rightThighIn, setRightThighIn] = useState<number | "">("");

  // cm <-> in helpers that preserve "blank" instead of turning it into 0.
  const cmToIn = (cm: number | ""): number | "" => (cm === "" ? "" : Math.round((cm / 2.54) * 10) / 10);
  const inToCm = (inches: number | ""): number | "" => (inches === "" ? "" : Math.round(inches * 2.54 * 10) / 10);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Sync state with this account's own saved profile. A brand-new profile
  // (see defaultProfile() in AuthContext) has every one of these fields
  // null/"", so a new user correctly sees blank inputs here, not another
  // user's or a shared demo's numbers.
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setGender(profile.gender || "");
      setBirthDate(profile.birth_date || "");
      setHeight(profile.height ?? "");
      setWeight(profile.weight ?? "");
      setUnits(profile.preferred_units || "metric");
      setPhone(profile.phone_number || "");
      setMeasurementsConfirmed(!!profile.measurements_confirmed_at);

      // Setup measurements
      const ch = profile.chest ?? "";
      const sh = profile.shoulder ?? "";
      const la = profile.left_arm ?? "";
      const ra = profile.right_arm ?? "";
      const ab = profile.abdomen ?? "";
      const wa = profile.waist ?? "";
      const hp = profile.hips ?? "";
      const lt = profile.left_thigh ?? "";
      const rt = profile.right_thigh ?? "";

      setChest(ch);
      setShoulder(sh);
      setLeftArm(la);
      setRightArm(ra);
      setAbdomen(ab);
      setWaist(wa);
      setHips(hp);
      setLeftThigh(lt);
      setRightThigh(rt);

      // Initial conversion for imperial (blank stays blank)
      const cm = profile.height ?? "";
      const kg = profile.weight ?? "";

      if (cm !== "") {
        const totalInches = cm / 2.54;
        setHeightFt(Math.floor(totalInches / 12));
        setHeightIn(Math.round(totalInches % 12));
      } else {
        setHeightFt("");
        setHeightIn("");
      }
      setWeightLbs(kg === "" ? "" : Math.round(kg * 2.20462));

      setChestIn(cmToIn(ch));
      setShoulderIn(cmToIn(sh));
      setLeftArmIn(cmToIn(la));
      setRightArmIn(cmToIn(ra));
      setAbdomenIn(cmToIn(ab));
      setWaistIn(cmToIn(wa));
      setHipsIn(cmToIn(hp));
      setLeftThighIn(cmToIn(lt));
      setRightThighIn(cmToIn(rt));
    }
  }, [profile]);

  // Handle Conversions when units system changes (blank fields stay blank)
  const handleUnitChange = (newUnits: "metric" | "imperial") => {
    setUnits(newUnits);
    if (newUnits === "imperial") {
      // CM -> Feet & Inches
      if (height !== "") {
        const totalInches = height / 2.54;
        setHeightFt(Math.floor(totalInches / 12));
        setHeightIn(Math.round(totalInches % 12));
      } else {
        setHeightFt("");
        setHeightIn("");
      }
      // KG -> Lbs
      setWeightLbs(weight === "" ? "" : Math.round(weight * 2.20462));

      // CM -> Inches
      setChestIn(cmToIn(chest));
      setShoulderIn(cmToIn(shoulder));
      setLeftArmIn(cmToIn(leftArm));
      setRightArmIn(cmToIn(rightArm));
      setAbdomenIn(cmToIn(abdomen));
      setWaistIn(cmToIn(waist));
      setHipsIn(cmToIn(hips));
      setLeftThighIn(cmToIn(leftThigh));
      setRightThighIn(cmToIn(rightThigh));
    } else {
      // Imperial -> Metric
      if (heightFt !== "" && heightIn !== "") {
        setHeight(Math.round((heightFt * 12 + heightIn) * 2.54 * 10) / 10);
      }
      setWeight(weightLbs === "" ? "" : Math.round((weightLbs / 2.20462) * 10) / 10);

      setChest(inToCm(chestIn));
      setShoulder(inToCm(shoulderIn));
      setLeftArm(inToCm(leftArmIn));
      setRightArm(inToCm(rightArmIn));
      setAbdomen(inToCm(abdomenIn));
      setWaist(inToCm(waistIn));
      setHips(inToCm(hipsIn));
      setLeftThigh(inToCm(leftThighIn));
      setRightThigh(inToCm(rightThighIn));
    }
  };

  const handleHeightImperialChange = (ft: number | "", inches: number | "") => {
    setHeightFt(ft);
    setHeightIn(inches);
    if (ft !== "" && inches !== "") {
      setHeight(Math.round((ft * 12 + inches) * 2.54 * 10) / 10);
    }
  };

  const handleWeightImperialChange = (lbs: number | "") => {
    setWeightLbs(lbs);
    setWeight(lbs === "" ? "" : Math.round((lbs / 2.20462) * 10) / 10);
  };

  // Dual unit update helpers for form inputs. Each takes the raw input
  // string so clearing a field (empty string) stays blank instead of
  // becoming 0.
  const makeValHandlers = (setMetric: (v: number | "") => void, setImperial: (v: number | "") => void) => ({
    onMetricChange: (raw: string) => {
      const v: number | "" = raw === "" ? "" : Number(raw);
      setMetric(v);
      setImperial(cmToIn(v));
    },
    onImperialChange: (raw: string) => {
      const v: number | "" = raw === "" ? "" : Number(raw);
      setImperial(v);
      setMetric(inToCm(v));
    }
  });

  const chestHandlers = makeValHandlers(setChest, setChestIn);
  const shoulderHandlers = makeValHandlers(setShoulder, setShoulderIn);
  const leftArmHandlers = makeValHandlers(setLeftArm, setLeftArmIn);
  const rightArmHandlers = makeValHandlers(setRightArm, setRightArmIn);
  const abdomenHandlers = makeValHandlers(setAbdomen, setAbdomenIn);
  const waistHandlers = makeValHandlers(setWaist, setWaistIn);
  const hipsHandlers = makeValHandlers(setHips, setHipsIn);
  const leftThighHandlers = makeValHandlers(setLeftThigh, setLeftThighIn);
  const rightThighHandlers = makeValHandlers(setRightThigh, setRightThighIn);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // All of these inputs are HTML-required, so a genuine submit always
      // has real numbers -- "" (unset) only survives here if validation was
      // bypassed, in which case it's saved as null rather than a stray "".
      const n = (v: number | ""): number | null => (v === "" ? null : v);
      const nowStamp = new Date().toISOString();
      await updateProfile({
        email: user?.email,
        profile_confirmed_at: nowStamp,
        // Measurements only count once the model explicitly confirms them
        measurements_confirmed_at: measurementsConfirmed ? profile?.measurements_confirmed_at || nowStamp : null,
        first_name: firstName,
        last_name: lastName,
        gender,
        birth_date: birthDate,
        height: n(height),
        weight: n(weight),
        preferred_units: units,
        phone_number: phone,
        chest: n(chest),
        shoulder: n(shoulder),
        left_arm: n(leftArm),
        right_arm: n(rightArm),
        abdomen: n(abdomen),
        waist: n(waist),
        hips: n(hips),
        left_thigh: n(leftThigh),
        right_thigh: n(rightThigh),
      });
      setMessage("Profile details saved successfully.");
      // New models continue to the scan; models who already scanned stay here
      if (!prediction) {
        setTimeout(() => {
          navigate("/candidate/guidelines");
        }, 800);
      }
    } catch (err: any) {
      setMessage("Failed to update profile: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="glass-card p-8 rounded-3xl border border-white/5 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/10 rounded-full blur-3xl pointer-events-none" />

        <div className="mb-8 border-b border-white/5 pb-4">
          <h1 className="text-3xl font-bold tracking-tight text-white">Complete Audition Profile</h1>
          <p className="text-sm text-slate-400 mt-1">
            Provide baseline details and manual specifications to align fit evaluation engines.
          </p>
        </div>

        {/* Mandatory before applying to campaigns */}
        {(() => {
          const requirements = getProfileRequirements(user, profile, prediction);
          const done = requirements.filter((r) => r.done).length;
          return (
            <div className="mb-6 p-4 rounded-2xl bg-slate-900/50 border border-white/5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Profile completion</span>
                <span className={`text-xs font-bold ${done === requirements.length ? "text-green-400" : "text-yellow-400"}`}>
                  {done === requirements.length ? "Ready to apply" : `${done} / ${requirements.length} complete`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {requirements.map((r) => (
                  <span key={r.key} className={`flex items-center gap-1.5 text-[11px] ${r.done ? "text-slate-300" : "text-slate-500"}`}>
                    {r.done ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Circle className="w-3.5 h-3.5 text-slate-600" />}
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {message && (
          <div className={`p-4 mb-6 rounded-xl text-sm border ${
            message.includes("saved") 
              ? "bg-green-500/10 border-green-500/20 text-green-200" 
              : "bg-red-500/10 border-red-500/20 text-red-200"
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Unit Toggle */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/50 border border-white/5">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider pl-2">
              Units Calibration System
            </span>
            <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => handleUnitChange("metric")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  units === "metric" ? "bg-brand-purple text-white shadow" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Metric (cm / kg)
              </button>
              <button
                type="button"
                onClick={() => handleUnitChange("imperial")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  units === "imperial" ? "bg-brand-purple text-white shadow" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Imperial (ft / lbs / in)
              </button>
            </div>
          </div>

          {/* Section: General Info */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-brand-purple" /> General Information
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Email (from the signed-in account) */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Email (account)</label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={user?.email || ""}
                    readOnly
                    className="glass-input pl-9 pr-3.5 py-2.5 w-full rounded-xl text-xs text-slate-400 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* First Name */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="Jane"
                />
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="Doe"
                />
              </div>

              {/* Gender Category */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Gender / Audition Category</label>
                <select
                  required
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs cursor-pointer select-none"
                >
                  <option value="" disabled className="bg-slate-950">Select Gender</option>
                  <option value="female" className="bg-slate-950">Female</option>
                  <option value="male" className="bg-slate-950">Male</option>
                  <option value="non-binary" className="bg-slate-950">Non-Binary</option>
                </select>
              </div>

              {/* Birth Date */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Birth Date</label>
                <input
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                />
              </div>

              {/* Height Entry */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Height {units === "metric" ? "(cm)" : "(ft / in)"}
                </label>
                {units === "metric" ? (
                  <div className="relative">
                    <input
                      type="number"
                      required
                      min={120}
                      max={250}
                      value={height}
                      onChange={(e) => setHeight(e.target.value === "" ? "" : Number(e.target.value))}
                      className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 text-[10px] font-bold select-none">
                      cm
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min={3}
                        max={8}
                        value={heightFt}
                        onChange={(e) => handleHeightImperialChange(e.target.value === "" ? "" : Number(e.target.value), heightIn)}
                        className="glass-input py-2.5 w-full rounded-xl text-xs text-center font-semibold"
                      />
                      <div className="absolute inset-y-0 right-3.5 flex items-center text-[10px] text-slate-500 font-bold">ft</div>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min={0}
                        max={11}
                        value={heightIn}
                        onChange={(e) => handleHeightImperialChange(heightFt, e.target.value === "" ? "" : Number(e.target.value))}
                        className="glass-input py-2.5 w-full rounded-xl text-xs text-center font-semibold"
                      />
                      <div className="absolute inset-y-0 right-3.5 flex items-center text-[10px] text-slate-500 font-bold">in</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Weight Entry */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Weight {units === "metric" ? "(kg)" : "(lbs)"}
                </label>
                <div className="relative">
                  {units === "metric" ? (
                    <>
                      <input
                        type="number"
                        required
                        min={30}
                        max={200}
                        value={weight}
                        onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
                        className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                      />
                      <div className="absolute inset-y-0 right-3.5 flex items-center text-slate-500 text-[10px] font-bold select-none">
                        kg
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        type="number"
                        required
                        min={60}
                        max={450}
                        value={weightLbs}
                        onChange={(e) => handleWeightImperialChange(e.target.value === "" ? "" : Number(e.target.value))}
                        className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                      />
                      <div className="absolute inset-y-0 right-3.5 flex items-center text-slate-500 text-[10px] font-bold select-none">
                        lbs
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Phone */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
          </div>

          {/* Section: Anatomical Specifications */}
          <div className="space-y-4 border-t border-white/5 pt-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-brand-purple" /> Anatomical Specifications (cm / inches)
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Chest */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Chest</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? chest : chestIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? chestHandlers.onMetricChange(e.target.value)
                        : chestHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Shoulder */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Shoulder Width</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? shoulder : shoulderIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? shoulderHandlers.onMetricChange(e.target.value)
                        : shoulderHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Waist */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Waist</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? waist : waistIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? waistHandlers.onMetricChange(e.target.value)
                        : waistHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Left Arm */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Left Arm</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? leftArm : leftArmIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? leftArmHandlers.onMetricChange(e.target.value)
                        : leftArmHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Right Arm */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Right Arm</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? rightArm : rightArmIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? rightArmHandlers.onMetricChange(e.target.value)
                        : rightArmHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Abdomen */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Abdomen</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? abdomen : abdomenIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? abdomenHandlers.onMetricChange(e.target.value)
                        : abdomenHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Hips */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Hips</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? hips : hipsIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? hipsHandlers.onMetricChange(e.target.value)
                        : hipsHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Left Thigh */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Left Thigh</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? leftThigh : leftThighIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? leftThighHandlers.onMetricChange(e.target.value)
                        : leftThighHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>

              {/* Right Thigh */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Right Thigh</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={units === "metric" ? rightThigh : rightThighIn}
                    onChange={(e) => 
                      units === "metric" 
                        ? rightThighHandlers.onMetricChange(e.target.value)
                        : rightThighHandlers.onImperialChange(e.target.value)
                    }
                    className="glass-input px-3.5 py-2 w-full rounded-xl text-xs text-center font-medium"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 font-bold select-none">
                    {units === "metric" ? "cm" : "in"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Explicit confirmation: pre-filled defaults never count as the model's measurements */}
          <label className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-slate-900/50 border border-white/5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={measurementsConfirmed}
              onChange={(e) => setMeasurementsConfirmed(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded accent-brand-purple cursor-pointer"
            />
            <span>
              I confirm these body measurements are my own.
              <span className="block text-[10px] text-slate-500 mt-0.5">
                Required before you can apply to campaigns. The values above start as placeholders until you confirm them.
              </span>
            </span>
          </label>

          <div className="pt-4 border-t border-white/5">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-purple to-brand-pink hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-purple-500/10"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Save & Continue Audition <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Latest scan measurements */}
      <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4 mt-6">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Ruler className="w-5 h-5 text-brand-purple" />
            Latest Scan Measurements
          </h3>
          <button
            type="button"
            onClick={() => navigate("/candidate/upload")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" /> {prediction ? "Rescan" : "Start 4-view scan"}
          </button>
        </div>
        {prediction ? (
          <>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
              <span>Scanned {new Date(prediction.completed_at || prediction.created_at).toLocaleDateString()}</span>
              <span>Size: <strong className="text-slate-200">{prediction.predicted_size}</strong></span>
              {prediction.confidence_score !== undefined && (
                <span>Confidence: <strong className="text-slate-200">{prediction.confidence_score}%</strong></span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(prediction.measurements)
                .filter((entry): entry is [string, number] => typeof entry[1] === "number")
                .map(([name, val]) => (
                  <div key={name} className="p-2.5 bg-slate-950/50 rounded-xl border border-white/5 flex justify-between text-xs">
                    <span className="text-slate-400 capitalize">{name.replace(/_/g, " ")}</span>
                    <span className="text-slate-200 font-bold">{Math.round(val * 10) / 10} cm</span>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500 text-center py-4">No body scan yet. A completed 4-view scan is required to apply.</p>
        )}
      </div>

      {/* Applied campaigns */}
      <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4 mt-6">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-purple" />
            My Applications
          </h3>
          <button
            type="button"
            onClick={() => navigate("/candidate/campaigns")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer"
          >
            <Megaphone className="w-3.5 h-3.5" /> Casting Calls
          </button>
        </div>
        {applications.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">You haven't applied to any campaigns yet.</p>
        ) : (
          <div className="space-y-2">
            {applications.map((app) => (
              <div key={app.id} className="p-3.5 bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">{app.campaign_title}</h4>
                  <span className="text-[10px] text-slate-500">Applied {new Date(app.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400">Fit score: <strong className="text-slate-200">{app.overall_fit_score}%</strong></span>
                  <CandidateStatusBadge app={app} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {user && (
        <div className="mt-6">
          <NotificationsPanel userId={user.id} onChange={loadWorkflowData} />
        </div>
      )}
    </div>
  );
};
