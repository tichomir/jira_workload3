-- Attachment filenames for Issue inventory items.
-- Stores a JSON array of filename strings for attachment filename search.
-- NULL for issues with no attachments.
ALTER TABLE backup_point_items ADD COLUMN attachments TEXT;
