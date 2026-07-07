/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // Integration tests (real Postgres via testcontainers) run under jest.int.config.js.
  testPathIgnorePatterns: ['/node_modules/', '\\.int\\.spec\\.ts$'],
  moduleNameMapper: {
    // Compile @inqi/shared from source under ts-jest (its dist is ESM).
    '^@inqi/shared$': '<rootDir>/../packages/shared/src/index.ts',
    // Strip explicit .js extensions on relative imports so ts-jest resolves the .ts.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
