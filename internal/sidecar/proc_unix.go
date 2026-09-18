//go:build !windows

package sidecar

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

// configureProcess starts the interpreter as the leader of a new process
// group and makes cancellation signal the whole group. exec.CommandContext on
// its own kills only the interpreter, and anything it started keeps running.
func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		// A negative pid addresses the process group whose id is pid.
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
}
