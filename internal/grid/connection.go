package grid

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

/*
The store's connection as the fields a person fills in, and the connection
string those fields stand for.

The string stays what is saved and what the sidecar is sent: the fields are a
way of writing it, not a second configuration. Only the URL form is taken apart
(postgresql://user:secret@host:port/database?sslmode=...). The keyword form
(host=... dbname=...) is still read by the sidecar when it is what
TERRA_BR_DSN holds, but it is not turned into fields.
*/

// DefaultDatabase is the database an empty field stands for, the one in
// DefaultDSN.
const DefaultDatabase = "terra_br"

// StoreConnection is a store's connection, field by field. Every field may be
// empty, which is libpq's own default for it: the local socket, port 5432, the
// user's own role. An empty Database is DefaultDatabase.
type StoreConnection struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
	// One of libpq's sslmode values, or empty for libpq's default (prefer).
	SSLMode string `json:"ssl_mode"`
	// Parameters of the connection string the fields do not show, carried
	// unchanged so that importing a string and saving it loses nothing.
	Params map[string]string `json:"params,omitempty"`
	// Whether a password is saved that Password does not carry. A saved
	// password is never sent back to the interface, so an empty Password with
	// this set means "the one already saved".
	HasPassword bool `json:"has_password"`
}

var sslModes = map[string]bool{"": true, "disable": true, "allow": true, "prefer": true, "require": true, "verify-ca": true, "verify-full": true}

// ParseDSN takes a connection string in the URL form apart into its fields,
// password included.
func ParseDSN(dsn string) (StoreConnection, error) {
	dsn = strings.TrimSpace(dsn)
	if !strings.HasPrefix(dsn, "postgresql://") && !strings.HasPrefix(dsn, "postgres://") {
		return StoreConnection{}, errors.New("not a PostgreSQL URL: it should start with postgresql://")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		// url.Parse quotes the whole string in its error, password included.
		return StoreConnection{}, errors.New("the URL could not be read; a password with special characters has to be percent-encoded")
	}
	c := StoreConnection{Host: u.Hostname(), Port: u.Port(), Database: strings.TrimPrefix(u.Path, "/")}
	if u.User != nil {
		c.User = u.User.Username()
		c.Password, _ = u.User.Password()
	}
	for key, values := range u.Query() {
		if len(values) == 0 {
			continue
		}
		if key == "sslmode" {
			c.SSLMode = values[0]
			continue
		}
		if c.Params == nil {
			c.Params = map[string]string{}
		}
		c.Params[key] = values[0]
	}
	return c, nil
}

// DSN is the connection string the fields stand for, or why they do not make
// one.
func (c StoreConnection) DSN() (string, error) {
	host, port := strings.TrimSpace(c.Host), strings.TrimSpace(c.Port)
	if port != "" {
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("the port %q is not a number from 1 to 65535", port)
		}
	}
	if !sslModes[c.SSLMode] {
		return "", fmt.Errorf("unknown SSL mode %q", c.SSLMode)
	}
	database := strings.TrimSpace(c.Database)
	if database == "" {
		database = DefaultDatabase
	}

	u := url.URL{Scheme: "postgresql", Host: host, Path: "/" + database}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		// An IPv6 address without a port still needs its brackets.
		u.Host = "[" + host + "]"
	}
	if user := strings.TrimSpace(c.User); user != "" || c.Password != "" {
		if c.Password != "" {
			u.User = url.UserPassword(user, c.Password)
		} else {
			u.User = url.User(user)
		}
	}
	q := url.Values{}
	for key, value := range c.Params {
		q.Set(key, value)
	}
	if c.SSLMode != "" {
		q.Set("sslmode", c.SSLMode)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// WithSavedPassword fills in the password of the saved connection string when
// the fields ask for the one already saved.
func (c StoreConnection) WithSavedPassword(saved string) StoreConnection {
	if c.Password != "" || !c.HasPassword {
		return c
	}
	if old, err := ParseDSN(saved); err == nil {
		c.Password = old.Password
	}
	return c
}

// SavedConnection is the chosen connection string as fields, for the
// interface: the password is left out and only reported as present. A string
// that is empty or not in the URL form is the empty connection.
func SavedConnection(chosen string) StoreConnection {
	c, err := ParseDSN(chosen)
	if err != nil {
		return StoreConnection{}
	}
	c.HasPassword = c.Password != ""
	c.Password = ""
	return c
}
