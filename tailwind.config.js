/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        primary: {
          100: "#dcefe6",
          200: "#b9decc",
          300: "#95ceb3",
          400: "#72bd99",
          500: "#4fad80",
          600: "#3f8a66",
          700: "#2f684d",
          800: "#204533",
          900: "#10231a"
        },
      }
    }
  }
}