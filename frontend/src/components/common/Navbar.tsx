import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Shirt, LayoutDashboard, User as UserIcon, Upload, HelpCircle, LogOut, Layers, Megaphone, Star } from "lucide-react";

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className="glass-card sticky top-0 z-50 px-6 py-4 mx-4 my-2 rounded-2xl flex items-center justify-between border border-white/5 bg-slate-950/70 backdrop-blur-md">
      {/* Brand Logo */}
      <Link to="/" className="flex items-center gap-2 group">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-purple to-brand-pink flex items-center justify-center shadow-lg group-hover:rotate-6 transition-all duration-300">
          <Shirt className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold tracking-widest bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent group-hover:text-brand-purple transition-all duration-300">
          FAME
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-purple/20 text-brand-purple border border-brand-purple/30 font-semibold tracking-wider">
          AI
        </span>
      </Link>

      {/* Navigation Links based on User Role */}
      {user && (
        <div className="hidden md:flex items-center gap-1">
          {user.role === "candidate" && (
            <>
              <Link
                to="/candidate/profile"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/candidate/profile")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <UserIcon className="w-4 h-4" />
                Profile
              </Link>
              <Link
                to="/candidate/guidelines"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/candidate/guidelines")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <HelpCircle className="w-4 h-4" />
                Guidelines
              </Link>
              <Link
                to="/candidate/upload"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/candidate/upload")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Upload className="w-4 h-4" />
                Audition Upload
              </Link>
              <Link
                to="/candidate/results"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/candidate/results")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Layers className="w-4 h-4" />
                Fit Results
              </Link>
              <Link
                to="/candidate/campaigns"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/candidate/campaigns")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Megaphone className="w-4 h-4" />
                Casting Calls
              </Link>
            </>
          )}

          {user.role === "recruiter" && (
            <>
              <Link
                to="/recruiter/dashboard"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/recruiter/dashboard")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Recruiter Dashboard
              </Link>
              <Link
                to="/recruiter/selected"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/recruiter/selected")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Star className="w-4 h-4" />
                Selected Models
              </Link>
            </>
          )}

          {user.role === "brand" && (
            <>
              <Link
                to="/brand/campaigns"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/brand/campaigns")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Campaigns
              </Link>
              <Link
                to="/brand/garments"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive("/brand/garments")
                    ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Shirt className="w-4 h-4" />
                Garments
              </Link>
            </>
          )}

          {user.role === "admin" && (
            <Link
              to="/admin/panel"
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isActive("/admin/panel")
                  ? "bg-brand-purple/10 text-brand-purple border border-brand-purple/25"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
              }`}
            >
              <Layers className="w-4 h-4" />
              Admin Portal
            </Link>
          )}
        </div>
      )}

      {/* Right Side: Role Switcher & Auth status */}
      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 text-brand-purple border border-brand-purple/20">
              Role: <span className="capitalize text-slate-200">{user.role}</span>
            </span>

            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium text-slate-300 leading-none">
                {user.first_name} {user.last_name}
              </p>
              <p className="text-[10px] text-slate-500">{user.email}</p>
            </div>

            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent transition-all cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-brand-purple to-brand-pink text-white shadow-lg shadow-purple-500/10 hover:shadow-purple-500/25 transition-all hover:scale-102"
          >
            Audition Portal
          </Link>
        )}
      </div>
    </nav>
  );
};
