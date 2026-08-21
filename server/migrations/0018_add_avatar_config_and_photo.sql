-- Migration 0018: Bevo avatar customization + uploaded profile photos.
--
-- Replaces the six-preset `avatar` integer as the thing onboarding writes.
-- `avatar_config` is a "recipe", not a picture: a small JSON object
-- (see shared/avatar.ts AvatarConfig) describing a palette plus optional
-- accessory ids, serialized into this TEXT column. `profile_photo_url` is set
-- instead when the user uploads a real photo. Display precedence (client
-- side): profile_photo_url, then avatar_config, then the legacy avatar id.
--
-- `avatar` itself is untouched -- Edit Profile's preset picker
-- (AvatarPickerModal) still reads and writes it, so it stays as a fallback
-- for any account that never touches the new flow.

ALTER TABLE users ADD COLUMN avatar_config TEXT;
ALTER TABLE users ADD COLUMN profile_photo_url TEXT;
