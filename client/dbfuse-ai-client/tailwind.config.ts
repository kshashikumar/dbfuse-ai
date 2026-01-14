import { addDynamicIconSelectors } from '@iconify/tailwind';
import defaultTheme from 'tailwindcss/defaultTheme';
import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./src/**/*.{html,ts}', './projects/**/*.{html,ts}', './src/**/*.{js,jsx,ts,tsx}'],
    darkMode: 'class',
    theme: {
        fontFamily: {
            display: ['Space Grotesk', ...defaultTheme.fontFamily.sans],
            body: ['Inter', ...defaultTheme.fontFamily.sans],
            mono: ['Menlo', 'Monaco', 'Courier New', ...defaultTheme.fontFamily.mono],
        },
        container: {
            center: true,
            padding: '1.5rem',
        },
        extend: {
            colors: {
                brand: {
                    DEFAULT: '#2563eb',
                    light: '#3b82f6',
                    dark: '#1d4ed8',
                },
                surface: {
                    DEFAULT: '#ffffff',
                    dark: '#0f172a',
                    muted: '#1f2937',
                },
            },
            boxShadow: {
                soft: '0 10px 25px rgba(15, 23, 42, 0.08)',
            },
            borderRadius: {
                xl: '1rem',
            },
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/typography'),
        require('@tailwindcss/aspect-ratio'),
        require('tailwind-scrollbar')({ nocompatible: true }),
        addDynamicIconSelectors(),
    ],
};

export default config;
