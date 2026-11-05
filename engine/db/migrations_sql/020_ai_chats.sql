-- AI assistant chats, kept on the server so a follow-up sees everything
-- the model saw: its tool calls, their results and the proposal cards.
--
-- ai_chats.snapshot  the library overview frozen when the chat started, so
--                    the prompt prefix stays the same and model servers can
--                    reuse what they already read
-- ai_chats.meta      JSON: tool format, offered tools, proposal status,
--                    the library fingerprint at the last message, and how
--                    much of the log is shortened or left out
-- ai_chat_messages   the turn log, one JSON entry per row in order: user
--                    messages as sent, model steps, tool results, nudges
--
-- Local-only, never exported or published.
-- NOTE: the migration runner splits on the semicolon char, so comments
-- must avoid it.

CREATE TABLE IF NOT EXISTS ai_chats (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  snapshot    TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_updated_at ON ai_chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  chat_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (chat_id, seq)
);
