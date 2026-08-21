-- Dense 1..N slots used to select a random public post without COUNT/OFFSET.

CREATE TABLE public_post_slots (
  slot INTEGER PRIMARY KEY NOT NULL CHECK (slot > 0),
  post_id TEXT NOT NULL UNIQUE
    REFERENCES posts (id) ON DELETE CASCADE
);
