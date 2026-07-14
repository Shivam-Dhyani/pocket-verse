/**
 * The person behind Pocketverse — shown on the landing page footer and the
 * About page so users know who built the app and how to reach them.
 *
 * ⚠️ Fill in your real LinkedIn profile URL below (one line, nothing else to
 * change). The env override exists so it can differ per deployment if needed.
 */
export const CREATOR = {
  name: 'Shivam Dhyani',
  linkedin:
    process.env.NEXT_PUBLIC_CREATOR_LINKEDIN ?? 'https://www.linkedin.com/in/YOUR-HANDLE-HERE',
};
