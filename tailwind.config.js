/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 和モダン基本パレット
        sumi: {
          DEFAULT: '#1a1a1a', // 漆黒
          light: '#2d2d2d',
          muted: '#595652'
        },
        washi: {
          DEFAULT: '#fcfaf2', // 和紙風オフホワイト
          dark: '#f2ece1',
          border: '#e5dec9'
        },
        shuiro: {
          DEFAULT: '#c93a40', // 深朱色
          dark: '#a52a30',
          light: '#fdf2f2'
        },
        kin: {
          DEFAULT: '#c5a059', // 金色
          light: '#e8d7b4',
          dark: '#9a7836'
        },
        tera: {
          DEFAULT: '#2d6a4f', // 寺院用深緑
          light: '#eaf4f0'
        }
      },
      fontFamily: {
        serif: ['"Noto Serif JP"', '"Hiragino Mincho ProN"', '"Yu Mincho"', 'serif'],
        sans: ['"Noto Sans JP"', '"Hiragino Kaku Gothic ProN"', 'sans-serif']
      },
      keyframes: {
        stampPop: {
          '0%': { transform: 'scale(2.6) rotate(-18deg)', opacity: '0' },
          '60%': { transform: 'scale(0.92) rotate(-8deg)', opacity: '1' },
          '80%': { transform: 'scale(1.04) rotate(-10deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-10deg)', opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' }
        }
      },
      animation: {
        'stamp-pop': 'stampPop 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
      }
    },
  },
  plugins: [],
};
