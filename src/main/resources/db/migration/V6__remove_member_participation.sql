-- 강퇴된 멤버는 게시글 작성자 참조만 보존하고 일정과 인증 정보를 정리한다.
DELETE FROM member_session WHERE group_member_id IN (SELECT id FROM group_member WHERE NOT active);
DELETE FROM weekly_availability WHERE group_member_id IN (SELECT id FROM group_member WHERE NOT active);
DELETE FROM availability_override WHERE group_member_id IN (SELECT id FROM group_member WHERE NOT active);

ALTER TABLE group_member DROP CONSTRAINT uk_member_group_nickname;
ALTER TABLE group_member DROP CONSTRAINT uk_member_user_group;
CREATE UNIQUE INDEX uk_member_group_nickname ON group_member(group_id, nickname) WHERE active;
CREATE UNIQUE INDEX uk_member_user_group ON group_member(user_id, group_id) WHERE active;

ALTER TABLE group_member DROP CONSTRAINT ck_member_auth_type;
UPDATE group_member SET nickname='탈퇴한 사용자', user_id=NULL, access_token_hash=NULL WHERE NOT active;
ALTER TABLE group_member ADD CONSTRAINT ck_member_auth_type CHECK (
    (active AND ((user_id IS NULL AND access_token_hash IS NOT NULL) OR
                 (user_id IS NOT NULL AND access_token_hash IS NULL))) OR
    (NOT active AND user_id IS NULL AND access_token_hash IS NULL)
);

