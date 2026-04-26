/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'solar-bg': '#1a1b23',
        'solar-card': '#252630',
        'solar-yellow': '#fde047',
        'solar-indigo': '#818cf8',
        'solar-emerald': '#10b981',
        'solar-amber': '#f59e0b',
        'solar-slate-700': '#334155',
        'solar-slate-600': '#475569',
        'solar-slate-500': '#64748b',
        'solar-red': '#ef4444',
        'solar-blue': '#3b82f6',
        'solar-purple': '#8b5cf6',
        'solar-pink': '#ec4899',
        'solar-brand': '#6366f1',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
