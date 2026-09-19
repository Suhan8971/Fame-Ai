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

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("female");
  const [birthDate, setBirthDate] = useState("");
  const [height, setHeight] = useState(175); // stored in cm
  const [weight, setWeight] = useState(60);  // stored in kg
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [phone, setPhone] = useState("");

  // New anatomical fields (in cm)
  const [chest, setChest] = useState(90);
  const [shoulder, setShoulder] = useState(42);
  const [leftArm, setLeftArm] = useState(60);
  const [rightArm, setRightArm] = useState(60);
  const [abdomen, setAbdomen] = useState(74);
  const [waist, setWaist] = useState(66);
  const [hips, setHips] = useState(94);
  const [leftThigh, setLeftThigh] = useState(52);
  const [rightThigh, setRightThigh] = useState(52);

  // Imperial units states
  const [heightFt, setHeightFt] = useState(5);
  const [heightIn, setHeightIn] = useState(9);
  const [weightLbs, setWeightLbs] = useState(132);
  
  const [chestIn, setChestIn] = useState(35.4);
  const [shoulderIn, setShoulderIn] = useState(16.5);
  const [leftArmIn, setLeftArmIn] = useState(23.6);
  const [rightArmIn, setRightArmIn] = useState(23.6);
  const [abdomenIn, setAbdomenIn] = useState(29.1);
  const [waistIn, setWaistIn] = useState(26.0);
  const [hipsIn, setHipsIn] = useState(37.0);
  const [leftThighIn, setLeftThighIn] = useState(20.5);
  const [rightThighIn, setRightThighIn] = useState(20.5);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Sync state with existing profile
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setGender(profile.gender || "female");
      setBirthDate(profile.birth_date || "");
      setHeight(Number(profile.height) || 175);
      setWeight(Number(profile.weight) || 60);
      setUnits(profile.preferred_units || "metric");
      setPhone(profile.phone_number || "");
      setMeasurementsConfirmed(!!profile.measurements_confirmed_at);

      // Setup measurements
      const ch = Number(profile.chest) || 90;
      const sh = Number(profile.shoulder) || 42;
      const la = Number(profile.left_arm) || 60;
      const ra = Number(profile.right_arm) || 60;
      const ab = Number(profile.abdomen) || 74;
      const wa = Number(profile.waist) || 66;
      const hp = Number(profile.hips) || 94;
      const lt = Number(profile.left_thigh) || 52;
      const rt = Number(profile.right_thigh) || 52;

      setChest(ch);
      setShoulder(sh);
      setLeftArm(la);
      setRightArm(ra);
      setAbdomen(ab);
      setWaist(wa);
      setHips(hp);
      setLeftThigh(lt);
      setRightThigh(rt);

      // Initial conversion for imperial
      const cm = Number(profile.height) || 175;
      const kg = Number(profile.weight) || 60;
      
      const totalInches = cm / 2.54;
      setHeightFt(Math.floor(totalInches / 12));
      setHeightIn(Math.round(totalInches % 12));
      setWeightLbs(Math.round(kg * 2.20462));

      setChestIn(Math.round(ch / 2.54 * 10) / 10);
      setShoulderIn(Math.round(sh / 2.54 * 10) / 10);
      setLeftArmIn(Math.round(la / 2.54 * 10) / 10);
      setRightArmIn(Math.round(ra / 2.54 * 10) / 10);
      setAbdomenIn(Math.round(ab / 2.54 * 10) / 10);
      setWaistIn(Math.round(wa / 2.54 * 10) / 10);
      setHipsIn(Math.round(hp / 2.54 * 10) / 10);
      setLeftThighIn(Math.round(lt / 2.54 * 10) / 10);
      setRightThighIn(Math.round(rt / 2.54 * 10) / 10);
    }
  }, [profile]);

  // Handle Conversions when units system changes
  const handleUnitChange = (newUnits: "metric" | "imperial") => {
    setUnits(newUnits);
    if (newUnits === "imperial") {
      // CM -> Feet & Inches
      const totalInches = height / 2.54;
      setHeightFt(Math.floor(totalInches / 12));
      setHeightIn(Math.round(totalInches % 12));
      // KG -> Lbs
      setWeightLbs(Math.round(weight * 2.20462));

      // CM -> Inches
      setChestIn(Math.round(chest / 2.54 * 10) / 10);
      setShoulderIn(Math.round(shoulder / 2.54 * 10) / 10);
      setLeftArmIn(Math.round(leftArm / 2.54 * 10) / 10);
      setRightArmIn(Math.round(rightArm / 2.54 * 10) / 10);
      setAbdomenIn(Math.round(abdomen / 2.54 * 10) / 10);
      setWaistIn(Math.round(waist / 2.54 * 10) / 10);
      setHipsIn(Math.round(hips / 2.54 * 10) / 10);
      setLeftThighIn(Math.round(leftThigh / 2.54 * 10) / 10);
      setRightThighIn(Math.round(rightThigh / 2.54 * 10) / 10);
    } else {
      // Imperial -> Metric
      const cmVal = Math.round((heightFt * 12 + heightIn) * 2.54 * 10) / 10;
      const kgVal = Math.round((weightLbs / 2.20462) * 10) / 10;
      setHeight(cmVal);
      setWeight(kgVal);

      setChest(Math.round(chestIn * 2.54 * 10) / 10);
      setShoulder(Math.round(shoulderIn * 2.54 * 10) / 10);
      setLeftArm(Math.round(leftArmIn * 2.54 * 10) / 10);
      setRightArm(Math.round(rightArmIn * 2.54 * 10) / 10);
      setAbdomen(Math.round(abdomenIn * 2.54 * 10) / 10);
      setWaist(Math.round(waistIn * 2.54 * 10) / 10);
      setHips(Math.round(hipsIn * 2.54 * 10) / 10);
      setLeftThigh(Math.round(leftThighIn * 2.54 * 10) / 10);
      setRightThigh(Math.round(rightThighIn * 2.54 * 10) / 10);
    }
  };

  const handleHeightImperialChange = (ft: number, inches: number) => {
    setHeightFt(ft);
    setHeightIn(inches);
    const cmVal = Math.round((ft * 12 + inches) * 2.54 * 10) / 10;
    setHeight(cmVal);
  };

  const handleWeightImperialChange = (lbs: number) => {
    setWeightLbs(lbs);
    const kgVal = Math.round((lbs / 2.20462) * 10) / 10;
    setWeight(kgVal);
  };

  // Dual unit update helpers for form inputs
  const makeValHandlers = (setMetric: (v: number) => void, setImperial: (v: number) => void) => ({
    onMetricChange: (v: number) => {
      setMetric(v);
      setImperial(Math.round(v / 2.54 * 10) / 10);
    },
    onImperialChange: (v: number) => {
      setImperial(v);
      setMetric(Math.round(v * 2.54 * 10) / 10);
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
        height,
        weight,
        preferred_units: units,
        phone_number: phone,
        chest,
        shoulder,
        left_arm: leftArm,
        right_arm: rightArm,
        abdomen,
        waist,
        hips,
        left_thigh: leftThigh,
        right_thigh: rightThigh,
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
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs cursor-pointer select-none"
                >
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
                      onChange={(e) => setHeight(Number(e.target.value))}
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
                        onChange={(e) => handleHeightImperialChange(Number(e.target.value), heightIn)}
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
                        onChange={(e) => handleHeightImperialChange(heightFt, Number(e.target.value))}
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
                        onChange={(e) => setWeight(Number(e.target.value))}
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
                        onChange={(e) => handleWeightImperialChange(Number(e.target.value))}
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
                        ? chestHandlers.onMetricChange(Number(e.target.value))
                        : chestHandlers.onImperialChange(Number(e.target.value))
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
                        ? shoulderHandlers.onMetricChange(Number(e.target.value))
                        : shoulderHandlers.onImperialChange(Number(e.target.value))
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
                        ? waistHandlers.onMetricChange(Number(e.target.value))
                        : waistHandlers.onImperialChange(Number(e.target.value))
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
                        ? leftArmHandlers.onMetricChange(Number(e.target.value))
                        : leftArmHandlers.onImperialChange(Number(e.target.value))
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
                        ? rightArmHandlers.onMetricChange(Number(e.target.value))
                        : rightArmHandlers.onImperialChange(Number(e.target.value))
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
                        ? abdomenHandlers.onMetricChange(Number(e.target.value))
                        : abdomenHandlers.onImperialChange(Number(e.target.value))
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
                        ? hipsHandlers.onMetricChange(Number(e.target.value))
                        : hipsHandlers.onImperialChange(Number(e.target.value))
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
                        ? leftThighHandlers.onMetricChange(Number(e.target.value))
                        : leftThighHandlers.onImperialChange(Number(e.target.value))
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
                        ? rightThighHandlers.onMetricChange(Number(e.target.value))
                        : rightThighHandlers.onImperialChange(Number(e.target.value))
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
