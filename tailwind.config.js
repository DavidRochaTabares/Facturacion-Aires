export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    colors: {
      bg: 'rgb(var(--bg) / <alpha-value>)', surface: 'rgb(var(--surface) / <alpha-value>)', surface2: 'rgb(var(--surface2) / <alpha-value>)',
      line: 'rgb(var(--line) / <alpha-value>)', fg: 'rgb(var(--fg) / <alpha-value>)', muted: 'rgb(var(--muted) / <alpha-value>)',
      brand: 'rgb(var(--brand) / <alpha-value>)',
    },
    boxShadow: { soft: '0 1px 2px rgb(0 0 0 / 0.04)' },
  } },
  plugins: [],
}
