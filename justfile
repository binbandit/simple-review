set positional-arguments

default:
    @just --list

build:
    bun install --frozen-lockfile
    bun run build

install dest=(env_var('HOME') + '/.local/bin'): build
    mkdir -p "$1"
    install -m 755 dist/review "$1/review"
    @echo "Installed review to $1/review. Add $1 to your PATH if needed."

check:
    bun run check
    bun test

# Runs 14 curated examples against live Jev; requires TYPESAFE_API_KEY and uses API credits.
eval:
    bun test ./test/slop.eval.ts
