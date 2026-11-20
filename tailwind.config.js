/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.html', './web/**/*.js'],
  safelist: [
    'active-nav',
    'active-theme',
    'mobile-nav-active',
    'dark-swal',
    'no-scrollbar'
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.05)'
      },
      colors: {
        brand: 'rgb(var(--color-brand-rgb) / <alpha-value>)',
        'brand-hover': 'var(--color-brand-hover)',
        'brand-light': 'var(--color-brand-light)',
        'brand-accent': 'var(--color-brand-accent)',
        'brand-ink': 'var(--color-brand-ink)'
      }
    }
  }
};
