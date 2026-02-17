/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.ts'
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ['Avenir Next', 'Segoe UI Variable', 'Trebuchet MS', 'sans-serif']
      }
    }
  },
  plugins: []
};
