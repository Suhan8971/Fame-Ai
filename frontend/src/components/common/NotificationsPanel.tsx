import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { api } from "../../services/api";
import type { Notification } from "../../types";

// Model's notifications. Loading it also issues any rejection notices whose
// 24-hour waiting period has passed (there is no server-side scheduler).
export const NotificationsPanel: React.FC<{ userId: string; onChange?: () => void }> = ({ userId, onChange }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refresh = useCallback(async () => {
    const issued = await api.processRejectionNotifications(userId);
    setNotifications(await api.getNotifications(userId));
    if (issued) onChangeRef.current?.();
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const markRead = async (id: string) => {
    await api.markNotificationRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    await api.markAllNotificationsRead(userId);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="glass-card p-6 rounded-3xl border border-white/5 shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand-purple" />
          Notifications
          {unread > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-pink/20 text-brand-pink font-bold">{unread} new</span>
          )}
        </h3>
        {unread > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">No notifications yet.</p>
      ) : (
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`p-4 rounded-2xl border text-xs ${
                n.is_read ? "bg-slate-900/30 border-white/5" : "bg-brand-purple/10 border-brand-purple/25"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-100">{n.title}</h4>
                  {n.campaign_title && <span className="block text-[10px] text-brand-purple mt-0.5">{n.campaign_title}</span>}
                </div>
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    title="Mark as read"
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-slate-300 leading-relaxed mt-2">{n.message}</p>
              <span className="block text-[10px] text-slate-500 mt-2">{new Date(n.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
