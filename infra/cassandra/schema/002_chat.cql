-- One table per query (see the cassandra-data-modeling skill).

-- "Does this user exist?" Registration uses IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS chat.users (
  username text PRIMARY KEY,
  created_at timestamp
);

-- "What is this conversation?"
CREATE TABLE IF NOT EXISTS chat.conversations (
  conversation_id text PRIMARY KEY,
  kind text,
  title text,
  created_by text,
  created_at timestamp
);

-- "Who is in it?" One partition per conversation; also the fan-out list.
CREATE TABLE IF NOT EXISTS chat.members_by_conversation (
  conversation_id text,
  username text,
  role text,
  joined_at timestamp,
  PRIMARY KEY (conversation_id, username)
);

-- "My conversations, with the latest message." Denormalised per member.
-- last_* cells are written USING TIMESTAMP = message time, so an older message never wins.
CREATE TABLE IF NOT EXISTS chat.conversations_by_user (
  username text,
  conversation_id text,
  kind text,
  title text,
  last_message_id timeuuid,
  last_sender text,
  last_preview text,
  PRIMARY KEY (username, conversation_id)
);

-- "Page through history." Newest first, so the latest page is one slice.
CREATE TABLE IF NOT EXISTS chat.messages_by_conversation (
  conversation_id text,
  message_id timeuuid,
  sender text,
  client_msg_id text,
  kind text,
  body text,
  PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
