/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    // Compile @inqi/shared from source under ts-jest (its dist is ESM).
    '^@inqi/shared$': '<rootDir>/../packages/shared/src/index.ts',
    // Strip explicit .js extensions on relative imports so ts-jest resolves the .ts.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
