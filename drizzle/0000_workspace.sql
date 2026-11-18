CREATE TABLE accounts (student TEXT PRIMARY KEY, salt TEXT NOT NULL, verifier TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token TEXT PRIMARY KEY, student TEXT NOT NULL, demo INTEGER NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX session_expiry ON sessions(expires);
--> statement-breakpoint
CREATE TABLE jobs (id TEXT PRIMARY KEY, student TEXT NOT NULL, name TEXT NOT NULL, cards INTEGER NOT NULL CHECK(cards BETWEEN 1 AND 4), mode TEXT NOT NULL, runtime TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, started INTEGER, finished INTEGER, artifact TEXT NOT NULL, logs TEXT, result TEXT, message TEXT);
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_job ON jobs(student) WHERE status IN ('queued','dispatching','running','cancelling');
--> statement-breakpoint
CREATE INDEX queue_order ON jobs(mode,status,created,id);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN last_checked INTEGER;
--> statement-breakpoint
CREATE TABLE login_attempts (identity TEXT PRIMARY KEY, attempts INTEGER NOT NULL, since INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE scheduler (id INTEGER PRIMARY KEY, lease_until INTEGER NOT NULL, owner TEXT, total INTEGER, free INTEGER, checked INTEGER, healthy INTEGER);
--> statement-breakpoint
INSERT INTO scheduler(id,lease_until) VALUES(1,0);
