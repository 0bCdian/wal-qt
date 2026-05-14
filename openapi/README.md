# wal-qt OpenAPI spec

`wal-qt.yaml` is the **source of truth** for the HTTP control API exposed by the
wal-qt host process over its Unix domain socket (`$XDG_RUNTIME_DIR/wal-qt.sock`).

Edit the spec first; regenerate clients afterwards.

## Transport note

OpenAPI does not model Unix-domain sockets. The spec uses `servers: [{url: "/"}]`
to describe message shapes only. All requests are HTTP/1.1 over the socket path
above. Connections are close-after-response (no keep-alive).

## Generator

We use **[oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)** (idiomatic
Go types + net/http client generation).

## Regen commands

**CLI client** (wal-qt/cli/):

```sh
oapi-codegen -package client -generate types,client \
  openapi/wal-qt.yaml > cli/internal/client/client.gen.go
```

**Engine daemon client** (waypaper-engine vendored copy):

```sh
# From the waypaper-engine repo root:
make sync-walqt-spec   # copies spec then runs oapi-codegen
```

The engine Makefile target keeps the vendored spec in sync; run it after every
spec change that affects the engine client.

## Validate

```sh
pnpm dlx @redocly/cli lint openapi/wal-qt.yaml
```
