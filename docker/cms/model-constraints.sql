-- The API exposes single-field uniqueness only; translations require a pair.
SET @constraint_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'blog_translations' AND index_name = 'uq_blog_translation_locale');
SET @statement = IF(@constraint_exists = 0, 'CREATE UNIQUE INDEX uq_blog_translation_locale ON blog_translations (article_id, locale)', 'SELECT 1');
PREPARE constraint_statement FROM @statement;
EXECUTE constraint_statement;
DEALLOCATE PREPARE constraint_statement;
