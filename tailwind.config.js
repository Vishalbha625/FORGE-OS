/** @type {import('tailwindcss').Config} */
// ChaiUI on Tailwind 3 (see design/chaiui/references/tailwind3.md).
// Tokens live as CSS variables in src/index.css (:root = light, .dark = dark).
// Colour variables hold oklch channels so Tailwind opacity modifiers work.
const oklch = (v) => `oklch(var(${v}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: oklch('--background'),
        foreground: oklch('--foreground'),
        card: oklch('--card'),
        primary: { DEFAULT: oklch('--primary'), foreground: oklch('--primary-foreground') },
        secondary: oklch('--secondary'),
        border: oklch('--border-c'),
        brand: oklch('--brand'),
        highlight: oklch('--highlight'),
        // App aliases, mapped onto ChaiUI tokens.
        bg: oklch('--background'),
        surface: oklch('--card'),
        'surface-2': oklch('--secondary'),
        line: oklch('--border-c'),
        muted: oklch('--muted-foreground'),
        text: oklch('--foreground'),
        accent: oklch('--highlight'), // cream highlight, never a fill
        // Meaning colours: text or thin outline only.
        good: oklch('--good'),
        warn: oklch('--warn'),
        bad: oklch('--bad'),
        info: oklch('--special'), // the one purple "special" category
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        montserrat: ['Montserrat', 'system-ui', 'sans-serif'],
        brand: ['Onest', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 6px)',
      },
      keyframes: {
        'chai-spin': { to: { transform: 'translate(-50%, -50%) rotate(360deg)' } },
      },
    },
  },
  plugins: [],
};
