package main

import (
	"errors"

	"github.com/rexionmars/TerraEnergyEngine/internal/store"
)

/*
The account bindings.

Accounts are local and optional. Without one the application runs as the
guest; signing in separates one person's work from another's on the same
computer. The store's errors are written for the person using the form, so they
are returned as they are.
*/

// openAccounts opens the account store and restores the remembered session.
// Called from startup; a failure leaves the application running as the guest
// and the account bindings reporting why.
func (a *App) openAccounts() {
	a.bootLog("opening local store…")
	st, err := store.Open()
	if err != nil {
		a.accountsErr = err
		a.bootLog("store: " + err.Error())
		return
	}
	a.accounts = st

	u, err := st.RestoreSession()
	switch {
	case err == nil:
		a.setUser(u)
		a.bootLog("signed in · " + u.DisplayName)
	case errors.Is(err, store.ErrNotFound):
		a.bootLog("guest session")
	default:
		a.bootLog("session: " + err.Error())
	}
}

func (a *App) accountStore() (*store.Store, error) {
	if a.accounts == nil {
		msg := "the account store is unavailable"
		if a.accountsErr != nil {
			msg += ": " + a.accountsErr.Error()
		}
		return nil, errors.New(msg)
	}
	return a.accounts, nil
}

func (a *App) setUser(u *store.User) {
	a.userMu.Lock()
	a.user = u
	a.userMu.Unlock()
}

// signedIn returns the store and the signed-in account's id.
func (a *App) signedIn() (*store.Store, string, error) {
	st, err := a.accountStore()
	if err != nil {
		return nil, "", err
	}
	a.userMu.RLock()
	u := a.user
	a.userMu.RUnlock()
	if u == nil {
		return nil, "", errors.New("sign in first")
	}
	return st, u.ID, nil
}

// CurrentUser returns the signed-in account, or null for the guest.
func (a *App) CurrentUser() *store.User {
	a.userMu.RLock()
	defer a.userMu.RUnlock()
	return a.user
}

// Register creates a local account and signs it in.
func (a *App) Register(email, password, displayName string) (*store.User, error) {
	st, err := a.accountStore()
	if err != nil {
		return nil, err
	}
	u, err := st.Register(email, password, displayName)
	if err != nil {
		return nil, err
	}
	a.setUser(u)
	return u, nil
}

// Login signs in a local account.
func (a *App) Login(email, password string) (*store.User, error) {
	st, err := a.accountStore()
	if err != nil {
		return nil, err
	}
	u, err := st.Login(email, password)
	if err != nil {
		return nil, err
	}
	a.setUser(u)
	return u, nil
}

// Logout ends the session and returns to the guest.
func (a *App) Logout() error {
	st, err := a.accountStore()
	if err != nil {
		return err
	}
	if err := st.Logout(); err != nil {
		return err
	}
	a.setUser(nil)
	return nil
}

// UpdateDisplayName renames the signed-in account.
func (a *App) UpdateDisplayName(displayName string) (*store.User, error) {
	st, id, err := a.signedIn()
	if err != nil {
		return nil, err
	}
	u, err := st.UpdateDisplayName(id, displayName)
	if err != nil {
		return nil, err
	}
	a.setUser(u)
	return u, nil
}

// SetAvatar stores the signed-in account's photo from an image data URI.
func (a *App) SetAvatar(dataURI string) (*store.User, error) {
	st, id, err := a.signedIn()
	if err != nil {
		return nil, err
	}
	u, err := st.SetAvatar(id, dataURI)
	if err != nil {
		return nil, err
	}
	a.setUser(u)
	return u, nil
}

// ClearAvatar removes the signed-in account's photo.
func (a *App) ClearAvatar() (*store.User, error) {
	st, id, err := a.signedIn()
	if err != nil {
		return nil, err
	}
	u, err := st.ClearAvatar(id)
	if err != nil {
		return nil, err
	}
	a.setUser(u)
	return u, nil
}
