/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0D1117',
        card: '#161B22',
        primary: '#F59E0B',
        secondary: '#3B82F6',
        success: '#10B981',
        danger: '#EF4444',
        textMain: '#F0F6FC',
        textMuted: '#8B949E'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      animation: {
        'pulse-gold': 'pulse-gold 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { opacity: 1, backgroundColor: '#F59E0B' },
          '50%': { opacity: .5, backgroundColor: '#D97706' },
        }
      }
    },
  },
  plugins: [],
}
