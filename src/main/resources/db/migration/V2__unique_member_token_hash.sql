-- Authentication is a single indexed lookup, and a token identifies exactly one member.
ALTER TABLE group_member
    ADD CONSTRAINT uk_member_token_hash UNIQUE (access_token_hash);
