import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import type { Garment, Campaign } from "../../types";
import { Shirt, Plus, X, Sliders } from "lucide-react";

export const Garments: React.FC = () => {
  const { user } = useAuth();
  const [garments, setGarments] = useState<Garment[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Garment Form State
  const [campaignId, setCampaignId] = useState<string>("");
  const [name, setName] = useState("");
  const [type, setType] = useState("Dress");
  const [category, setCategory] = useState("Formal");
  const [size, setSize] = useState("S");
  const [fitType, setFitType] = useState<"slim" | "regular" | "oversized">("regular");
  
  // Measurements in cm
  const [chest, setChest] = useState(90);
  const [waist, setWaist] = useState(70);
  const [hip, setHip] = useState(95);
  const [sleeve, setSleeve] = useState(62);
  const [shoulder, setShoulder] = useState(42);
  const [neck, setNeck] = useState(36);
  const [length, setLength] = useState(110);
  
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const gList = await api.getGarments();
      const cList = await api.getCampaigns();
      
      const filteredG = user ? gList.filter((g) => g.brand_id === user.id) : gList;
      const filteredC = user ? cList.filter((c) => c.brand_id === user.id) : cList;

      setGarments(filteredG);
      setCampaigns(filteredC);
    } catch (err) {
      console.error("Load garments/campaigns error: ", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormLoading(true);

    try {
      await api.createGarment(user.id, {
        campaign_id: campaignId || null,
        name,
        type,
        category,
        size,
        fit_type: fitType,
        measurements: {
          chest,
          waist,
          hip,
          sleeve,
          shoulder,
          neck,
          length,
        },
      });

      // Clear Form & Reload
      setName("");
      setCampaignId("");
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      console.error("Create garment error: ", err);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-white/5 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white font-sans">Brand Garment Spec Database</h1>
          <p className="text-sm text-slate-400 mt-1">Configure CAD garment pattern specifications for fit auto-matching.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-semibold text-xs hover:opacity-90 hover:scale-102 transition-all cursor-pointer shadow-lg shadow-purple-500/10"
        >
          <Plus className="w-4 h-4" /> Add Garment Specs
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-brand-purple rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {garments.length === 0 ? (
            <div className="md:col-span-3 text-center py-16 glass-card rounded-3xl border border-dashed border-white/10 p-8">
              <Shirt className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">No Pattern Specs Declared</h3>
              <p className="text-xs text-slate-400 mb-6">Enter detailed garment pattern metrics to match model body predictions.</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs"
              >
                Declare Garment Spec
              </button>
            </div>
          ) : (
            garments.map((g) => (
              <div key={g.id} className="glass-card p-6 rounded-2xl border border-white/5 relative overflow-hidden transition-all flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded bg-slate-900 text-[10px] text-brand-purple border border-brand-purple/20 font-bold uppercase tracking-wider">
                      Size {g.size} &bull; {g.fit_type}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">{g.type}</span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-4 leading-tight">{g.name}</h3>

                  {/* Specs measurements detail values */}
                  <div className="grid grid-cols-2 gap-2 bg-slate-950/40 p-3 rounded-xl border border-white/5 text-[11px] mb-4">
                    <div className="flex justify-between text-slate-400">
                      <span>Chest:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.chest} cm</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Waist:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.waist} cm</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Hip:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.hip} cm</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Shoulder:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.shoulder} cm</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Sleeve:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.sleeve} cm</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Neck:</span>
                      <span className="font-semibold text-slate-200">{g.measurements.neck} cm</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-3.5 mt-auto flex justify-between items-center text-[10px] text-slate-500 font-bold">
                  <span>Linked Campaign:</span>
                  <span className="text-slate-300 capitalize">
                    {campaigns.find((c) => c.id === g.campaign_id)?.title || "General Inventory"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* New Garment modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-card max-w-2xl w-full rounded-3xl border border-white/10 shadow-2xl relative p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/5 pb-4 mb-5">
              <h2 className="text-xl font-bold text-white flex items-center gap-1.5 font-sans">
                <Sliders className="w-5 h-5 text-brand-purple" />
                Declare Garment Sizing Specs
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg border border-white/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Garment Name */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Garment Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs"
                    placeholder="e.g. Silk Formal Tuxedo Jacket"
                  />
                </div>

                {/* Campaign Link */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Link to Audition Campaign</label>
                  <select
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    className="glass-input px-3.5 py-2.5 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    <option value="" className="bg-slate-950">None (General Reference Garment)</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id} className="bg-slate-950">
                        {c.title} ({c.brand_name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Garment Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    {["Dress", "Jacket", "Trousers", "Suit", "Coat", "Shirt", "Skirt"].map((t) => (
                      <option key={t} value={t} className="bg-slate-950">{t}</option>
                    ))}
                  </select>
                </div>

                {/* Size */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Fit Pattern Size</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer select-none"
                  >
                    {["XXS", "XS", "S", "M", "L", "XL", "XXL"].map((sz) => (
                      <option key={sz} value={sz} className="bg-slate-950">{sz}</option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Style Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer"
                  >
                    {["Formal", "Casual", "Athletic", "Streetwear", "Swimwear"].map((c) => (
                      <option key={c} value={c} className="bg-slate-950">{c}</option>
                    ))}
                  </select>
                </div>

                {/* Fit Type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Silhouette Fit profile</label>
                  <select
                    value={fitType}
                    onChange={(e) => setFitType(e.target.value as any)}
                    className="glass-input px-2.5 py-2 w-full rounded-xl text-xs cursor-pointer"
                  >
                    <option value="regular" className="bg-slate-950">Regular</option>
                    <option value="slim" className="bg-slate-950">Slim Fit</option>
                    <option value="oversized" className="bg-slate-950">Oversized</option>
                  </select>
                </div>
              </div>

              {/* Measurements Matrix Grid */}
              <div className="border-t border-white/5 pt-4">
                <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5" /> Garment Pattern Spec Measurements (cm)
                </h3>
                
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Chest</label>
                    <input
                      type="number"
                      value={chest}
                      onChange={(e) => setChest(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Waist</label>
                    <input
                      type="number"
                      value={waist}
                      onChange={(e) => setWaist(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Hip</label>
                    <input
                      type="number"
                      value={hip}
                      onChange={(e) => setHip(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Shoulder Width</label>
                    <input
                      type="number"
                      value={shoulder}
                      onChange={(e) => setShoulder(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Sleeve Length</label>
                    <input
                      type="number"
                      value={sleeve}
                      onChange={(e) => setSleeve(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Neck collar</label>
                    <input
                      type="number"
                      value={neck}
                      onChange={(e) => setNeck(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">Garment Length</label>
                    <input
                      type="number"
                      value={length}
                      onChange={(e) => setLength(Number(e.target.value))}
                      className="glass-input px-2 py-1.5 w-full rounded-lg text-xs text-center"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3.5 rounded-xl border border-white/5 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-brand-purple to-brand-pink text-white font-bold text-xs hover:opacity-90 cursor-pointer shadow-md"
                >
                  {formLoading ? (
                    <div className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                  ) : (
                    "Save Garment Specification"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
