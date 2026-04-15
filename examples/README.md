# Examples

Sample Journey projects checked in for local dev-testing.

## `petstore`

Minimal project wired to the public Swagger Petstore API
(`https://petstore3.swagger.io/api/v3`). Has one journey, one
environment, and a generated endpoints/models pair.

```bash
# From the repo root:
pnpm dev:web
```

This builds `@journey/cli`, starts `journey serve --project examples/petstore`
on port 5181, and the Vite dev server on port 5173. Open http://localhost:5173.
Both processes are killed together on Ctrl+C.

To point the backend at a different project of your own, skip `dev:web` and
run the two halves manually:

```bash
pnpm --filter @journey/cli build
node packages/cli/dist/index.js serve --project /path/to/your/project
# in a separate terminal
pnpm --filter @journey/gui dev
```
