import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/cli.ts'],
			// lcov para o SonarQube; os caminhos ficam relativos a packages/core.
			reporter: ['text', 'lcov'],
		},
	},
});
