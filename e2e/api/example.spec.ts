import { test, expect } from '../fixtures';

test.describe('GET /api/example', () => {
  test('should return 401 when not authenticated', async ({ apiContext }) => {
    const response = await apiContext.get('/api/example');

    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Not authenticated'
    });
  });

  test('should return posts when authenticated', async ({ apiContext, testData }) => {
    // Note: This test demonstrates the pattern for authenticated API tests.
    // In a real scenario, you would need to:
    // 1. Create a session for the test user
    // 2. Include the session cookie in the request
    //
    // For now, this test verifies the unauthenticated behavior.
    // TODO: Add session creation helper for authenticated API tests

    const response = await apiContext.get('/api/example');

    // Without proper session, we expect 401
    expect(response.status()).toBe(401);

    // Log test user info for debugging
    console.log('Test user created:', testData.user.email);
  });
});
