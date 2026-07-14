import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // typescript-eslint 8.63+ requires an explicit root when multiple
        // tsconfigs are present (packages/* workspaces each ship one).
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        // Pinned instead of 'detect': eslint-plugin-react 7.37's detect path
        // crashes under eslint 10 (getReactVersionFromContext).
        version: '19.2',
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript rules - relaxed for WinAPI emulator
      '@typescript-eslint/no-explicit-any': 'warn', // Often needed for low-level WinAPI interop
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          // Allow WinAPI-style variable prefixes (lp, p, h, dw, etc.)
          // Common prefixes: lp (long pointer), p (pointer), h (handle), dw (DWORD), n (number), etc.
          varsIgnorePattern: '^(_|lp|p|h|dw|n|c|b|f|w|sz|psz|lpsz|hdc|hWnd|hInstance|hModule)',
          // Allow unused vars in function signatures (common in WinAPI stubs)
          args: 'none', // Don't check function arguments - WinAPI functions often have unused params
          caughtErrors: 'none', // Don't check caught errors - often intentionally unused
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off', // Empty interfaces used as marker types
      '@typescript-eslint/ban-ts-comment': 'warn', // Prefer @ts-expect-error but allow @ts-ignore
      // JavaScript rules
      'prefer-const': 'warn', // Warn instead of error
      'no-case-declarations': 'off', // Allow declarations in case blocks (wrap in {} if needed)
      // React rules
      'react/react-in-jsx-scope': 'off', // Not needed in React 17+
      'react/prop-types': 'off', // Using TypeScript for prop validation
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'vendor/**',
      '.claude/**',
      'build/**',
      'tmp/**',
      'logs/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      'bun.lock',
      'tools/**',
    ],
  }
);
