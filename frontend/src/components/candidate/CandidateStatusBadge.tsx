import React from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Application } from "../../types";
import { getCandidateVisibleStatus } from "../../services/recruitmentRules";

// Application status as the model is allowed to see it: rejections stay
// "Under Review" until the 24-hour notice period has passed.
export const CandidateStatusBadge: React.FC<{ app: Application }> = ({ app }) => {
  const visible = getCandidateVisibleStatus(app);
  const badgeBase =
    "inline-flex items-center justify-center gap-1 w-[128px] shrink-0 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider whitespace-nowrap";
  if (visible === "shortlisted") {
    return (
      <span className={`${badgeBase} bg-green-500/15 text-green-400 border border-green-500/25`}>
        <CheckCircle2 className="w-3 h-3 shrink-0" /> Shortlisted
      </span>
    );
  }
  if (visible === "not_shortlisted") {
    return (
      <span className={`${badgeBase} bg-slate-500/15 text-slate-300 border border-slate-500/25`}>
        <XCircle className="w-3 h-3 shrink-0" /> Not Shortlisted
      </span>
    );
  }
  return (
    <span className={`${badgeBase} bg-yellow-500/15 text-yellow-400 border border-yellow-500/25`}>
      <Clock className="w-3 h-3 shrink-0" /> Under Review
    </span>
  );
};
