// Package migrations holds the database migrations, in golang-migrate's
// format: NNNNNN_name.up.sql applies a change, NNNNNN_name.down.sql reverses
// it. They are embedded in the api binary, so `api migrate` can apply them
// from a distroless image that has no files besides the binary.
package migrations

import "embed"

// FS holds every *.sql file in this directory.
//
//go:embed *.sql
var FS embed.FS
