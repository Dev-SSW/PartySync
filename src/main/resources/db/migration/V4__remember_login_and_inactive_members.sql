-- Preserve all membership records, foreign keys, nicknames and account links.
ALTER TABLE group_member ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE account_refresh_token (
 token_hash VARCHAR(64) PRIMARY KEY,
 user_session_id BIGINT NOT NULL REFERENCES user_session(id),
 expires_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
 persistent BOOLEAN NOT NULL,
 used_at TIMESTAMP(6) WITH TIME ZONE
);
CREATE INDEX ix_refresh_session ON account_refresh_token(user_session_id);
