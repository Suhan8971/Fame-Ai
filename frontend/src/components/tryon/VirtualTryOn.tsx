// Virtual shirt try-on. Behaviour ported from shirt-new-app-1's try-on
// section (static/script.js runVirtualTryOn + templates/index.html): picking
// or dropping a shirt previews it and immediately runs the try-on against the
// model's captured front photo; the result is shown BEFORE / AFTER with the
// engine that produced it. The replacement itself happens server-side in
// backend/vton_engine.py.
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Loader2, RefreshCw, Shirt, Sparkles, Upload } from "lucide-react";
import { scannerApi, scannerUrl } from "../../services/scannerApi";
import type { TryOnResult } from "../../types";

// Mirrors vton_engine.MAX_FILE_SIZE_BYTES so oversized files fail fast.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface Props {
  modelId: string | null;
  modelName?: string;
  beforeImageUrl: string | null; // the model's raw front photo
  engineStatus?: string;
}

export const VirtualTryOn: React.FC<Props> = ({ modelId, modelName, beforeImageUrl, engineStatus }) => {
  const [shirtFile, setShirtFile] = useState<File | null>(null);
  const [shirtPreview, setShirtPreview] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TryOnResult | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [beforeUrl, setBeforeUrl] = useState("");
  const [downloading, setDownloading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(0);

  const ready = !!modelId && !!beforeImageUrl;

  // A different model (or front photo) invalidates any result or in-flight request.
  useEffect(() => {
    requestId.current += 1;
    setResult(null);
    setResultUrl("");
    setError("");
    setLoading(false);
  }, [modelId, beforeImageUrl]);

  const runVirtualTryOn = async (file: File | null) => {
    if (!file || !modelId || !beforeImageUrl) return;
    const id = ++requestId.current;

    setError("");
    setResult(null);
    setLoading(true);

    try {
      const data = await scannerApi.virtualTryOn(modelId, file);
      if (id !== requestId.current) return;
      // BEFORE photo from the captured front view, AFTER from the try-on output
      setBeforeUrl(beforeImageUrl);
      setResultUrl(`${scannerUrl(data.tryon_image_url)}?t=${Date.now()}`);
      setResult(data);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Could not connect to server for Virtual Try-On.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(`"${file.name}" is not an image. Please choose a shirt photo (JPG, PNG, WEBP…).`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Uploaded image file exceeds size limit (20MB).");
      return;
    }
    setShirtFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setShirtPreview(String(e.target?.result || ""));
      // Automatically trigger try-on (as in shirt-new-app-1)
      runVirtualTryOn(file);
    };
    reader.onerror = () => setError("Could not read the selected file.");
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!ready || loading) return;
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = ready && !loading ? "copy" : "none";
    if (ready && !loading) setDragActive(true);
  };

  const pickShirt = () => fileInputRef.current?.click();

  // A cross-origin <a download> is ignored by browsers, so fetch the image first.
  const downloadResult = async () => {
    if (!resultUrl) return;
    setDownloading(true);
    try {
      const blob = await fetch(resultUrl).then((r) => {
        if (!r.ok) throw new Error();
        return r.blob();
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `virtual_tryon_${(modelName || modelId || "model").replace(/\W+/g, "_")}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setError("Could not download the try-on photo.");
    }
    setDownloading(false);
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow picking the same file again
        }}
      />

      {/* Drop zone + selected shirt preview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          role="button"
          tabIndex={ready ? 0 : -1}
          aria-disabled={!ready || loading}
          onClick={() => ready && !loading && pickShirt()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && ready && !loading) {
              e.preventDefault();
              pickShirt();
            }
          }}
          onDragEnter={onDragOver}
          onDragOver={onDragOver}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={`sm:col-span-2 min-h-[180px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 transition-all duration-300 ${
            !ready
              ? "border-white/5 bg-slate-950/20 opacity-50 cursor-not-allowed"
              : dragActive
              ? "border-brand-purple bg-brand-purple/10 cursor-copy"
              : loading
              ? "border-white/10 bg-slate-900/10 cursor-wait"
              : "border-white/10 bg-slate-900/10 hover:bg-slate-900/20 hover:border-brand-purple/40 cursor-pointer"
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 shadow-inner">
            <Upload className={`w-6 h-6 ${dragActive ? "text-brand-purple" : "text-slate-400"}`} />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">
            {ready ? "Drag & drop a shirt photo here" : "Select a model's front image first"}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm leading-normal">
            {ready
              ? "or click to choose one from your computer. The shirt replaces the outfit in the front photo."
              : "Try-on uses the model's captured FRONT view."}
          </p>
          {shirtFile && <span className="mt-3 text-[11px] text-slate-400 truncate max-w-full">{shirtFile.name}</span>}
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900/30 p-3 flex flex-col gap-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Selected shirt</span>
          <div className="flex-1 min-h-[110px] rounded-xl bg-slate-950/60 border border-white/5 flex items-center justify-center overflow-hidden">
            {shirtPreview ? (
              <img src={shirtPreview} alt="Selected garment preview" className="max-h-40 w-full object-contain" />
            ) : (
              <Shirt className="w-8 h-8 text-slate-700" />
            )}
          </div>
          <button
            type="button"
            onClick={() => runVirtualTryOn(shirtFile)}
            disabled={!shirtFile || !ready || loading}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-brand-purple to-brand-pink hover:opacity-90 transition-all cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3.5 h-3.5" /> Try On Shirt
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading & progress state */}
      {loading && (
        <div className="p-5 rounded-2xl bg-slate-900/50 border border-white/5 flex items-center gap-4">
          <Loader2 className="w-8 h-8 text-brand-purple animate-spin shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Analyzing the photo and fitting the shirt...</p>
            {engineStatus && <span className="text-[11px] text-slate-500">Engine: {engineStatus}</span>}
          </div>
        </div>
      )}

      {/* Before / after comparison result */}
      {result && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Virtual Try-On Look{modelName ? ` — ${modelName}` : ""}</h3>
            <span className="text-[10px] px-2 py-1 rounded-lg bg-brand-purple/10 text-brand-purple border border-brand-purple/25 font-bold tracking-wide">
              {result.engine}
              {result.device_info ? ` (${result.device_info})` : ""}
              {result.inference_time_sec ? ` · ${result.inference_time_sec}s` : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl overflow-hidden border border-white/5 bg-slate-950">
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 py-2 border-b border-white/5">
                Before (Original Photo)
              </span>
              <img src={beforeUrl} alt="Original front-view photo" className="w-full h-auto block" />
            </div>
            <div className="rounded-2xl overflow-hidden border border-brand-purple/30 bg-slate-950 glow-purple">
              <span className="block text-[10px] font-bold text-brand-purple uppercase tracking-widest px-3 py-2 border-b border-white/5">
                After (Virtual Try-On)
              </span>
              <img src={resultUrl} alt="Virtual try-on result" className="w-full h-auto block" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runVirtualTryOn(shirtFile)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-white/5 hover:border-brand-purple/40 text-xs font-semibold text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Generate Again
            </button>
            <button
              type="button"
              onClick={pickShirt}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-white/5 hover:border-brand-purple/40 text-xs font-semibold text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer"
            >
              <Shirt className="w-3.5 h-3.5" /> Pick Another Shirt
            </button>
            <button
              type="button"
              onClick={downloadResult}
              disabled={downloading}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-slate-950 hover:bg-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Download Photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
