package client

// Run `make openapi` from the repo root to regenerate this file.
// The directive below is intentionally left as documentation of the command shape;
// it does not work via `go generate ./...` because oapi-codegen resolves paths from
// the config-file directory (cli/), not the package directory (cli/internal/client/).
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config=../../oapi-codegen.yaml ../../../openapi/wal-qt.yaml
