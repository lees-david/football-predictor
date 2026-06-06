import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'admin' | 'player' | 'live' | 'completed' | 'scheduled' | 'postponed' | 'success' | 'warning' | 'danger';
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'player', className = '', children, ...props }) => {
  const variants = {
    admin: 'bg-primary/20 text-primary border border-primary/30',
    player: 'bg-secondary/20 text-blue-400 border border-blue-400/30',
    live: 'bg-success/20 text-success border border-success/30 animate-pulse',
    completed: 'bg-gray-700 text-gray-300 border border-gray-600',
    scheduled: 'bg-slate-700 text-slate-300 border border-slate-600',
    postponed: 'bg-danger/20 text-danger border border-danger/30',
    success: 'bg-success/20 text-success border border-success/30',
    warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    danger: 'bg-danger/20 text-danger border border-danger/30'
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
