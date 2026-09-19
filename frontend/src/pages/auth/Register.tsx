import React from "react";
import { Link } from "react-router-dom";
import { Shirt, ShieldAlert, ArrowLeft } from "lucide-react";

// Self-registration is disabled: only accounts created via the Admin panel
// (Login Credentials / User Accounts) can sign in. This page just points
// people back to the admin instead of offering a signup form.
export const Register: React.FC = () => {
  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="max-w-md w-full space-y-6 glass-card p-8 rounded-3xl relative z-10 border border-white/5 shadow-2xl text-center">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-tr from-brand-purple to-brand-pink flex items-center justify-center shadow-lg animate-float">
          <Shirt className="h-6 w-6 text-white" />
        </div>
        <h2 className="text-2xl font-extrabold text-white tracking-tight">
          Accounts are managed by your administrator
        </h2>
        <div className="p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-sm flex items-start gap-2.5 text-left">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            Self sign-up is turned off for this platform. To get access, ask an admin to create your
            Candidate, Recruiter, or Brand login from the Admin panel&rsquo;s &ldquo;Login Credentials&rdquo; section.
          </span>
        </div>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 justify-center w-full py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-purple to-brand-pink hover:opacity-90 transition-all duration-300"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Sign In
        </Link>
      </div>
    </div>
  );
};
