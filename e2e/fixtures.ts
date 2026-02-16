/* eslint-disable react-hooks/rules-of-hooks */

import { test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { Effect } from 'effect';
import type { TestData } from './utils/setup';
import { createTestSetup } from './utils/setup';

type WorkerFixtures = {
  testData: TestData;
};

type TestFixtures = {
  apiContext: APIRequestContext;
};

// Extend base test with custom fixtures
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker fixture - runs once per worker (shared across tests)
  testData: [
    async ({}, use: (data: TestData) => Promise<void>) => {
      console.log('🔧 Setting up shared test data');
      const result = await Effect.runPromise(createTestSetup());

      await use(result);

      console.log('🧹 Cleaning up shared test data');
    },
    { scope: 'worker' }
  ],

  // Test fixture - runs for each test
  apiContext: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      extraHTTPHeaders: {
        Accept: 'application/json'
      }
    });
    await use(context);
    await context.dispose();
  }
});

export { expect } from '@playwright/test';
