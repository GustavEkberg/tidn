import { test, expect } from '@playwright/test';

test('login page loads correctly', async ({ page }) => {
  await page.goto('/login');

  // Verify the login form is visible
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('home page redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/');

  // Should redirect to login page
  await expect(page).toHaveURL('/login');
  await expect(page.getByPlaceholder('Email')).toBeVisible();
});
