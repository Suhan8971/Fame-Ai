import React from "react";
import { Navbar } from "./Navbar";

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col justify-between selection:bg-brand-purple/30 selection:text-white">
      {/* Decorative Glow Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-purple/10 blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-brand-cyan/10 blur-[120px] animate-pulse-slow" />
      </div>

      <div>
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>

      {/* Premium Footer */}
      <footer className="w-full text-center py-8 border-t border-white/5 bg-slate-950/40 backdrop-blur-sm text-xs text-slate-500 mt-12 flex flex-col sm:flex-row items-center justify-between px-8 gap-4">
        <div>
          &copy; {new Date().getFullYear()} FAME AI Technologies. Built for Next-Gen Model Recruitment.
        </div>
        <div className="flex gap-6 text-[11px] text-slate-400 font-medium">
          <a href="#" className="hover:text-brand-purple transition-all">Privacy Policy</a>
          <a href="#" className="hover:text-brand-purple transition-all">Sizing Standards</a>
          <a href="#" className="hover:text-brand-purple transition-all">API Services</a>
        </div>
      </footer>
    </div>
  );
};
