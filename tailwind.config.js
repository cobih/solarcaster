/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        solar: {
          bg: '#1a1b23',
          card: '#252630',
          yellow: '#fde047',
          indigo: '#818cf8',
          emerald: '#10b981',
          amber: '#f59e0b',
          slate: {
            700: '#334155',
            600: '#475569',
            500: '#64748b',
          },
          red: '#ef4444',
          blue: '#3b82f6',
          purple: '#8b5cf6',
          pink: '#ec4899',
          brand: '#6366f1', // Likely Range / Indigo 500 equivalent
        }
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
