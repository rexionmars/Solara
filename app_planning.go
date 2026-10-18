package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// AnalyzeSystemPlanning occupies the cancellable analysis slot, unlike map reads.
func (a *App) AnalyzeSystemPlanning(study map[string]any) (map[string]any, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Minute)
	defer cancel()
	out, err := r.Run(ctx, map[string]any{"action": "system_planning", "study": study}, a.emitProgress)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("decode planning result: %w", err)
	}
	return result, nil
}

// SavePlanningDocument exports the reviewed study or its reproducible run report.
func (a *App) SavePlanningDocument(document map[string]any) (string, error) {
	body, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Save Solora planning document", DefaultFilename: "solora-planning.json",
		Filters: []runtime.FileFilter{{DisplayName: "Planning JSON", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, append(body, '\n'), 0600)
}
