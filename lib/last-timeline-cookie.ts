const COOKIE_NAME = 'tidn-last-timeline';

/** Set the last-visited timeline ID as a cookie (client-side). */
export function setLastTimeline(timelineId: string): void {
  try {
    document.cookie = `${COOKIE_NAME}=${timelineId};path=/;max-age=31536000;samesite=lax`;
  } catch {
    // ignore — SSR or cookie API unavailable
  }
}

/** Clear the last-visited timeline cookie (client-side). */
export function clearLastTimeline(timelineId: string): void {
  try {
    if (document.cookie.includes(`${COOKIE_NAME}=${timelineId}`)) {
      document.cookie = `${COOKIE_NAME}=;path=/;max-age=0`;
    }
  } catch {
    // ignore
  }
}

/** Read the last-visited timeline ID from a cookie jar (server-side). */
export function getLastTimeline(cookies: {
  get(name: string): { value: string } | undefined;
}): string | undefined {
  return cookies.get(COOKIE_NAME)?.value || undefined;
}
