CREATE TABLE suggestions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('training','debug','website','other')),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 created INTEGER NOT NULL
);
