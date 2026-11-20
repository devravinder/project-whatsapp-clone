-- "How far has each member got?" Watermarks, not one row per message and reader.
-- Written USING TIMESTAMP = the watermark message's time, so they only move forward.
CREATE TABLE IF NOT EXISTS chat.read_state (
  conversation_id text,
  username text,
  delivered_up_to timeuuid,
  read_up_to timeuuid,
  PRIMARY KEY (conversation_id, username)
);
