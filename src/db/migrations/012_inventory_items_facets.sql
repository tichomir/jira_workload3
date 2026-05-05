-- Filter facet columns for Issue inventory items.
-- All columns are nullable so existing rows default to NULL.
ALTER TABLE backup_point_items ADD COLUMN status TEXT;
ALTER TABLE backup_point_items ADD COLUMN issueType TEXT;
ALTER TABLE backup_point_items ADD COLUMN assignee TEXT;
ALTER TABLE backup_point_items ADD COLUMN priority TEXT;
ALTER TABLE backup_point_items ADD COLUMN updatedAt TEXT;
ALTER TABLE backup_point_items ADD COLUMN sprintId TEXT;
ALTER TABLE backup_point_items ADD COLUMN boardId TEXT;
ALTER TABLE backup_point_items ADD COLUMN labels TEXT;
