import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight } from "lucide-react";

// Shown wherever a model could apply while their profile is incomplete.
export const ProfileRequirementNotice: React.FC<{ missing: string[]; compact?: boolean }> = ({ missing, compact }) => {
  const navigate = useNavigate();
  if (missing.length === 0) return null;
  const needsScan = missing.includes("Completed 4-view body scan");
  const onlyScan = needsScan && missing.length === 1;

  return (
    <div className={`rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-100 text-xs ${compact ? "p-3" : "p-4"}`}>
      <h4 className="font-bold flex items-center gap-1.5 text-yellow-300">
        <AlertCircle className="w-4 h-4" /> Complete your profile to apply
      </h4>
      <p className="text-slate-300 mt-1.5">Applications open once these are done:</p>
      <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-200">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 mt-3">
        {!onlyScan && (
          <button
            type="button"
            onClick={() => navigate("/candidate/profile")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-slate-950 font-bold hover:bg-slate-200 cursor-pointer"
          >
            Go to Profile <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {needsScan && (
          <button
            type="button"
            onClick={() => navigate("/candidate/upload")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-slate-200 font-bold hover:text-white cursor-pointer"
          >
            Start Body Scan <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
