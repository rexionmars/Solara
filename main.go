/*
Command TerraEnergyEngine is the desktop shell of TERRA Energy Engine.

The shell opens the window, embeds the built frontend and exposes the methods
the interface calls. Computation happens in a Python sidecar started once per
request; see internal/sidecar.
*/
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title: "TERRA Energy Engine",
		// Splash-sized. RevealMainWindow raises the limits and maximises the
		// window once boot:ready has been handled.
		Width:            420,
		Height:           280,
		MinWidth:         360,
		MinHeight:        220,
		AlwaysOnTop:      true,
		BackgroundColour: &options.RGBA{R: 23, G: 23, B: 23, A: 1},
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Rendered layers are fetched by URL from the results directory;
			// see app_results.go.
			Middleware: app.resultsMiddleware,
		},
		OnStartup:  app.startup,
		OnDomReady: app.domReady,
		// Asks before quitting with unsaved project changes; see app_project.go.
		OnBeforeClose: app.beforeClose,
		OnShutdown:    app.shutdown,
		Bind:          []interface{}{app},
		Mac: &mac.Options{
			// A titled window with a transparent, title-less bar and full-size
			// content: the splash has no title strip above it, and the main
			// header sits beside the traffic lights. Frameless would also
			// remove the title strip, but TERRA measured it degrading the
			// compositing of every other window sharing its space.
			TitleBar:   mac.TitleBarHidden(),
			Appearance: mac.NSAppearanceNameDarkAqua,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
