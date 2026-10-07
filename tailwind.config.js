/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    './frontend/**/*.{html,js}',
  ],
  theme: {
    extend: {
      colors: {
        recountix: {
          bg: '#0B0F17',
          surface: '#111827',
          surface2: '#131B2E',
          row: '#1E293B',
          border: '#334155',
          text: '#F8FAFC',
          muted: '#94A3B8',
          subtle: '#64748B',
          violet: '#7C3AED',
          indigo: '#6366F1',
          emerald: '#10B981',
          amber: '#F59E0B',
          rose: '#F43F5E',
        },
      },
      boxShadow: {
        glow: '0 0 60px rgba(124, 58, 237, 0.18)',
        emeraldGlow: '0 0 45px rgba(16, 185, 129, 0.14)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};
