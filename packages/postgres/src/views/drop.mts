import { escapeLiteral } from 'pg'

import type { ManagedViewDeclaration } from './declarations.mts'

export function buildDropViewStatement(declaration: ManagedViewDeclaration): string {
  return `DROP ${declaration.type.toUpperCase()} IF EXISTS ${declaration.name};`
}

/** The drop for the other relation kind, used when an object changed kind since it was created. */
function buildCounterpartDropStatement(declaration: ManagedViewDeclaration): string {
  const type = declaration.type === 'view' ? 'materialized view' : 'view'
  return buildDropViewStatement({ type, name: declaration.name })
}

/**
 * One annotated `DO` block that drops every declared view, retrying objects blocked by dependent
 * views until a pass makes no progress, which raises SQLSTATE 2BP01 naming the blocked views.
 * A declaration whose object now has the other relation kind is dropped as that kind. Returns null
 * when there is nothing to drop.
 */
export function buildDropViewsStatement(
  declarations: readonly ManagedViewDeclaration[],
): string | null {
  if (declarations.length === 0) return null
  const statements = declarations.map(buildDropViewStatement).map(escapeLiteral).join(', ')
  const alternates = declarations.map(buildCounterpartDropStatement).map(escapeLiteral).join(', ')
  const names = declarations.map((declaration) => escapeLiteral(declaration.name)).join(', ')
  const body = `
DECLARE
  pending_statements text[] := ARRAY[${statements}];
  pending_alternates text[] := ARRAY[${alternates}];
  pending_names text[] := ARRAY[${names}];
  remaining_alternates text[];
  remaining_statements text[];
  remaining_names text[];
  last_detail text;
  last_hint text;
  last_message text;
  index integer;
  progress boolean;
BEGIN
  WHILE cardinality(pending_statements) > 0 LOOP
    remaining_statements := ARRAY[]::text[];
    remaining_names := ARRAY[]::text[];
    remaining_alternates := ARRAY[]::text[];
    progress := false;
    FOR index IN 1..cardinality(pending_statements) LOOP
      BEGIN
        BEGIN
          EXECUTE pending_statements[index];
        EXCEPTION WHEN wrong_object_type THEN
          EXECUTE pending_alternates[index];
        END;
        progress := true;
      EXCEPTION WHEN dependent_objects_still_exist THEN
        GET STACKED DIAGNOSTICS
          last_message = MESSAGE_TEXT,
          last_detail = PG_EXCEPTION_DETAIL,
          last_hint = PG_EXCEPTION_HINT;
        remaining_statements := array_append(remaining_statements, pending_statements[index]);
        remaining_names := array_append(remaining_names, pending_names[index]);
        remaining_alternates := array_append(remaining_alternates, pending_alternates[index]);
      END;
    END LOOP;
    IF NOT progress THEN
      RAISE EXCEPTION USING
        ERRCODE = '2BP01',
        MESSAGE = 'Forced view teardown made no progress; blocked views: ' || array_to_string(remaining_names, ', '),
        DETAIL = concat_ws(E'\\n', last_message, last_detail),
        HINT = last_hint;
    END IF;
    pending_statements := remaining_statements;
    pending_names := remaining_names;
    pending_alternates := remaining_alternates;
  END LOOP;
END`
  return `/* dropManagedViews */ DO ${escapeLiteral(body)};`
}
