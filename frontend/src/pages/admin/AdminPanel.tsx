import React, { useState, useEffect } from "react";
import type { AuditLog, Prediction, UserRole } from "../../types";
import { authApi, type StoredCredential } from "../../services/authApi";
import { Server, Database, Layers, HardDrive, Cpu, Terminal, Trash, KeyRound, UserPlus, Pencil, X, AlertCircle } from "lucide-react";

export const AdminPanel: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [credentialsError, setCredentialsError] = useState("");

  // Credential form (create + edit share the same fields)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [credRole, setCredRole] = useState<UserRole>("candidate");
  const [credFirstName, setCredFirstName] = useState("");
  const [credLastName, setCredLastName] = useState("");
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credError, setCredError] = useState("");
  const [credCreating, setCredCreating] = useState(false);

  // System stats mock
  const stats = {
    cpuUsage: "12.4%",
    memoryUsed: "2.1 GB / 8.0 GB",
    diskUsage: "148 GB / 500 GB",
    celeryWorkers: 4,
    activeTasks: 0,
    s3BucketsSize: "42.8 GB (1,840 uploads)",
  };

  useEffect(() => {
    loadData();
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      setCredentials(await authApi.listUsers());
      setCredentialsError("");
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : "Could not reach the login server.");
    }
  };

  const loadData = async () => {
    try {
      // Mock logs
      const mockLogs: AuditLog[] = [
        { id: "log_1", user_email: "recruiter@balenciaga.com", action: "SHORTLIST_CANDIDATE", details: { candidate: "Liam Chen", score: 92.8 }, ip_address: "192.168.1.10", created_at: new Date(Date.now() - 3600 * 1000).toISOString() },
        { id: "log_2", user_email: "brand@gucci.com", action: "CREATE_CAMPAIGN", details: { title: "Pre-a-Porter Fitting Models" }, ip_address: "192.168.1.15", created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() },
        { id: "log_3", user_email: "model.anaya@example.com", action: "RUN_SMPL_PREDICTION", details: { status: "completed", size: "S" }, ip_address: "10.0.4.88", created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString() },
        { id: "log_4", user_email: "admin@fame.ai", action: "SYSTEM_CONFIG_UPDATE", details: { rate_limit: 100 }, ip_address: "127.0.0.1", created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
      ];
      setLogs(mockLogs);

      const dbPredictions = await localStorage.getItem("aura_db_predictions");
      if (dbPredictions) {
        setPredictions(Object.values(JSON.parse(dbPredictions)));
      } else {
        setPredictions([]);
      }
    } catch (err) {
      console.error("Admin data load error: ", err);
    }
  };

  const clearData = () => {
    if (confirm("Are you sure you want to flush all local database mock values?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const resetCredForm = () => {
    setEditingId(null);
    setCredRole("candidate");
    setCredFirstName("");
    setCredLastName("");
    setCredEmail("");
    setCredPassword("");
    setCredError("");
  };

  const handleEditClick = (cred: StoredCredential) => {
    setEditingId(cred.id);
    setCredRole(cred.role);
    setCredFirstName(cred.first_name);
    setCredLastName(cred.last_name);
    setCredEmail(cred.email);
    setCredPassword("");
    setCredError("");
  };

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError("");
    const missingRequired = editingId
      ? !credFirstName.trim() || !credLastName.trim() || !credEmail.trim()
      : !credFirstName.trim() || !credLastName.trim() || !credEmail.trim() || !credPassword;
    if (missingRequired) {
      setCredError(editingId ? "Name and email are required." : "Please fill in every field.");
      return;
    }
    setCredCreating(true);
    try {
      // Writes to backend/data/users.json (via auth_store.py) -- the only
      // store login() checks. This is the sole way to grant/change access now.
      if (editingId) {
        await authApi.updateUser(editingId, credRole, credFirstName.trim(), credLastName.trim(), credEmail.trim(), credPassword);
      } else {
        await authApi.createUser(credRole, credFirstName.trim(), credLastName.trim(), credEmail.trim(), credPassword);
      }
      await loadCredentials();
      resetCredForm();
    } catch (err) {
      setCredError(err instanceof Error ? err.message : `Could not ${editingId ? "update" : "create"} the account.`);
    } finally {
      setCredCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-white/5 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Server className="w-8 h-8 text-brand-purple" />
            Admin System Portal
          </h1>
          <p className="text-sm text-slate-400 mt-1">Super Admin dashboard for celery tasks, S3 storage, and auditing.</p>
        </div>
        <button
          onClick={clearData}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-400 font-semibold text-xs hover:bg-red-900 hover:text-white transition-all cursor-pointer shadow-lg"
        >
          <Trash className="w-4 h-4" /> Reset Mock DB
        </button>
      </div>

      {/* Login Credentials / User Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center justify-between gap-2 border-b border-white/5 pb-3">
            <span className="flex items-center gap-2">
              {editingId ? <Pencil className="w-5 h-5 text-brand-purple" /> : <UserPlus className="w-5 h-5 text-brand-purple" />}
              {editingId ? "Edit Account" : "Create Account"}
            </span>
            {editingId && (
              <button
                type="button"
                onClick={resetCredForm}
                className="text-slate-400 hover:text-white transition-all cursor-pointer"
                title="Cancel edit"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </h3>

          <form onSubmit={handleCreateCredential} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Role</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["candidate", "recruiter", "brand"] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCredRole(r)}
                    className={`py-2 px-2 text-[11px] font-medium rounded-xl border capitalize transition-all cursor-pointer ${
                      credRole === r
                        ? "bg-brand-purple/20 border-brand-purple text-brand-purple font-semibold"
                        : "bg-slate-900 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">First Name</label>
                <input
                  type="text"
                  value={credFirstName}
                  onChange={(e) => setCredFirstName(e.target.value)}
                  className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                  placeholder="e.g. Jordan"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Last Name</label>
                <input
                  type="text"
                  value={credLastName}
                  onChange={(e) => setCredLastName(e.target.value)}
                  className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                  placeholder="e.g. Reyes"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Email / Username</label>
              <input
                type="email"
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                placeholder="e.g. jordan@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Password {editingId && <span className="text-slate-500 font-normal normal-case">(leave blank to keep current)</span>}
              </label>
              <input
                type="text"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                className="glass-input px-3 py-2 w-full rounded-xl text-xs"
                placeholder={editingId ? "Leave blank to keep current password" : "Password"}
              />
            </div>

            {credError && (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <span>{credError}</span>
              </div>
            )}

            <div className="flex gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={resetCredForm}
                  className="flex-1 py-2.5 rounded-xl border border-white/5 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={credCreating}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-bold text-xs hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {editingId ? <Pencil className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                {editingId ? "Save Changes" : "Create Account"}
              </button>
            </div>
          </form>
        </div>

        <div className="lg:col-span-2 glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
            <KeyRound className="w-5 h-5 text-brand-purple" />
            Login Credentials
          </h3>

          {credentialsError && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-[11px] flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <span>{credentialsError}</span>
            </div>
          )}

          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            {credentials.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No accounts created yet.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5">Role</th>
                    <th className="py-2.5">Name</th>
                    <th className="py-2.5">Email</th>
                    <th className="py-2.5">Password</th>
                    <th className="py-2.5 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-[11px] text-slate-300">
                  {credentials.map((c) => (
                    <tr key={c.id} className={`hover:bg-white/[0.01] ${editingId === c.id ? "bg-brand-purple/5" : ""}`}>
                      <td className="py-2.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 font-semibold text-[10px] text-brand-purple capitalize">
                          {c.role}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-200 font-medium">{c.first_name} {c.last_name}</td>
                      <td className="py-2.5 text-slate-400">{c.email}</td>
                      <td className="py-2.5 font-mono text-slate-400">{c.password}</td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleEditClick(c)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
                          title="Edit account"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Hardware / Engine Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric 1 */}
        <div className="glass-card p-5 rounded-2xl border border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-purple/10 flex items-center justify-center border border-brand-purple/20 text-brand-purple">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Compute Core</span>
            <span className="block text-xl font-bold text-slate-100 mt-1">{stats.cpuUsage} CPU Usage</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="glass-card p-5 rounded-2xl border border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-purple/10 flex items-center justify-center border border-brand-purple/20 text-brand-purple">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Memory Bounds</span>
            <span className="block text-xl font-bold text-slate-100 mt-1">{stats.memoryUsed}</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="glass-card p-5 rounded-2xl border border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-purple/10 flex items-center justify-center border border-brand-purple/20 text-brand-purple">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">S3 Object Storage</span>
            <span className="block text-xl font-bold text-slate-100 mt-1">{stats.s3BucketsSize}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Predictions list */}
        <div className="lg:col-span-1 glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
            <Layers className="w-5 h-5 text-brand-purple" />
            Active ML Predictions
          </h3>

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {predictions.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No predictions computed yet.</p>
            ) : (
              predictions.map((p) => (
                <div key={p.id} className="p-3 bg-slate-900 border border-white/5 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <span className="block font-semibold text-slate-200 uppercase">{p.id.split("_")[0]}</span>
                    <span className="text-[10px] text-slate-500">Predicted Size: {p.predicted_size}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-semibold text-[10px]">
                    {p.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Audit logs */}
        <div className="lg:col-span-2 glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
            <Terminal className="w-5 h-5 text-brand-purple" />
            Audit Action Trail
          </h3>

          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-wider py-2">
                  <th className="py-2.5">Timestamp</th>
                  <th className="py-2.5">Actor</th>
                  <th className="py-2.5">Action</th>
                  <th className="py-2.5 text-right">Host IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[11px] text-slate-300">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.01]">
                    <td className="py-2.5 text-slate-500">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 text-slate-200 font-medium">{log.user_email}</td>
                    <td className="py-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 font-semibold text-[10px] text-slate-300">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-slate-500 font-mono">{log.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
