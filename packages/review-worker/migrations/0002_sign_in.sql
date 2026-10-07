-- Sign-in: Better Auth's tables (generated from its schema for the magic-link
-- setup in src/session.ts), the studio's members, link invitations, and each
-- link's access mode.

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- studio members added from the members page (STUDIO_EMAILS are members too, and owners)
CREATE TABLE members (
  email TEXT PRIMARY KEY,
  added_by TEXT,
  created_at INTEGER NOT NULL
);

-- people invited to a link. The email links to /i/<token>; only its hash is kept.
CREATE TABLE invites (
  slug TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (slug, email)
);

CREATE INDEX invites_by_email ON invites (email);

-- who can open a link: "invited" (signed-in invitees and the studio),
-- "password" (the link's password, as before), "public" (anyone with the link).
-- Existing links keep what they did: a password if they had one, open otherwise.
ALTER TABLE shares ADD COLUMN access TEXT NOT NULL DEFAULT 'public';
UPDATE shares SET access = 'password' WHERE password IS NOT NULL;
