# caus

Prototype sandbox for a mobile online indie game with event sourcing.

- [Prototype spec](docs/prototype-spec.md)
- [Design checkpoint (second iteration)](docs/design-checkpoint-second-iteration.md)
- [Design checkpoint (first iteration)](docs/design-checkpoint-first-iteration.md)

## Setup

```bash
nvm use        # switch to the correct Node version
make install   # install dependencies
```

## Commands

| Command          | Description                          |
|------------------|--------------------------------------|
| `make dev`       | Run `src/index.ts` in watch mode     |
| `make start`     | Run `src/index.ts` once              |
| `make test`      | Run tests in watch mode (vitest)     |
| `make test-run`  | Run tests once                       |
| `make typecheck` | Type-check without emitting          |
| `make clean`     | Remove `node_modules` and `dist`     |

## Stack

- **Runtime**: Node 22 (via nvm)
- **Language**: TypeScript 5 (strict, ESM)
- **Runner**: tsx (run `.ts` files directly, no build step needed)
- **Tests**: Vitest
