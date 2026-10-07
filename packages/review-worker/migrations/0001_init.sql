-- Shares, their versions and comments. Files (snapshots, live sites) are in R2.

CREATE TABLE shares (
  slug TEXT PRIMARY KEY,
  -- the slug's random tail: names the live sites' hosts
  key TEXT NOT NULL UNIQUE,
  project TEXT NOT NULL,
  canvas TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- scrypt "salt:hash" when the link needs a password
  password TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  -- last change to the comments, for the studio's sync
  comments_updated INTEGER NOT NULL DEFAULT 0
);

-- the link of a project's canvas
CREATE TABLE share_index (
  project TEXT NOT NULL,
  canvas TEXT NOT NULL,
  slug TEXT NOT NULL,
  PRIMARY KEY (project, canvas)
);

CREATE TABLE versions (
  slug TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  frames TEXT NOT NULL,
  -- JSON: {"files":true} (hosted here) or {"url":"https://..."}
  live TEXT,
  PRIMARY KEY (slug, id)
);

-- content-addressed snapshot assets already uploaded
CREATE TABLE assets (
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (slug, name)
);

CREATE TABLE threads (
  slug TEXT NOT NULL,
  id TEXT NOT NULL,
  frame TEXT NOT NULL,
  version TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  resolved_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (slug, id)
);

-- one row per message: a reply never rewrites the thread, so concurrent
-- writes from a client and the studio can't overwrite each other
CREATE TABLE messages (
  slug TEXT NOT NULL,
  thread TEXT NOT NULL,
  id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (slug, thread, id)
);

CREATE INDEX messages_by_thread ON messages (slug, thread, at);
