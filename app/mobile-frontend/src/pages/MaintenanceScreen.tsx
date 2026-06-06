import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';

export const MaintenanceScreen: React.FC = () => {
  const [message, setMessage] = useState('The system is currently undergoing scheduled maintenance.');
  const [endTime, setEndTime] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [isChecking, setIsChecking] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await apiClient.get('/maintenance/status');
      if (res.data.active === false) {
        // Redirect back home if maintenance ended
        window.location.href = '/';
      } else {
        if (res.data.message) setMessage(res.data.message);
        if (res.data.end_time) setEndTime(res.data.end_time);
      }
    } catch (e) {
      console.error("Error fetching maintenance status", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!endTime) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const now = new Date().getTime();
      const end = new Date(endTime).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setCountdown('Service should be restoring now...');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);

      setCountdown(`Estimated uptime in: ${parts.join(' ')}`);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  const handleManualCheck = async () => {
    setIsChecking(true);
    await fetchStatus();
    setTimeout(() => setIsChecking(false), 800);
  };

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-6 text-[#F0F6FC]">
      <div className="max-w-md w-full bg-slate-900/40 backdrop-blur-md border border-amber-500/20 rounded-3xl p-8 shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
          <ShieldAlert size={40} className="animate-pulse" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">System Maintenance</h1>
          <p className="text-textMuted text-sm leading-relaxed">
            {message}
          </p>
        </div>

        {countdown && (
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl py-3 px-4 text-amber-400 font-mono text-sm tracking-wide">
            {countdown}
          </div>
        )}

        <div className="pt-2">
          <button
            onClick={handleManualCheck}
            disabled={isChecking}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold border border-white/5 transition-all duration-200"
          >
            <RefreshCw size={14} className={isChecking ? "animate-spin" : ""} />
            {isChecking ? 'Checking...' : 'Check Status'}
          </button>
        </div>

        <p className="text-xs text-textMuted pt-4 border-t border-white/5">
          Predictions are locked during maintenance. Thank you for your patience!
        </p>
      </div>
    </div>
  );
};
