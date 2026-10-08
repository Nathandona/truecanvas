export interface ReviewEnv {
  DB: D1Database;
  /** one room per link: presence, real-time comments and the live session's tunnel (room.ts) */
  ROOM: DurableObjectNamespace<import("./room").Room>;
  FILES: R2Bucket;
  /** the studio's token (secret): Truecanvas uploads and manages links with it */
  REVIEW_TOKEN: string;
  BRAND_NAME?: string;
  BRAND_LOGO?: string;
  /** live sites' host suffix, e.g. "-live.example.com"; empty: no hosted live sites */
  LIVE_HOST_SUFFIX?: string;
  /** signs sign-in sessions (secret, 32+ characters). Without it, sign-in is off. */
  BETTER_AUTH_SECRET?: string;
  /** the studio's owners, comma separated: members of every link, and they manage the members */
  STUDIO_EMAILS?: string;
  /** sign-in and invitation emails come from this address, on a domain onboarded to Email Service */
  STUDIO_EMAIL_FROM?: string;
  /** Email Service binding (sending to any recipient needs the Workers Paid plan) */
  EMAIL?: SendEmail;
  /** or a Resend API key (secret): emails go through Resend's API instead */
  RESEND_API_KEY?: string;
  /** local development: show sign-in links on the page and in API answers instead of only emailing them */
  DEV_SHOW_EMAIL_LINKS?: string;
}
