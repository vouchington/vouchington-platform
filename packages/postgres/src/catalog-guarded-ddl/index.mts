import { assertSafeSqlIdentifier } from '../partitions/identifiers.mts'

/**
 * `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT`, each guarded by a `pg_constraint`
 * lookup so reruns are no-ops. Validation takes only a SHARE UPDATE EXCLUSIVE lock, so writers
 * are not blocked while existing rows are scanned.
 *
 * The constraint name is the identity: a same-named constraint that already exists is accepted as
 * is, not compared to `constraintSql`. `constraintSql` is trusted SQL (e.g. `FOREIGN KEY (a) REFERENCES b (id)`); names are validated.
 */
export function buildConstraintAddAndValidateSql(
  table: string,
  constraintName: string,
  constraintSql: string,
  referencedTable?: string,
): string[] {
  const safeTable = assertSafeSqlIdentifier(table)
  const name = assertSafeSqlIdentifier(constraintName)
  const referenced = referencedTable === undefined ? [] : [assertSafeSqlIdentifier(referencedTable)]
  const exists = [
    '    SELECT 1',
    '    FROM pg_constraint',
    `    WHERE conname = '${name}'`,
    `      AND conrelid = '${safeTable}'::regclass`,
  ]
  return [
    buildCatalogGuardedDoBlock(
      'IF NOT EXISTS',
      [
        ...referenced.map((ref) => `LOCK TABLE ${ref} IN SHARE ROW EXCLUSIVE MODE;`),
        `LOCK TABLE ${safeTable} IN SHARE ROW EXCLUSIVE MODE;`,
      ],
      exists,
      [
        `    ALTER TABLE ${safeTable}`,
        `      ADD CONSTRAINT ${name}`,
        `      ${constraintSql} NOT VALID;`,
      ],
      'addConstraintNotValid',
    ),
    buildCatalogGuardedDoBlock(
      'IF EXISTS',
      [],
      [...exists, '      AND NOT convalidated'],
      [`    ALTER TABLE ${safeTable}`, `      VALIDATE CONSTRAINT ${name};`],
      'validateConstraint',
    ),
  ]
}

/**
 * Renders a `DO` block that runs `actionLines` when the catalog condition holds. With
 * `serializationLines` (typically `LOCK TABLE`), the condition is re-checked after the locks are
 * taken, so concurrent migrators cannot both act on a stale read.
 */
export function buildCatalogGuardedDoBlock(
  header: 'IF EXISTS' | 'IF NOT EXISTS',
  serializationLines: readonly string[],
  conditionLines: readonly string[],
  actionLines: readonly string[],
  annotation = 'buildCatalogGuardedDoBlock',
): string {
  const lead = `/* ${annotation} */\nDO $$ BEGIN`
  if (serializationLines.length === 0) {
    return [
      lead,
      `  ${header} (`,
      ...conditionLines,
      '  ) THEN',
      ...actionLines,
      '  END IF;',
      'END $$;',
    ].join('\n')
  }
  return [
    lead,
    `  ${header} (`,
    ...conditionLines,
    '  ) THEN',
    ...serializationLines.map((line) => `    ${line}`),
    `    ${header} (`,
    ...conditionLines.map((line) => `  ${line}`),
    '    ) THEN',
    ...actionLines.map((line) => `  ${line}`),
    '    END IF;',
    '  END IF;',
    'END $$;',
  ].join('\n')
}
