ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','ta'));
