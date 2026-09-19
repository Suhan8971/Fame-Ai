import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import type { UserRole } from "../../types";
import { Eye, EyeOff, Lock, Mail, Shirt, ArrowRight } from "lucide-react";

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("candidate");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all credentials");
      return;
    }
    setError("");
    setLoading(true);

    try {
      await login(email, role, password);
      // Route based on role
      if (role === "candidate") navigate("/candidate/profile");
      else if (role === "recruiter") navigate("/recruiter/dashboard");
      else if (role === "brand") navigate("/brand/campaigns");
      else if (role === "admin") navigate("/admin/panel");
    } catch (err: any) {
      setError(err?.message || "Failed to authenticate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative">
      <div className="max-w-md w-full space-y-8 glass-card p-8 rounded-3xl relative z-10 border border-white/5 shadow-2xl">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-tr from-brand-purple to-brand-pink flex items-center justify-center shadow-lg animate-float">
            <Shirt className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-white tracking-tight">
            Welcome back to <span className="bg-gradient-to-r from-brand-purple to-brand-pink bg-clip-text text-transparent">FAME</span>
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Automated AI Fashion Recruitment Portal
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-xl text-sm text-center">
            {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Role Select */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Simulated Portal Access Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["candidate", "recruiter", "brand", "admin"] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-2 px-3 text-xs font-medium rounded-xl border capitalize transition-all cursor-pointer ${
                      role === r
                        ? "bg-brand-purple/20 border-brand-purple text-brand-purple font-semibold shadow-md shadow-purple-500/5"
                        : "bg-slate-900 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-400 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="h-4.5 w-4.5" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="glass-input pl-10 pr-4 py-3 w-full rounded-xl text-sm"
                  placeholder="e.g. model@example.com"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4.5 w-4.5" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input pl-10 pr-10 py-3 w-full rounded-xl text-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 rounded bg-slate-900 border-white/10 text-brand-purple focus:ring-brand-purple/50 accent-brand-purple"
              />
              <label htmlFor="remember-me" className="ml-2 text-slate-400">
                Remember me
              </label>
            </div>

            <Link
              to="/forgot-password"
              className="font-medium text-brand-purple hover:text-brand-pink transition-all"
            >
              Forgot password?
            </Link>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-brand-purple to-brand-pink hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-purple transition-all duration-300 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="flex items-center gap-1.5">
                  Sign In <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </button>
          </div>
        </form>

        <div className="text-center mt-6 text-xs text-slate-400">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-brand-purple hover:text-brand-pink transition-all">
            Contact your administrator
          </Link>
        </div>
      </div>
    </div>
  );
};
