package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

/*
Project files: saving and reopening a session's work, exporting a result, and
the guard against quitting with unsaved changes.

A project is two things on disk, side by side:

	Site.terra          the interface's document, opaque to the shell
	Site.terra-data/    one subdirectory per run the document refers to

The shell never reads the document. The interface serialises it and names the
runs it refers to, and the shell only moves those runs' files. Keeping the
rasters out of the document keeps it small enough to write and read in one
piece through the bindings, which marshal everything to a JSON string (the
reason the results directory exists at all; see app_results.go).

The runs have to be copied rather than referenced: the results directory is
removed at shutdown, so a project that pointed into it would lose its layers
the moment the application quit. On open they are copied back into this
session's results directory, where resultsMiddleware serves them under their
original ids, so the URLs the document holds keep working. A run's files do
not change once the analysis has written them, which is what makes a copy under
the same id interchangeable with the original.
*/

const (
	projectExt = ".terra"
	// Suffix of the data folder beside a project file.
	projectDataSuffix = ".terra-data"
	// Largest project document OpenProject reads. The document holds results
	// summaries and drawn areas, not rasters; past this it is not a project
	// file, and reading it whole would hand the webview a string it cannot
	// take anyway.
	maxProjectBytes = 256 << 20
)

// projectFilter is the dialog filter for project files.
var projectFilter = []wruntime.FileFilter{{DisplayName: "TERRA project (*.terra)", Pattern: "*.terra"}}

// OpenedProject is a project file read by OpenProject.
type OpenedProject struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	// Run id -> absolute directory of that run inside this session's results
	// directory, for every run restored from the project's data folder.
	RunDirs map[string]string `json:"run_dirs"`
}

// SaveProject writes the document and copies the runs it names into the
// project's data folder. An empty path asks for one; a cancelled dialog returns
// an empty path and no error. It returns the path written, with the extension
// added when the name lacked it.
func (a *App) SaveProject(path string, content string, runIDs []string) (string, error) {
	if path == "" {
		chosen, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
			Title:                "Save Project",
			DefaultFilename:      "Untitled" + projectExt,
			Filters:              projectFilter,
			CanCreateDirectories: true,
		})
		if err != nil || chosen == "" {
			return "", err
		}
		path = chosen
	}
	return a.saveProjectTo(path, content, runIDs)
}

// OpenProject reads a project file and restores its runs into this session. An
// empty path asks for one; a cancelled dialog returns nil and no error.
func (a *App) OpenProject(path string) (*OpenedProject, error) {
	if path == "" {
		chosen, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
			Title:   "Open Project",
			Filters: projectFilter,
		})
		if err != nil || chosen == "" {
			return nil, err
		}
		path = chosen
	}
	return a.openProjectFrom(path)
}

// ExportResultFile copies a file from this session's results directory to a
// place the user picks. A cancelled dialog returns an empty path and no error.
func (a *App) ExportResultFile(src string, defaultName string) (string, error) {
	if a.resultsDir == "" {
		return "", errors.New("no results directory: " + errString(a.resultsErr))
	}
	// Checked before the dialog, so the user is not asked where to put a file
	// that will then be refused.
	if _, err := resultFile(a.resultsDir, src); err != nil {
		return "", err
	}
	if defaultName == "" {
		defaultName = filepath.Base(src)
	}
	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                "Export",
		DefaultFilename:      defaultName,
		Filters:              filterFor(defaultName),
		CanCreateDirectories: true,
	})
	if err != nil || dest == "" {
		return "", err
	}
	if err := exportInside(a.resultsDir, src, dest); err != nil {
		return "", err
	}
	return dest, nil
}

// SaveTextFile writes content to a file the user picks: a report, a CSV, a
// GeoJSON outline. A cancelled dialog returns an empty path and no error.
func (a *App) SaveTextFile(defaultName string, filterName string, pattern string, content string) (string, error) {
	opts := wruntime.SaveDialogOptions{
		Title:                "Save",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
	}
	if pattern != "" {
		opts.Filters = []wruntime.FileFilter{{DisplayName: filterName, Pattern: pattern}}
	}
	dest, err := wruntime.SaveFileDialog(a.ctx, opts)
	if err != nil || dest == "" {
		return "", err
	}
	if err := writeFileAtomic(dest, []byte(content)); err != nil {
		return "", err
	}
	return dest, nil
}

// RevealInFileManager shows path in the system file manager: selected in its
// folder on macOS and Windows, and the folder itself elsewhere, where no
// command selects a file portably.
func (a *App) RevealInFileManager(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		// Two arguments rather than "/select,"+path: os/exec quotes an argument
		// holding a space as a whole, and explorer does not parse a quoted
		// "/select,C:\a b" as the switch. It does accept the path quoted on its
		// own after the comma.
		cmd = exec.Command("explorer", "/select,", path)
	default:
		dir := path
		if !info.IsDir() {
			dir = filepath.Dir(path)
		}
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	// Not waited on by the binding: xdg-open can stay attached to the file
	// manager it launched, and explorer exits with status 1 even when it
	// succeeds, so the exit status says nothing useful. Reaped here so it does
	// not linger as a zombie.
	go func() { _ = cmd.Wait() }()
	return nil
}

// SetProjectDirty records whether the open project has unsaved changes. The
// interface owns the document and so is the only side that knows; the shell
// needs the answer at close, when there is no time to ask the webview.
func (a *App) SetProjectDirty(dirty bool) {
	a.projectDirty.Store(dirty)
}

// beforeClose asks before a window close would discard unsaved changes, and
// reports whether to prevent the close.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if !a.projectDirty.Load() {
		return false
	}
	answer, err := wruntime.MessageDialog(ctx, wruntime.MessageDialogOptions{
		Type:          wruntime.QuestionDialog,
		Title:         "Unsaved changes",
		Message:       "The project has unsaved changes. Quit without saving?",
		Buttons:       []string{"Quit", "Cancel"},
		DefaultButton: "Cancel",
		CancelButton:  "Cancel",
	})
	if err != nil {
		// Kept open: a dialog that failed has not been answered, and closing
		// would discard the work it was meant to protect. Saving clears the
		// flag, so the window can still be closed.
		return true
	}
	// macOS returns the label of the button pressed. Windows and Linux ignore
	// the labels and show Yes and No, returning those; Yes answers the
	// question as asked, which is to quit.
	return answer != "Quit" && answer != "Yes"
}

// withProjectExt adds the project extension unless the name already has it, in
// any case: a file the user named Site.TERRA is not renamed Site.TERRA.terra.
func withProjectExt(path string) string {
	if strings.EqualFold(filepath.Ext(path), projectExt) {
		return path
	}
	return path + projectExt
}

// projectDataDir is the data folder of the project file at path.
func projectDataDir(path string) string {
	return path[:len(path)-len(filepath.Ext(path))] + projectDataSuffix
}

/*
saveProjectTo writes the document to path and the named runs beside it.

The order is chosen so that a failure part way leaves a usable project: every
run is copied into the data folder first, then the document is replaced in one
rename, and only after that are the runs the new document no longer names
removed. A copy that fails leaves the previous document and every run it
refers to in place.

A run that is no longer in this session but is already in the data folder is
kept as it is. That happens when a project is saved over itself after its runs
were restored in a session whose results directory has since lost them; the
copy in the data folder is the same run, so there is nothing to refresh.
*/
func (a *App) saveProjectTo(path string, content string, runIDs []string) (string, error) {
	ids, err := uniqueRunIDs(runIDs)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(withProjectExt(path))
	if err != nil {
		return "", err
	}
	data := projectDataDir(path)

	if len(ids) > 0 {
		if err := os.MkdirAll(data, 0o755); err != nil {
			return "", fmt.Errorf("create the project data folder: %w", err)
		}
	}
	for _, id := range ids {
		if err := a.storeRun(data, id); err != nil {
			return "", err
		}
	}

	if err := writeFileAtomic(path, []byte(content)); err != nil {
		return "", err
	}

	if len(ids) == 0 {
		if err := os.RemoveAll(data); err != nil {
			return "", fmt.Errorf("remove the project data folder: %w", err)
		}
		return path, nil
	}
	keep := make(map[string]bool, len(ids))
	for _, id := range ids {
		keep[id] = true
	}
	entries, err := os.ReadDir(data)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		// Directories only: a run is a directory, and a file in the data
		// folder is not something a save put there. That includes the staging
		// directories of a save that was interrupted, whose names are hidden.
		if e.IsDir() && !keep[e.Name()] {
			if err := os.RemoveAll(filepath.Join(data, e.Name())); err != nil {
				return "", fmt.Errorf("remove the stale run %s: %w", e.Name(), err)
			}
		}
	}
	return path, nil
}

// storeRun copies one run from the session into the data folder, replacing the
// copy already there.
func (a *App) storeRun(data, id string) error {
	dst := filepath.Join(data, id)
	src := ""
	if a.resultsDir != "" {
		src = filepath.Join(a.resultsDir, id)
	}
	if src == "" || !isDir(src) {
		if isDir(dst) {
			return nil
		}
		return fmt.Errorf("run %s is neither in this session nor in the project's data folder", id)
	}
	return copyDirReplacing(src, dst)
}

/*
openProjectFrom reads the document at path and restores its runs.

A run already in the results directory is left alone rather than overwritten:
the id names the same immutable files, and an analysis or a layer being served
may be reading them. Every directory in the data folder is restored, not only
those the document names, because the shell does not read the document; a
save leaves no others behind.
*/
func (a *App) openProjectFrom(path string) (*OpenedProject, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	content, err := readProjectFile(path)
	if err != nil {
		return nil, err
	}
	out := &OpenedProject{Path: path, Content: content, RunDirs: map[string]string{}}

	entries, err := os.ReadDir(projectDataDir(path))
	if errors.Is(err, fs.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the project data folder: %w", err)
	}
	for _, e := range entries {
		id := e.Name()
		// Hidden names are the staging directories of an interrupted save;
		// a run id never starts with a dot.
		if !e.IsDir() || !safeSegment(id) || strings.HasPrefix(id, ".") {
			continue
		}
		if a.resultsDir == "" {
			return nil, errors.New("no results directory to restore the project's runs into: " + errString(a.resultsErr))
		}
		dst := filepath.Join(a.resultsDir, id)
		if !exists(dst) {
			if err := copyDirReplacing(filepath.Join(projectDataDir(path), id), dst); err != nil {
				return nil, fmt.Errorf("restore run %s: %w", id, err)
			}
		}
		if isDir(dst) {
			out.RunDirs[id] = dst
		}
	}
	return out, nil
}

func readProjectFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a project file", path)
	}
	// Bounded on the read as well as the size reported, which a file still
	// being written can outgrow.
	b, err := io.ReadAll(io.LimitReader(f, maxProjectBytes+1))
	if err != nil {
		return "", err
	}
	if info.Size() > maxProjectBytes || len(b) > maxProjectBytes {
		return "", fmt.Errorf("%s is larger than %d MiB, which no project file is", path, maxProjectBytes>>20)
	}
	return string(b), nil
}

// uniqueRunIDs refuses an id that could name something other than a run
// directory, before anything is written, and drops repeats.
func uniqueRunIDs(runIDs []string) ([]string, error) {
	seen := make(map[string]bool, len(runIDs))
	out := make([]string, 0, len(runIDs))
	for _, id := range runIDs {
		if !safeSegment(id) || strings.HasPrefix(id, ".") {
			return nil, fmt.Errorf("not a run id: %q", id)
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out, nil
}

// resolveInside returns src as an absolute path, refused unless it names
// something strictly inside root. Lexical: a symbolic link inside root that
// points out of it is not detected, and nothing in the results directory
// creates one.
func resolveInside(root, src string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absRoot, absSrc)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("%s is not a file in this session's results", src)
	}
	return absSrc, nil
}

// resultFile returns src as an absolute path, refused unless it is a regular
// file inside root.
func resultFile(root, src string) (string, error) {
	absSrc, err := resolveInside(root, src)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(absSrc)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a file", src)
	}
	return absSrc, nil
}

// exportInside copies the regular file src, which must lie inside root, to dest.
func exportInside(root, src, dest string) error {
	absSrc, err := resultFile(root, src)
	if err != nil {
		return err
	}
	in, err := os.Open(absSrc)
	if err != nil {
		return err
	}
	defer in.Close()
	return writeAtomic(dest, func(w io.Writer) error {
		_, err := io.Copy(w, in)
		return err
	})
}

// filterFor is the save dialog filter for a file named name, from its
// extension. A name without one gets no filter rather than one that matches
// nothing.
func filterFor(name string) []wruntime.FileFilter {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" || ext == "." {
		return nil
	}
	label := map[string]string{
		".tif":     "GeoTIFF",
		".tiff":    "GeoTIFF",
		".png":     "PNG image",
		".json":    "JSON",
		".geojson": "GeoJSON",
		".csv":     "CSV",
	}[ext]
	if label == "" {
		label = strings.ToUpper(ext[1:]) + " file"
	}
	return []wruntime.FileFilter{{DisplayName: fmt.Sprintf("%s (*%s)", label, ext), Pattern: "*" + ext}}
}

// writeFileAtomic replaces path with b in one rename.
func writeFileAtomic(path string, b []byte) error {
	return writeAtomic(path, func(w io.Writer) error {
		_, err := w.Write(b)
		return err
	})
}

/*
writeAtomic writes through a temporary file in the destination's directory and
renames it over the destination, so a reader, or the user after a crash, finds
either the old file or the whole new one and never a truncated one. The same
directory, because a rename across file systems is a copy and not atomic.
*/
func writeAtomic(path string, write func(io.Writer) error) (err error) {
	dir, base := filepath.Split(path)
	if dir == "" {
		dir = "."
	}
	tmp, err := os.CreateTemp(dir, "."+base+".*.tmp")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if err = write(tmp); err != nil {
		return err
	}
	// Flushed before the rename: without it a crash can leave the new name
	// pointing at a file whose contents never reached the disk.
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	// CreateTemp makes the file 0600; a saved document is an ordinary user
	// file.
	if err = os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

/*
copyDirReplacing copies the directory tree src to dst, replacing dst.

The tree is copied into a hidden staging directory beside dst and renamed into
place, so a copy that fails part way never leaves a dst that looks complete:
openProjectFrom skips a run that already exists, and would otherwise keep a
half-copied one for good. Only directories and regular files are copied; the
analyses write nothing else, and following a link would copy whatever it points
at.
*/
func copyDirReplacing(src, dst string) (err error) {
	stage, err := os.MkdirTemp(filepath.Dir(dst), "."+filepath.Base(dst)+".partial-")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(stage)
		}
	}()
	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(stage, rel)
		switch {
		case d.IsDir():
			if rel == "." {
				return nil
			}
			return os.Mkdir(target, 0o700)
		case d.Type().IsRegular():
			return copyFile(p, target)
		default:
			return nil
		}
	})
	if err != nil {
		return err
	}
	// MkdirTemp creates 0700, the mode newRunDir gives a run.
	if err = os.RemoveAll(dst); err != nil {
		return err
	}
	return os.Rename(stage, dst)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
