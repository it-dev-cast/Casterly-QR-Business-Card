-- One-time setup for CardDesk, run as the PostgreSQL admin (postgres) with psql:
--
--   psql -U postgres -v app_password=choose-a-password -f scripts/setup-database.sql
--
-- CardDesk has no database of its own. It gets:
--   * a login role, carddesk_app;
--   * its own schema, "carddesk", inside nexusAuth's database (nexus_auth), for card links, card
--     settings, uploaded banner/logo images and admin sessions. It can't read nexusAuth's tables;
--     employee data comes from nexusAuth's API;
--   * a throwaway database, carddesk_test, used only by the automated tests (npm run test:db).
-- Then put the same password in CardDesk's .env (DATABASE_URL and TEST_DATABASE_URL).

CREATE ROLE carddesk_app LOGIN PASSWORD :'app_password';
CREATE DATABASE carddesk_test OWNER carddesk_app;
\c nexus_auth
CREATE SCHEMA IF NOT EXISTS carddesk AUTHORIZATION carddesk_app;
