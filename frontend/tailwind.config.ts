/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        olive: {
          50: '#f5f5f5',
          100: '#e8e8e8',
          200: '#d1d1d1',
          300: '#b0b0b0',
          400: '#8f8f8f',
          500: '#6f6f6f',
          600: '#4a4a4a',
          700: '#2b2b2b',
          800: '#1f1f1f',
          900: '#141414',
        },
        canvas: {
          50: '#ffffff',
          100: '#fafafa',
          200: '#f0f0f0',
        },
        health: {
          happy: '#3b8a4a',
          good: '#7a9a3a',
          caution: '#c9972e',
          danger: '#b8433a',
        },
      },
    },
  },
  plugins: [],
};
