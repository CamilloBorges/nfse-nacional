import directusConfig from '@directus/eslint-config';

export default [
	...directusConfig,
	{
		ignores: ['**/dist/**', '**/coverage/**', '**/shims-vue.d.ts', '.e2e/**'],
	},
	{
		files: ['**/*.{js,mjs,ts,vue}'],
		rules: {
			// Mesmas exceções do directus-labs/extensions.
			'unicorn/no-array-callback-reference': 'off',
			'unicorn/no-await-expression-member': 'off',
			'unicorn/consistent-function-scoping': 'off',
			'unicorn/no-array-for-each': 'off',
			'unicorn/prefer-spread': 'off',
			'unicorn/prefer-module': 'off',
			// O projeto é em português: o parâmetro do catch se chama `erro`.
			'unicorn/catch-error-name': ['error', { name: 'erro' }],
		},
	},
	{
		// Linha de comando e scripts de desenvolvimento escrevem no terminal.
		files: ['packages/core/src/cli.ts', 'scripts/**'],
		rules: { 'no-console': 'off' },
	},
];
