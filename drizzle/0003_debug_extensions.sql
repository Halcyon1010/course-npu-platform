CREATE TABLE simulated_debug_extensions (
  process_key TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  updated INTEGER NOT NULL,
  revision INTEGER NOT NULL
);
