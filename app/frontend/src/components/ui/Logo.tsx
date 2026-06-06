import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 32 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`select-none ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cyber-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" /> {/* Indigo / Purple */}
          <stop offset="100%" stopColor="#06B6D4" /> {/* Cyan */}
        </linearGradient>
        <filter id="neon-glow-filter" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Outer segmented ring */}
      <circle
        cx="50"
        cy="50"
        r="42"
        stroke="url(#cyber-logo-grad)"
        strokeWidth="4"
        strokeDasharray="16 8 8 8"
        filter="url(#neon-glow-filter)"
        className="opacity-90"
      />
      {/* Outer Hexagon outline */}
      <path
        d="M50 15 L78 35 L78 65 L50 85 L22 65 L22 35 Z"
        stroke="url(#cyber-logo-grad)"
        strokeWidth="4.5"
        strokeLinejoin="round"
        filter="url(#neon-glow-filter)"
      />
      {/* Connecting seams */}
      <path
        d="M50 15 L50 32 M22 35 L37 43 M78 35 L63 43 M22 65 L37 57 M78 65 L63 57 M50 85 L50 68"
        stroke="url(#cyber-logo-grad)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        className="opacity-70"
      />
      {/* Center pentagon */}
      <path
        d="M50 32 L68 45 L61 66 L39 66 L32 45 Z"
        stroke="url(#cyber-logo-grad)"
        strokeWidth="3.5"
        strokeLinejoin="round"
        fill="url(#cyber-logo-grad)"
        fillOpacity="0.15"
        filter="url(#neon-glow-filter)"
      />
    </svg>
  );
};
