-- Support bounded removal of expired authentication secrets.
CREATE INDEX ix_refresh_expiry ON account_refresh_token(expires_at);
