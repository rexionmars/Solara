package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrEmailTaken         = errors.New("an account with this email already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrNotFound           = errors.New("account not found")
)

// InputError is a request refused as malformed. Its message is written for
// the person who typed the value, and the interface shows it as it is.
type InputError struct{ Reason string }

func (e *InputError) Error() string { return e.Reason }

func invalid(format string, args ...any) error {
	return &InputError{Reason: fmt.Sprintf(format, args...)}
}

const (
	sessionTTL  = 30 * 24 * time.Hour
	sessionFile = "session.token"
	avatarDir   = "avatars"

	minPasswordChars = 8
	// bcrypt reads at most 72 bytes; a longer password would be silently
	// truncated to them, so it is refused instead.
	maxPasswordBytes = 72
	maxNameChars     = 80

	// The interface crops and scales a photo to 256 px before sending it, which
	// lands well under this; the limit is for a client that does not.
	maxAvatarBytes = 1_000_000
)

// User is an account as the interface sees it. The password hash never
// leaves this package.
type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	// The photo as a data URI, so the webview never reads the filesystem.
	AvatarURI string `json:"avatar_uri,omitempty"`
	CreatedAt string `json:"created_at"`
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	// ParseAddress also accepts `Name <a@b>`; requiring the parsed address to
	// equal the input keeps the stored value a bare address.
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return "", invalid("enter a valid email address")
	}
	return email, nil
}

func validatePassword(p string) error {
	if utf8.RuneCountInString(p) < minPasswordChars {
		return invalid("the password must have at least %d characters", minPasswordChars)
	}
	if len(p) > maxPasswordBytes {
		return invalid("the password is too long; bcrypt reads at most %d bytes", maxPasswordBytes)
	}
	return nil
}

func normalizeName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", invalid("enter a display name")
	}
	if utf8.RuneCountInString(name) > maxNameChars {
		return "", invalid("the display name must have at most %d characters", maxNameChars)
	}
	return name, nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Register creates an account and signs it in.
func (s *Store) Register(email, password, displayName string) (*User, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return nil, err
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	name, err := normalizeName(displayName)
	if err != nil {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	id, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	now := stamp(time.Now())
	_, err = s.db.Exec(
		`INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, email, name, string(hash), now, now,
	)
	if isUniqueViolation(err) {
		return nil, ErrEmailTaken
	}
	if err != nil {
		return nil, err
	}
	if err := s.startSession(id); err != nil {
		return nil, err
	}
	return s.User(id)
}

/*
A hash compared against when the email matches no account, so that an unknown
email costs the same bcrypt comparison as a wrong password. Without it the
response time says which addresses have accounts. Built on first use: it costs
one bcrypt round, which is not worth paying at every start.
*/
var absentAccountHash = sync.OnceValue(func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("no account has this password"), bcrypt.DefaultCost)
	return h
})

// Login signs in the account with this email and password. An unknown email
// and a wrong password return the same error.
func (s *Store) Login(email, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	var id, hash string
	err := s.db.QueryRow(`SELECT id, password_hash FROM users WHERE email = ?`, email).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(absentAccountHash(), []byte(password))
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	if err := s.startSession(id); err != nil {
		return nil, err
	}
	return s.User(id)
}

func (s *Store) sessionPath() string { return filepath.Join(s.dataDir, sessionFile) }

/*
hashToken is what the sessions table stores in place of the token.

The token itself is kept only in the session file. A copy of the database --
a backup, a file shared to report a bug -- then carries no session that could
be replayed.
*/
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// startSession ends any session this computer holds and starts one for userID,
// valid for sessionTTL and remembered across restarts in the session file.
func (s *Store) startSession(userID string) error {
	if err := s.Logout(); err != nil {
		return err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now()
	if _, err := s.db.Exec(
		`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), userID, stamp(now), stamp(now.Add(sessionTTL)),
	); err != nil {
		return err
	}
	return os.WriteFile(s.sessionPath(), []byte(token), 0o600)
}

// readSessionToken returns the remembered token, or "" when there is none.
func (s *Store) readSessionToken() (string, error) {
	b, err := os.ReadFile(s.sessionPath())
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// RestoreSession returns the account the remembered session belongs to. It
// returns ErrNotFound when there is no session, or it has expired, in which
// case the session is also removed.
func (s *Store) RestoreSession() (*User, error) {
	token, err := s.readSessionToken()
	if err != nil {
		return nil, err
	}
	if token == "" {
		return nil, ErrNotFound
	}
	var userID string
	err = s.db.QueryRow(
		`SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?`,
		hashToken(token), stamp(time.Now()),
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		if err := s.Logout(); err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.User(userID)
}

// Logout ends the session this computer holds, if any.
func (s *Store) Logout() error {
	token, err := s.readSessionToken()
	if err != nil {
		return err
	}
	if token != "" {
		if _, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(token)); err != nil {
			return err
		}
	}
	if err := os.Remove(s.sessionPath()); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// pruneSessions deletes expired sessions. Run at every open: a session is
// otherwise removed only when someone tries to use it after it expired.
func (s *Store) pruneSessions() error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, stamp(time.Now()))
	return err
}

// User returns the account with this id.
func (s *Store) User(id string) (*User, error) {
	var u User
	var avatar sql.NullString
	err := s.db.QueryRow(
		`SELECT id, email, display_name, avatar_file, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &avatar, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if avatar.Valid && avatar.String != "" {
		u.AvatarURI = s.avatarDataURI(avatar.String)
	}
	return &u, nil
}

// UpdateDisplayName renames the account.
func (s *Store) UpdateDisplayName(userID, displayName string) (*User, error) {
	name, err := normalizeName(displayName)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`,
		name, stamp(time.Now()), userID,
	)
	if err := requireOneRow(res, err); err != nil {
		return nil, err
	}
	return s.User(userID)
}

func requireOneRow(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

var avatarExt = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// decodeAvatar parses a base64 image data URI and checks the bytes against the
// type it declares, so a file renamed to .png is refused rather than stored
// under a type it is not.
func decodeAvatar(dataURI string) (mime string, raw []byte, err error) {
	rest, ok := strings.CutPrefix(dataURI, "data:")
	if !ok {
		return "", nil, invalid("the photo could not be read")
	}
	meta, payload, ok := strings.Cut(rest, ",")
	mime, isBase64 := strings.CutSuffix(meta, ";base64")
	if !ok || !isBase64 {
		return "", nil, invalid("the photo could not be read")
	}
	if _, known := avatarExt[mime]; !known {
		return "", nil, invalid("the photo must be PNG, JPEG, WebP or GIF")
	}
	raw, err = base64.StdEncoding.DecodeString(payload)
	if err != nil || len(raw) == 0 {
		return "", nil, invalid("the photo could not be read")
	}
	if len(raw) > maxAvatarBytes {
		return "", nil, invalid("the photo must be at most %d kB", maxAvatarBytes/1000)
	}
	if http.DetectContentType(raw) != mime {
		return "", nil, invalid("the photo's contents do not match its type")
	}
	return mime, raw, nil
}

// SetAvatar stores the account's photo from a base64 image data URI.
func (s *Store) SetAvatar(userID, dataURI string) (*User, error) {
	mime, raw, err := decodeAvatar(dataURI)
	if err != nil {
		return nil, err
	}
	previous, err := s.avatarFile(userID)
	if err != nil {
		return nil, err
	}

	dir := filepath.Join(s.dataDir, avatarDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	name := userID + avatarExt[mime]
	// Written beside the final name and renamed over it, so a failed write
	// never leaves the account pointing at part of a file.
	tmp := filepath.Join(dir, name+".tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}

	res, err := s.db.Exec(
		`UPDATE users SET avatar_file = ?, updated_at = ? WHERE id = ?`,
		name, stamp(time.Now()), userID,
	)
	if err := requireOneRow(res, err); err != nil {
		return nil, err
	}
	// A photo of another type had another extension, so it was not replaced
	// by the rename above.
	if previous != "" && previous != name {
		_ = os.Remove(filepath.Join(dir, previous))
	}
	return s.User(userID)
}

// ClearAvatar removes the account's photo.
func (s *Store) ClearAvatar(userID string) (*User, error) {
	previous, err := s.avatarFile(userID)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(
		`UPDATE users SET avatar_file = NULL, updated_at = ? WHERE id = ?`,
		stamp(time.Now()), userID,
	)
	if err := requireOneRow(res, err); err != nil {
		return nil, err
	}
	if previous != "" {
		_ = os.Remove(filepath.Join(s.dataDir, avatarDir, previous))
	}
	return s.User(userID)
}

func (s *Store) avatarFile(userID string) (string, error) {
	var name sql.NullString
	err := s.db.QueryRow(`SELECT avatar_file FROM users WHERE id = ?`, userID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return name.String, nil
}

// avatarDataURI reads a stored photo back as a data URI, or "" when the file
// is gone -- a missing photo shows the initial in its place rather than
// failing the whole account.
func (s *Store) avatarDataURI(name string) string {
	raw, err := os.ReadFile(filepath.Join(s.dataDir, avatarDir, name))
	if err != nil || len(raw) == 0 {
		return ""
	}
	mime := http.DetectContentType(raw)
	if _, known := avatarExt[mime]; !known {
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)
}
