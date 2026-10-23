-- "AssociationDocument" had Row Level Security enabled directly on the production database,
-- outside this migration history, with no policy attached. With RLS on and zero policies,
-- Postgres hides every row from every role except the table owner/superuser — so the app's
-- own role (adhera_app) got zero rows back from any query on this table, even though the
-- rows themselves were untouched. This is what made association legal documents (statuts,
-- règlement intérieur, etc.) appear to have "disappeared" for every association.
--
-- The app already enforces its own authorization in code (withAdminAuth, visibleToPublic/
-- visibleToMembers filters) exactly like every other table in this schema, none of which use
-- RLS. So this policy keeps RLS on (per request) but gives the app's own role unrestricted
-- access, matching how every other table behaves.
CREATE POLICY "adhera_app_full_access" ON "AssociationDocument"
  AS PERMISSIVE
  FOR ALL
  TO adhera_app
  USING (true)
  WITH CHECK (true);
