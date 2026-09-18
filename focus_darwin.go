//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
)

// focusApp brings the application to the foreground after the splash hands
// over to the main window. WindowShow alone leaves the previously active
// application in front on macOS.
func focusApp() {
	script := fmt.Sprintf(
		`tell application "System Events" to set frontmost of first process whose unix id is %s to true`,
		strconv.Itoa(os.Getpid()),
	)
	_ = exec.Command("osascript", "-e", script).Run()
}
