---
title: Getting started
description: Install the CLI, scaffold a project from an OpenAPI spec, write a first journey, and run it.
sources:
  - packages/cli/src/commands/init.ts
  - packages/cli/src/commands/generate.ts
  - packages/cli/src/commands/run.ts
  - packages/core/src/config.ts
---

# Getting started

Journey projects live as plain directories in your repo — no lockfile in the cloud, no login, no workspace service. This page walks through installing the CLI, scaffolding a project from an OpenAPI spec, writing a first journey, and running it.

## Requirements

- **Node.js 20** or newer (the CLI uses native `fetch` and ES module features from Node 20).
- An **OpenAPI 3.x** spec — YAML or JSON, local file or available on disk.

## Install

```sh
# inside a repo
pnpm add -D @usejourney/cli

# or globally
pnpm add -g @usejourney/cli
```

The CLI is published as `@usejourney/cli` and exposes a single binary, `journey`.

## Scaffold a project

Pick a directory for the new project and point `journey init` at your spec:

```sh
journey init my-api --spec ./openapi.yaml
```

This creates:

```
my-api/
├── journey.config.json      # project config — edit this
├── openapi.yaml             # copied from the --spec path
├── generated/
│   ├── endpoints.ts         # typed endpoint refs (do not edit)
│   └── models.ts             # typed request/response models (do not edit)
├── journeys/                # your .journey.ts files go here
├── environments/            # per-environment JSON files
├── .journey/
│   └── cache/               # run history (gitignored)
└── .gitignore
```

The output tells you how many OpenAPI operations were discovered:

```
Initialized Journey project at /abs/path/to/my-api (N operations).
```

If the target directory isn't empty, `journey init` refuses. Pass `--force` to override — useful when bolting Journey onto an existing repo.

### Configure the base URL

Open `journey.config.json` and add a `baseUrl` so requests know where to go:

```json
{
  "name": "my-api",
  "spec": "openapi.yaml",
  "generatedDir": "generated",
  "journeysDir": "journeys",
  "environmentsDir": "environments",
  "baseUrl": "http://127.0.0.1:5180",
  "defaultEnvironment": "dev"
}
```

See the [config reference](../reference/config) for every supported field.

### Regenerate after spec changes

When your OpenAPI spec changes, regenerate `generated/`:

```sh
journey generate
```

It only rewrites `generated/endpoints.ts` and `generated/models.ts`. Your `journeys/` directory is never touched.

## Write your first journey

Create `journeys/hello.journey.ts`:

```ts
import { journey, step, expect } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";

journey("hello", () => {
  step("ping", {
    endpoint: endpoints.ping, // replace with something in your spec
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
```

`endpoints.ping` comes from `generated/endpoints.ts` — your IDE will autocomplete from the real list of operations in your spec. Types for the response body (`res.body`) flow through automatically.

For a thorough tour of everything `step()` accepts — path params, query strings, headers, bodies, timeouts, `assert`, `after`, descriptor endpoints — see [Writing journeys](./writing-journeys/).

## Add an environment (optional)

Credentials and secrets go in per-environment JSON files:

```json
// environments/dev.json
{
  "USERNAME": "alice",
  "PASSWORD": "wonderland"
}
```

Read them from journeys with `env()`:

```ts
step("login", {
  endpoint: endpoints.login,
  body: { username: env("USERNAME"), password: env("PASSWORD") },
});
```

See [Environments](./environments/) for where to store secrets and how `--env` selection works.

## Run

```sh
journey run journeys/hello.journey.ts --env dev
```

Output looks like:

```
✓ hello (42ms)
  ✓ ping GET http://127.0.0.1:5180/ping → 200 (41ms)

1 passed, 0 failed
```

Other common invocations:

```sh
# run every .journey.ts in journeys/
journey run --all --env dev

# rerun on file changes
journey run --all --env dev --watch

# log every HTTP request/response to stderr
journey run journeys/hello.journey.ts --env dev --debug
```

Exit code is `0` if every step passed, `1` otherwise — drop it straight into CI.

Full command reference: [`journey run`](./cli/run).

## Next steps

- [Writing journeys](./writing-journeys/) — every option of `step()`, broken out by topic.
- [Environments](./environments/) — file format, `--env` selection, secret handling.
- [CLI](./cli/) — per-command reference including `run --watch`, `export k6`, `serve`.
- [GUI](./gui/) — running journeys from the desktop app.
