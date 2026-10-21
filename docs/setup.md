# Development setup

GoShop needs five tools. The versions the repo expects are pinned in files, so tools that read them pick the right version automatically.

| Tool | Version | Pinned in |
|---|---|---|
| Go | 1.26+ | `.go-version`, later `apps/api/go.mod` |
| Node.js | 24 LTS (22.12+ works) | `.nvmrc`, `package.json` `engines` |
| pnpm | 10 | `package.json` `packageManager` |
| Docker + Compose v2 | any recent | — |
| golangci-lint | v2 (needed from Bab 2) | — |

When everything is installed, run the check from the repository root:

```bash
./scripts/check-tools.sh     # `make doctor` runs the same script (the Makefile arrives in artikel-12)
```

Every line must say `ok`. `golangci-lint` is reported as `optional` until Bab 2, when `apps/api` appears and `make lint` starts using it.

## Go and GOTOOLCHAIN

Since Go 1.21 the `go` command can download the toolchain a module asks for. With the default `GOTOOLCHAIN=auto`, an older Go (1.21 or newer) builds `apps/api` (which declares `go 1.26`) by fetching Go 1.26 on the first build. The tool check accepts that setup. If you set `GOTOOLCHAIN=local`, you must install Go 1.26 or newer yourself.

```bash
go version
go env GOTOOLCHAIN   # auto is the default
```

## macOS

```bash
# Homebrew: https://brew.sh
brew install go git

# Node.js through nvm, so .nvmrc picks the version
brew install nvm            # then follow the shell setup brew prints
nvm install                 # reads .nvmrc (24)
corepack enable pnpm        # pnpm version comes from package.json

# Docker: either Docker Desktop, or colima (no desktop app needed)
brew install colima docker docker-compose
colima start --cpu 4 --memory 6

# Linter for Go (from Bab 2)
brew install golangci-lint
```

With colima, `docker compose` (the plugin) may be missing and `docker-compose` (the standalone binary) is used instead. The Makefile detects both.

## Linux (Debian/Ubuntu)

```bash
sudo apt-get update && sudo apt-get install -y git curl make

# Go: official tarball (distro packages are usually too old)
GO_VERSION=1.27.3   # any release >= 1.26 works; newest stable is on https://go.dev/dl/
curl -LO "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf "go${GO_VERSION}.linux-amd64.tar.gz"
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc

# Node.js through nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc            # loads nvm and the Go PATH in this shell
nvm install                 # reads .nvmrc
corepack enable pnpm

# Docker Engine + Compose plugin: https://docs.docker.com/engine/install/ubuntu/
sudo usermod -aG docker "$USER"   # log out and in again afterwards

# Linter for Go (from Bab 2): https://golangci-lint.run/welcome/install/
```

On ARM machines use the `linux-arm64` download instead of `linux-amd64`.

## Windows (WSL 2)

Develop inside WSL 2, not in PowerShell. The scripts and the Makefile are Bash.

1. In an administrator PowerShell: `wsl --install -d Ubuntu`, then restart.
2. Install Docker Desktop and enable **Settings → Resources → WSL integration** for the Ubuntu distribution.
3. Open the Ubuntu terminal and follow the Linux steps above, skipping Docker Engine.
4. Clone the repository inside the WSL file system (for example `~/code/shop-app`), not under `/mnt/c`, so file watching and builds stay fast.

## Editor

Any editor works. For VS Code, install these extensions (the `.vscode/` folder is gitignored, so the list lives here):

| Extension | ID | Why |
|---|---|---|
| Go | `golang.go` | gopls, debugging, test runner |
| ESLint | `dbaeumer.vscode-eslint` | lint errors inline in the TypeScript apps |
| Prettier | `esbenp.prettier-vscode` | formatting for TypeScript, JSON and Markdown |
| EditorConfig | `editorconfig.editorconfig` | applies `.editorconfig` (tabs for Go and Makefile) |
| YAML | `redhat.vscode-yaml` | `docker-compose.yml`, `api/openapi.yaml` |
| Redocly OpenAPI | `redocly.openapi-vs-code` | validation and preview for `api/openapi.yaml` |
| Docker | `docker.docker` | Dockerfile and Compose support |
| Markdown Mermaid | `bierner.markdown-mermaid` | renders the diagrams in `docs/` |

GoLand or WebStorm work as well; enable gofmt/goimports on save and the EditorConfig support.

## Next steps

```bash
cp .env.example .env
make up            # Postgres, Redis and SeaweedFS
make verify        # the full local gate
```

On the `bab-1` branch, `.env.example` arrives in artikel-13 and the `Makefile` in artikel-12.
