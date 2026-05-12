# server/settings

`better-sqlite3` accessor for the persistent `AppSettings` row and the
device registry. The DB file location comes from `BGT_DB_PATH` (default
`./data/settings.db`).

See [`specs/09-persistence.md`](../../specs/09-persistence.md) for the
DDL, write semantics (PUT transaction + `device-in-use` rejection), and
the `last_seen_at` throttling rule.
