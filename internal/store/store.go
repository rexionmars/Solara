/*
Package store is the local database: the accounts on this computer and the
sessions that keep one of them signed in.

It lives in the user's configuration directory, readable by that user only.
Nothing in it leaves the machine. An account separates the work of two people
sharing a computer; it is not a credential for any service.
*/
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

const (
	dataDirName = "terra-energy-engine"
	dbFileName  = "energy-engine.db"

	// Raised by one for every migration added to migrate.
	schemaVersion = 1
)

// Store is the open database and the directory it keeps its files in.
type Store struct {
	db      *sql.DB
	dataDir string
}

// DefaultDir is the directory the application keeps its files in: the user's
// configuration directory, under the application's own name.
func DefaultDir() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config dir: %w", err)
	}
	return filepath.Join(cfg, dataDirName), nil
}

// Open opens the database in DefaultDir.
func Open() (*Store, error) {
	dir, err := DefaultDir()
	if err != nil {
		return nil, err
	}
	return OpenDir(dir)
}

/*
OpenDir opens the database under dir, creating the directory and the schema when
they do not exist.

Three pragmas are set on the connection. foreign_keys, because SQLite leaves
REFERENCES and ON DELETE CASCADE unenforced without it -- TERRA's store declares
cascades that never run for exactly this reason. busy_timeout, so a second copy
of the application waits for a lock instead of failing at once. WAL, so a read
does not wait on a write.
*/
func OpenDir(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	dsn := filepath.Join(dir, dbFileName) +
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// One connection: the pragmas above are per connection, and the pool
	// would otherwise open further ones lazily.
	db.SetMaxOpenConns(1)

	s := &Store{db: db, dataDir: dir}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.pruneSessions(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// DataDir is the directory holding the database and the account files.
func (s *Store) DataDir() string { return s.dataDir }

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// migrate brings the schema to schemaVersion, one version per transaction.
func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("the database was written by a newer version of this application (schema %d, this build reads %d)", version, schemaVersion)
	}
	if version < 1 {
		if err := s.migrateTo(1, `
			CREATE TABLE users (
				id            TEXT PRIMARY KEY,
				email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
				display_name  TEXT NOT NULL,
				password_hash TEXT NOT NULL,
				avatar_file   TEXT,
				created_at    TEXT NOT NULL,
				updated_at    TEXT NOT NULL
			);
			CREATE TABLE sessions (
				token_hash TEXT PRIMARY KEY,
				user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL
			);
			CREATE INDEX sessions_user ON sessions(user_id);
		`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrateTo(version int, ddl string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(ddl); err != nil {
		return fmt.Errorf("migrate to schema %d: %w", version, err)
	}
	// PRAGMA takes no bound parameters; version is an integer constant.
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, version)); err != nil {
		return fmt.Errorf("record schema %d: %w", version, err)
	}
	return tx.Commit()
}

// stamp formats t as RFC 3339 in UTC, whole seconds. Every stamp has the same
// length and zone, so SQL can compare them as text.
func stamp(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

/*
isUniqueViolation reports whether SQLite refused a row for a UNIQUE constraint.

By result code rather than message text: the text is the driver's wording and
can change in any release. The extended code, not the SQLITE_CONSTRAINT class,
so a primary-key collision is not reported to the user as a taken email.
*/
func isUniqueViolation(err error) bool {
	var serr *sqlite.Error
	return errors.As(err, &serr) && serr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}
