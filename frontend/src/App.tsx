import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/common/Layout";
import { Login } from "./pages/auth/Login";
import { Register } from "./pages/auth/Register";
import { ProfileCompletion } from "./pages/candidate/ProfileCompletion";
import { Guidelines } from "./pages/candidate/Guidelines";
import { ImageUpload } from "./pages/candidate/ImageUpload";
import { Results } from "./pages/candidate/Results";
import { CampaignBoard } from "./pages/candidate/CampaignBoard";
import { Dashboard } from "./pages/recruiter/Dashboard";
import { SelectedModels } from "./pages/recruiter/SelectedModels";
import { Campaigns } from "./pages/brand/Campaigns";
import { Garments } from "./pages/brand/Garments";
import { AdminPanel } from "./pages/admin/AdminPanel";

// Route Guard to redirect based on auth status
const AuthGuard: React.FC<{ children: React.ReactNode; allowedRole?: string }> = ({ children, allowedRole }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    // Redirect unauthorized roles to their default home
    if (user.role === "candidate") return <Navigate to="/candidate/profile" replace />;
    if (user.role === "recruiter") return <Navigate to="/recruiter/dashboard" replace />;
    if (user.role === "brand") return <Navigate to="/brand/campaigns" replace />;
    if (user.role === "admin") return <Navigate to="/admin/panel" replace />;
  }

  return <Layout>{children}</Layout>;
};

// Root Router Redirector
const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Route to the role's default landing page
  if (user.role === "candidate") return <Navigate to="/candidate/profile" replace />;
  if (user.role === "recruiter") return <Navigate to="/recruiter/dashboard" replace />;
  if (user.role === "brand") return <Navigate to="/brand/campaigns" replace />;
  if (user.role === "admin") return <Navigate to="/admin/panel" replace />;

  return <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Candidate Restricted Routes */}
          <Route
            path="/candidate/profile"
            element={
              <AuthGuard allowedRole="candidate">
                <ProfileCompletion />
              </AuthGuard>
            }
          />
          <Route
            path="/candidate/guidelines"
            element={
              <AuthGuard allowedRole="candidate">
                <Guidelines />
              </AuthGuard>
            }
          />
          <Route
            path="/candidate/upload"
            element={
              <AuthGuard allowedRole="candidate">
                <ImageUpload />
              </AuthGuard>
            }
          />
          <Route
            path="/candidate/results"
            element={
              <AuthGuard allowedRole="candidate">
                <Results />
              </AuthGuard>
            }
          />

          <Route
            path="/candidate/campaigns"
            element={
              <AuthGuard allowedRole="candidate">
                <CampaignBoard />
              </AuthGuard>
            }
          />

          {/* Recruiter Restricted Routes */}
          <Route
            path="/recruiter/dashboard"
            element={
              <AuthGuard allowedRole="recruiter">
                <Dashboard />
              </AuthGuard>
            }
          />

          <Route
            path="/recruiter/selected"
            element={
              <AuthGuard allowedRole="recruiter">
                <SelectedModels />
              </AuthGuard>
            }
          />

          {/* Brand Restricted Routes */}
          <Route
            path="/brand/campaigns"
            element={
              <AuthGuard allowedRole="brand">
                <Campaigns />
              </AuthGuard>
            }
          />
          <Route
            path="/brand/garments"
            element={
              <AuthGuard allowedRole="brand">
                <Garments />
              </AuthGuard>
            }
          />

          {/* Admin Restricted Routes */}
          <Route
            path="/admin/panel"
            element={
              <AuthGuard allowedRole="admin">
                <AdminPanel />
              </AuthGuard>
            }
          />

          {/* Home / Default Gateway */}
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
