export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src', '<rootDir>/../../services', '<rootDir>/../../types'],
  setupFiles: ['<rootDir>/setupTests.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/services/(.*)$': '<rootDir>/../../services/$1',
    '^@/types/(.*)$': '<rootDir>/../../types/$1',
  },
};
