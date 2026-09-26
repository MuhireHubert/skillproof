/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F2F5F9',
        ink: { DEFAULT: '#14213D', soft: '#55657F' },
        line: '#D5DCE6',
        ok: { DEFAULT: '#0E7C5A', bg: '#E3F3EC', ink: '#0A5D44' },
        wait: { DEFAULT: '#8A5A0B', bg: '#FBF1DC' },
        rev: { DEFAULT: '#2F5DA8', bg: '#E4ECF8' },
        no: { DEFAULT: '#A63D3D', bg: '#F8E5E5' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Instrument Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
