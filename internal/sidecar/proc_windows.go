//go:build windows

package sidecar

import (
	"os/exec"
	"strconv"
	"syscall"
)

// configureProcess hides the console window and makes cancellation end the
// interpreter together with its descendants. Windows has no process groups in
// the POSIX sense; taskkill /T walks the process tree instead.
func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Cancel = func() error {
		kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
		if err := kill.Run(); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
}
