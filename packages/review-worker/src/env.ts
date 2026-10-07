export interface ReviewEnv {
  DB: D1Database;
  FILES: R2Bucket;
  /** the studio's token (secret): Truecanvas uploads and manages links with it */
  REVIEW_TOKEN: string;
  BRAND_NAME?: string;
  BRAND_LOGO?: string;
  /** live sites' host suffix, e.g. "-live.example.com"; empty: no hosted live sites */
  LIVE_HOST_SUFFIX?: string;
}
