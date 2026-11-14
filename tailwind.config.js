/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./sns/index.html", "./sns/gas/index.html", "./game/kaiten-sushi-typing/index.html"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        kuro: {
          950: "#050505",
          900: "#0a0a0a",
          800: "#121212",
          700: "#1f1f1f",
          600: "#2d2d2d",
          500: "#525252"
        }
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  }
};
