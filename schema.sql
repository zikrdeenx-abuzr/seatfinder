CREATE TABLE IF NOT EXISTS floors (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users  (id SERIAL PRIMARY KEY, reg_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  floor_id INT NOT NULL REFERENCES floors(id),
  label TEXT NOT NULL, x INT NOT NULL, y INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','booked','occupied','on_break')),
  user_id INT REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- DB-level safety: a seat has an owner if and only if it is not free
  CHECK ((status = 'free') = (user_id IS NULL))
);
-- DB-level safety: one user can hold only ONE seat, even under race conditions
CREATE UNIQUE INDEX IF NOT EXISTS one_seat_per_user ON seats(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS seats_expiry ON seats(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, seat_id INT, user_id INT,
  type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
