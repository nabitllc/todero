/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        surface: {
          page: '#080808',
          card: '#0f0f0f',
          elevated: '#1a1a1a',
        },
      },
    },
  },
  plugins: [],
}
