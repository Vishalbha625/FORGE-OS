/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f1115',
        surface: '#171a21',
        'surface-2': '#1f232d',
        line: '#2a2f3a',
        muted: '#8b93a3',
        text: '#e7eaf0',
        accent: '#ff5a1f',
        'accent-soft': '#ff7a47',
        good: '#3ecf8e',
        warn: '#f5b945',
        bad: '#ef5e6b',
        info: '#5aa9ff',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
