import React from "react";
import { useNavigate } from "react-router-dom";
import { Camera, CheckCircle2, AlertTriangle, ArrowRight, UserCheck, ShieldAlert, Sun, Eye } from "lucide-react";

export const Guidelines: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="glass-card p-8 rounded-3xl border border-white/5 relative shadow-2xl">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/5 pb-6 mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              <Camera className="w-8 h-8 text-brand-purple" />
              Photo Audition Guidelines
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Please read these requirements carefully. Incorrect photos will fail AI posture validation.
            </p>
          </div>
          <button
            onClick={() => navigate("/candidate/upload")}
            className="flex items-center gap-1.5 px-5 py-3 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-semibold text-sm hover:opacity-90 transition-all cursor-pointer hover:scale-102"
          >
            Go to Upload <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Grid Requirements */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Box 1: Apparel */}
          <div className="p-6 rounded-2xl bg-slate-900/30 border border-white/5 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-purple/10 flex items-center justify-center shrink-0 border border-brand-purple/20">
              <UserCheck className="w-5 h-5 text-brand-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100 mb-1">Tight-Fitting Apparel</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Wear form-fitting athletic wear, leggings, tight tank tops, or swimwear, and take your shoes off. Loose clothing masks your body contours, lowers measurement confidence and is flagged by the scanner.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg w-fit">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved: Bike shorts & snug top
              </div>
            </div>
          </div>

          {/* Box 2: Posture */}
          <div className="p-6 rounded-2xl bg-slate-900/30 border border-white/5 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-purple/10 flex items-center justify-center shrink-0 border border-brand-purple/20">
              <Eye className="w-5 h-5 text-brand-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100 mb-1">Standard A-Pose Stance</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Stand straight with level shoulders and look forward. Hold your arms about 15–20 cm clear of your sides so the scanner can see your waist outline. For the Left and Right views, turn a full 90°.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg w-fit">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved: Arms 15–20 cm from torso
              </div>
            </div>
          </div>

          {/* Box 3: Lighting */}
          <div className="p-6 rounded-2xl bg-slate-900/30 border border-white/5 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-purple/10 flex items-center justify-center shrink-0 border border-brand-purple/20">
              <Sun className="w-5 h-5 text-brand-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100 mb-1">Bright, Even Lighting</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Stand in a bright room with light facing your front. Avoid backlighting (standing in front of a window) which generates dark shadows and masks body shapes.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg w-fit">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved: Diffuse daylight
              </div>
            </div>
          </div>

          {/* Box 4: Camera Positioning */}
          <div className="p-6 rounded-2xl bg-slate-900/30 border border-white/5 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-purple/10 flex items-center justify-center shrink-0 border border-brand-purple/20">
              <ShieldAlert className="w-5 h-5 text-brand-purple" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100 mb-1">Camera Height & Distance</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Put the camera on a tripod at chest height, level (not tilted), 2.5–3.5 meters from a marked standing spot, and keep the zoom fixed. Your entire body—from the top of your head to the floor under your feet—must be in frame.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg w-fit">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved: Same spot & zoom for all 4 views
              </div>
            </div>
          </div>
        </div>

        {/* Warning Checklist */}
        <div className="p-5 rounded-2xl bg-red-500/5 border border-red-500/10 mb-8">
          <h3 className="text-sm font-semibold text-red-400 flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-4 h-4" /> Common Rejection Warnings
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400 list-disc list-inside">
            <li>Loose clothing, skirts, or jackets (Rejects body segmentation)</li>
            <li>Hands behind the back or in pockets (Rejects arm length calculation)</li>
            <li>Leaning or tilted shoulders (Fails posture checks)</li>
            <li>Dim lighting or a background that blends with you (Fails outline checks)</li>
            <li>Multiple people in frame (Fails face/pose selection)</li>
            <li>Cropped head or feet (Photo is refused — whole body must be in frame)</li>
          </ul>
        </div>

        {/* Bottom Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl bg-slate-900/50 border border-white/5 gap-4">
          <span className="text-xs text-slate-400 text-center sm:text-left">
            Ready to be scanned from 4 views (Front, Left, Right, Back)? The camera captures each one automatically.
          </span>
          <button
            onClick={() => navigate("/candidate/upload")}
            className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-white text-slate-950 font-bold text-xs hover:bg-slate-200 transition-all cursor-pointer shadow-md shadow-white/5"
          >
            Accept & Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
