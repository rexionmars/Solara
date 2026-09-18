package store

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := OpenDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func register(t *testing.T, s *Store, email string) *User {
	t.Helper()
	u, err := s.Register(email, "correct horse", "Ada")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func pngDataURI(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestOpenDir_EnablesForeignKeys(t *testing.T) {
	s := openTemp(t)
	var on int
	if err := s.db.QueryRow(`PRAGMA foreign_keys`).Scan(&on); err != nil {
		t.Fatal(err)
	}
	if on != 1 {
		t.Fatalf("foreign_keys = %d, want 1", on)
	}
}

func TestRegister_SignsInAndSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.Register("  Ada@Example.org ", "correct horse", " Ada ")
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "ada@example.org" || u.DisplayName != "Ada" {
		t.Fatalf("normalised to %q / %q", u.Email, u.DisplayName)
	}
	_ = s.Close()

	s, err = OpenDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	restored, err := s.RestoreSession()
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.ID != u.ID {
		t.Fatalf("restored %s, want %s", restored.ID, u.ID)
	}
}

func TestRegister_DuplicateEmailIgnoresCase(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	if _, err := s.Register("ADA@example.org", "another pass", "Other"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("want ErrEmailTaken, got %v", err)
	}
}

func TestRegister_RefusesMalformedInput(t *testing.T) {
	cases := map[string][3]string{
		"not an email":      {"ada", "correct horse", "Ada"},
		"named address":     {"Ada <ada@example.org>", "correct horse", "Ada"},
		"short password":    {"ada@example.org", "short", "Ada"},
		"73-byte password":  {"ada@example.org", strings.Repeat("x", 73), "Ada"},
		"blank name":        {"ada@example.org", "correct horse", "   "},
		"81-character name": {"ada@example.org", "correct horse", strings.Repeat("a", 81)},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			s := openTemp(t)
			_, err := s.Register(c[0], c[1], c[2])
			var ie *InputError
			if !errors.As(err, &ie) {
				t.Fatalf("want *InputError, got %v", err)
			}
		})
	}
}

func TestLogin_UnknownEmailAndWrongPasswordLookAlike(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	if _, err := s.Login("ada@example.org", "wrong password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password: %v", err)
	}
	if _, err := s.Login("nobody@example.org", "correct horse"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("unknown email: %v", err)
	}
	if _, err := s.Login("ADA@example.org", "correct horse"); err != nil {
		t.Fatalf("login: %v", err)
	}
}

func TestSession_StoresOnlyTheTokenHash(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	token, err := s.readSessionToken()
	if err != nil || token == "" {
		t.Fatalf("token %q, %v", token, err)
	}
	var stored string
	if err := s.db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != hashToken(token) {
		t.Fatalf("stored %q for token %q", stored, token)
	}
	info, err := os.Stat(s.sessionPath())
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("session file mode %o, want 600", perm)
	}
}

func TestLogout_EndsTheSession(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	if err := s.Logout(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreSession(); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound after logout, got %v", err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d sessions left after logout", n)
	}
}

func TestLogin_ReplacesThePreviousSession(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	register(t, s, "grace@example.org")
	if _, err := s.Login("ada@example.org", "correct horse"); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d sessions, want the one this computer holds", n)
	}
}

func TestRestoreSession_ExpiredIsRemoved(t *testing.T) {
	s := openTemp(t)
	register(t, s, "ada@example.org")
	past := stamp(time.Now().Add(-time.Hour))
	if _, err := s.db.Exec(`UPDATE sessions SET expires_at = ?`, past); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreSession(); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := os.Stat(s.sessionPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("session file still present: %v", err)
	}
}

func TestDeletingAUser_CascadesToSessions(t *testing.T) {
	s := openTemp(t)
	u := register(t, s, "ada@example.org")
	if _, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, u.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d sessions survived their user", n)
	}
}

func TestUpdateDisplayName(t *testing.T) {
	s := openTemp(t)
	u := register(t, s, "ada@example.org")
	got, err := s.UpdateDisplayName(u.ID, "  Ada Lovelace ")
	if err != nil {
		t.Fatal(err)
	}
	if got.DisplayName != "Ada Lovelace" {
		t.Fatalf("name %q", got.DisplayName)
	}
	if _, err := s.UpdateDisplayName("missing", "Ada"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestAvatar_RoundTripAndClear(t *testing.T) {
	s := openTemp(t)
	u := register(t, s, "ada@example.org")
	got, err := s.SetAvatar(u.ID, pngDataURI(t))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.AvatarURI, "data:image/png;base64,") {
		t.Fatalf("avatar uri %.40q", got.AvatarURI)
	}
	file := filepath.Join(s.dataDir, avatarDir, u.ID+".png")
	if _, err := os.Stat(file); err != nil {
		t.Fatal(err)
	}

	cleared, err := s.ClearAvatar(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.AvatarURI != "" {
		t.Fatal("avatar still set after clear")
	}
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("photo file still present: %v", err)
	}
}

func TestAvatar_RefusesBytesThatDoNotMatchTheirType(t *testing.T) {
	s := openTemp(t)
	u := register(t, s, "ada@example.org")
	mislabelled := strings.Replace(pngDataURI(t), "image/png", "image/jpeg", 1)
	_, err := s.SetAvatar(u.ID, mislabelled)
	var ie *InputError
	if !errors.As(err, &ie) {
		t.Fatalf("want *InputError, got %v", err)
	}
}
