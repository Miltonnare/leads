import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F8FAFC',
        surface: {
          DEFAULT: '#FFFFFF',
          border: '#E2E8F0',
        },
        ink: {
          DEFAULT: '#0F172A',
          muted: '#334155',
        },
        brand: 'rgb(var(--brand-color-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        subtle:
          '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 4px 16px -4px rgba(15, 23, 42, 0.06)',
        card:
          '0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 12px 32px -10px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
