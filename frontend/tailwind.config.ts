import type { Config } from 'tailwindcss';

/**
 * Palette note: the primary is 商务墨青 #2FAF9E. It is registered as `teal`
 * (overriding Tailwind's default teal ramp) so class names stay short and
 * obvious: bg-teal-500 / text-teal-600 / border-teal-200.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#12312E',
          soft: '#47615E',
          muted: '#7B908D',
        },
        teal: {
          50: '#F0FAF7',
          100: '#D8F2EC',
          200: '#AEE4D9',
          300: '#79D0BF',
          400: '#45B7A6',
          500: '#2FAF9E',
          600: '#249084',
          700: '#1D736A',
          800: '#195C55',
          900: '#164B45',
        },
        line: '#E6EDEC',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      letterSpacing: {
        tight: '-0.015em',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.18s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
