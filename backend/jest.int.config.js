/**
 * Integration tests: real Postgres (pgvector + PostGIS) via testcontainers.
 * Slower + needs a local Docker daemon, so kept out of the default `jest` run
 * (see testPathIgnorePatterns in jest.config.js) and invoked with `pnpm test:int`.
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int.spec.ts'],
  testTimeout: 180_000, // container start + prisma db push + init.sql
  moduleNameMapper: {
    '^@inqi/shared$': '<rootDir>/../packages/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
