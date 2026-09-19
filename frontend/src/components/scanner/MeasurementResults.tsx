// Measurement result panel. Behaviour ported from shirt-new-app-1's
// static/script.js (showResult / makeRow / renderBlockers' result siblings):
// the fused body model with per-measurement confidence and +/- range, the
// quality gate, the cross-view checks, and the tape-measure accuracy column
// whose values can be saved as validation ground truth.
import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Ruler, Save } from "lucide-react";
import { scannerApi, scannerUrl } from "../../services/scannerApi";
import type { ScanMeasurement, ScanSummary, ScanView, ScanViewEntry } from "../../types";

const VIEW_ORDER: ScanView[] = ["front", "left", "right", "back"];

// Measurement rows, driven by the FUSED body model rather than by one photo's
// numbers. Anything the pipeline could not measure is shown as "—".
const ROWS: [string, string, boolean?][] = [
  ["Across Shoulder", "across_shoulder"],
  ["Chest (circumference)", "chest"],
  ["Waist (circumference)", "waist"],
  ["Hip (circumference)", "hip"],
  ["Collar", "collar"],
  ["Sleeve Length (for sizing)", "sleeve_length"],
  ["Left Sleeve", "left_sleeve_length", true],
  ["Right Sleeve", "right_sleeve_length", true],
  ["Torso Length (neck to hip)", "torso_length"],
  ["Inseam", "inseam"],
  ["Height (measured)", "height"],
];

const CROSS_CHECK_LABELS: Record<string, string> = {
  shoulder_front_back: "Shoulder width, front vs back",
  chest_width_front_back: "Chest width, front vs back",
  waist_width_front_back: "Waist width, front vs back",
  hip_width_front_back: "Hip width, front vs back",
  chest_depth_left_right: "Chest depth, left vs right",
  waist_depth_left_right: "Waist depth, left vs right",
  hip_depth_left_right: "Hip depth, left vs right",
  sleeve_left_right: "Sleeve length, left vs right",
};

function accuracyClass(pct: number) {
  if (pct >= 80) return "text-green-400";
  if (pct >= 60) return "text-yellow-400";
  return "text-red-400";
}

function confClass(c: number) {
  if (c >= 0.85) return "bg-green-500/15 text-green-300 border-green-500/25";
  if (c >= 0.65) return "bg-yellow-500/15 text-yellow-300 border-yellow-500/25";
  return "bg-red-500/15 text-red-300 border-red-500/25";
}

const MeasurementRow: React.FC<{
  label: string;
  indent?: boolean;
  measurement?: ScanMeasurement;
  onTape: (value: number | null) => void;
}> = ({ label, indent, measurement, onTape }) => {
  const [tape, setTape] = useState("");
  const estimatedCm = measurement ? measurement.cm : null;

  const actual = parseFloat(tape);
  let accuracy: { text: string; cls: string } | null = null;
  if (actual > 0 && estimatedCm != null) {
    // Report the ERROR in cm as well as the percentage: "2.1 cm off" is what a
    // tailor cares about, and a percentage alone flatters small measurements.
    const errCm = estimatedCm - actual;
    const pct = Math.max(0, Math.min(100, 100 - (Math.abs(errCm) / actual) * 100));
    accuracy = {
      text: `${errCm >= 0 ? "+" : ""}${errCm.toFixed(1)} cm (${pct.toFixed(1)}%)`,
      cls: accuracyClass(pct),
    };
  }

  return (
    <tr className="hover:bg-white/[0.02] transition-colors">
      <td className={`py-3 font-medium text-slate-200 ${indent ? "pl-4 text-slate-400" : ""}`}>{label}</td>
      <td className="py-3" title={measurement?.method || undefined}>
        {estimatedCm == null ? (
          <span className="text-slate-600">—</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-brand-purple">{estimatedCm.toFixed(1)}</span>
            {measurement!.uncertainty_cm ? (
              <span className="text-[11px] text-slate-500">±{measurement!.uncertainty_cm.toFixed(1)}</span>
            ) : null}
            {measurement!.confidence != null && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${confClass(measurement!.confidence)}`}>
                {Math.round(measurement!.confidence * 100)}%
              </span>
            )}
          </span>
        )}
      </td>
      <td className="py-3">
        <input
          type="number"
          step="0.1"
          placeholder="cm"
          value={tape}
          onChange={(e) => {
            setTape(e.target.value);
            const v = parseFloat(e.target.value);
            onTape(v > 0 ? v : null);
          }}
          className="glass-input px-2.5 py-1.5 w-20 rounded-lg text-xs"
        />
      </td>
      <td className={`py-3 text-right text-xs font-semibold ${accuracy ? accuracy.cls : "text-slate-600 font-normal"}`}>
        {accuracy ? accuracy.text : "—"}
      </td>
    </tr>
  );
};

export const MeasurementResults: React.FC<{
  summary: ScanSummary;
  viewsData: Partial<Record<ScanView, ScanViewEntry>>;
}> = ({ summary, viewsData }) => {
  const [tapeValues, setTapeValues] = useState<Record<string, number>>({});
  const [saveText, setSaveText] = useState("Save my tape measurements for validation");
  const [saving, setSaving] = useState(false);

  const body = summary.body || {};
  const rel = summary.release || ({} as ScanSummary["release"]);
  const pct = rel.overall_confidence_pct != null ? rel.overall_confidence_pct : 0;

  // Cross-check panel: what each pair of views agreed on, and by how much.
  const cc = summary.cross_checks || {};
  const crossRows: { text: string; tag?: { ok: boolean; label: string }; warn?: boolean }[] = [];
  Object.keys(CROSS_CHECK_LABELS).forEach((k) => {
    const c = cc[k];
    if (!c || c.diff_pct == null) return;
    const a = c.front_cm != null ? c.front_cm : c.left_cm;
    const b = c.back_cm != null ? c.back_cm : c.right_cm;
    crossRows.push({
      text: `${CROSS_CHECK_LABELS[k]}: ${a}cm vs ${b}cm (Δ${c.diff_pct}%)`,
      tag: { ok: !!c.consistent, label: c.consistent ? "Consistent" : "Recheck" },
    });
  });
  const sc = cc.scale || {};
  if (sc.stature_cm_by_view) {
    const per = Object.entries(sc.stature_cm_by_view).map(([v, h]) => `${v} ${h}cm`).join(", ");
    crossRows.push({
      text: `Height implied by each view: ${per}`,
      tag: { ok: (sc.consistency || 0) >= 0.8, label: `scale ${Math.round((sc.consistency || 0) * 100)}%` },
    });
  }
  (summary.warnings || []).forEach((w) => crossRows.push({ text: w, warn: true }));

  const saveTape = async () => {
    if (!Object.keys(tapeValues).length) {
      setSaveText("Enter your tape measurements first");
      return;
    }
    setSaving(true);
    setSaveText("Saving…");
    try {
      const j = await scannerApi.saveGroundTruth(tapeValues);
      setSaveText(`Saved ${j.recorded.length} tape measurements — run: python validation.py report`);
    } catch (e) {
      setSaveText(e instanceof Error ? e.message : "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Quality gate: say plainly whether these numbers should be trusted. */}
      <div
        className={`p-4 rounded-2xl border text-xs ${
          rel.release
            ? "bg-green-500/10 border-green-500/20 text-green-200"
            : "bg-red-500/10 border-red-500/20 text-red-200"
        }`}
      >
        <h4 className="font-bold flex items-center gap-1.5 text-sm">
          {rel.release ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          )}
          {rel.release
            ? `Measurements released — overall confidence ${pct}%`
            : `Not accurate enough to release — overall confidence ${pct}%`}
        </h4>
        {(rel.reasons || []).length > 0 && (
          <ul className="list-disc list-inside space-y-1 text-slate-300 mt-2">
            {rel.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {(rel.recapture_views || []).length > 0 && (
          <p className="mt-2 font-semibold">Retake: {rel.recapture_views.join(", ")}</p>
        )}
      </div>

      {/* Thumbnails */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {VIEW_ORDER.filter((v) => viewsData[v]).map((v) => (
          <div key={v} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-white/5 bg-slate-950">
            <img src={scannerUrl(viewsData[v]!.image_url)} alt={`${v} capture`} className="w-full h-full object-cover" />
            <div className="absolute bottom-1 left-1.5 text-[8px] uppercase font-black tracking-widest text-slate-400 bg-slate-950/80 px-1 rounded">
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* Measurements table */}
      <div className="p-6 rounded-3xl border border-white/5 bg-slate-900/30 space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
          <Ruler className="w-5 h-5 text-brand-purple" />
          Your Measurements
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[520px]">
            <thead>
              <tr className="border-b border-white/5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5">Attribute</th>
                <th className="py-2.5">Estimated (cm)</th>
                <th className="py-2.5">Your Tape (cm)</th>
                <th className="py-2.5 text-right">Accuracy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm text-slate-300">
              {ROWS.map(([label, key, indent]) => (
                <MeasurementRow
                  key={key}
                  label={label}
                  indent={indent}
                  measurement={body[key]}
                  onTape={(value) =>
                    setTapeValues((prev) => {
                      const next = { ...prev };
                      if (value == null) delete next[key];
                      else next[key] = value;
                      return next;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-view checks */}
      <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/5 space-y-2 text-xs">
        {crossRows.length === 0 ? (
          <p className="text-slate-400">No cross-view discrepancies found.</p>
        ) : (
          crossRows.map((row, i) => (
            <div key={i} className={`flex items-start justify-between gap-3 ${row.warn ? "text-yellow-300" : "text-slate-300"}`}>
              <span>{row.text}</span>
              {row.tag && (
                <span
                  className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border ${
                    row.tag.ok
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                  }`}
                >
                  {row.tag.label}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={saveTape}
        disabled={saving}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-900 border border-white/10 text-slate-300 hover:text-white hover:border-brand-purple/40 transition-all cursor-pointer disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" /> {saveText}
      </button>

      <div className="p-4 bg-slate-900/50 rounded-2xl border border-white/5 space-y-3 text-[11px] text-slate-400 leading-relaxed">
        <p>
          <strong className="text-slate-300">How these are measured.</strong> Chest, waist, hip and collar are{" "}
          <em>circumferences</em>, computed from your body's <em>width</em> (front and back photos) and its{" "}
          <em>depth</em> (left and right photos) using a superellipse cross-section model — not from a fixed multiple
          of your shoulder width. Across shoulder is acromion to acromion, found on your actual outline. Each number
          carries a confidence and a ± range; a low confidence means the capture, not your body, was the limiting
          factor.
        </p>
        <p>
          <strong className="text-slate-300">For best accuracy:</strong> mark your standing spot on the floor and use
          the same spot for all four photos, keep the camera fixed at chest height, wear fitted clothing, take your
          shoes off, and hold your arms 15–20 cm clear of your sides. Running <code>python camera_calibration.py</code>{" "}
          and printing the scale marker (<code>python make_marker.py</code>) in the backend folder removes the two
          largest remaining error sources: lens distortion, and reliance on the height you typed in.
        </p>
        <p>
          Entering your tape measurements above and saving them builds the validation dataset that{" "}
          <code>python validation.py report</code> scores this system against. Nothing here claims an accuracy that
          has not been measured.
        </p>
      </div>
    </div>
  );
};
