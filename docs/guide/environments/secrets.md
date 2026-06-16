---
title: Secret handling
description: Where to put credentials, how to keep them out of git, and what the logger redacts.
sources:
  - packages/core/src/env.ts
  - packages/core/src/logger.ts
---

# Secret handling

Environments usually hold credentials. A few practical recipes.

## Gitignore real values, commit templates

```
# .gitignore
environments/*.json
!environments/*.template.json
```

```json
// environments/dev.template.json (committed)
{
  "USERNAME": "",
  "PASSWORD": ""
}
```

Collaborators copy the template into `environments/dev.json` and fill in real values locally. CI produces its own.

## Interpolate from process env in CI

Journey doesn't read `process.env` directly, but nothing stops you from writing the file at pipeline start. `jq` is one option:

```sh
# CI step
jq -n --arg user "$DEV_USER" --arg pass "$DEV_PASS" \
  '{USERNAME: $user, PASSWORD: $pass}' \
  > environments/dev.json

journey run --all --env dev
```

Any templating engine works — envsubst, a tiny Node script, `echo | tee`. The result just needs to be a valid JSON object.

## Redaction in logs

The built-in console logger masks standard secret headers before writing them to stderr. Default masked headers:

- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- `x-auth-token`
- `proxy-authorization`

Case-insensitive. The value becomes `***`:

```
→ POST http://127.0.0.1:5180/auth/login
  headers {"content-type":"application/json","authorization":"***"}
```

Enable via `--debug` or `DEBUG=journey`.

### Masking is header-only

Values you put into the **request body** are not masked. If you `console.log(res.body)` from an `after` hook, whatever's in `res.body` is what you see. Treat `console.log` in journeys as you would in application code — fine for local debugging, not for CI logs.

### Custom mask list

Programmatic users can pass their own list of headers to mask:

```ts
import { createConsoleLogger, maskHeaders } from "@usejourney/core";

const logger = createConsoleLogger({
  mask: true, // use the default list
  maxBodyChars: 500,
});

// or call maskHeaders directly
maskHeaders(headers, ["x-tenant-id", "x-customer-secret"]);
```

The `maxBodyChars` option truncates logged bodies past N characters — useful when responses are big and you only want a preview.

## Rotation

Journey caches nothing about env values in `.journey/cache/`. Run records store request URLs and response bodies — which may include tokens if the server returned one in the response. If you rotate credentials, consider whether old run records on disk still contain them; the history directory is gitignored by default, but it lives on your disk.

`config.runHistoryKeepCount` bounds how many run records are retained (default 20). Lower it if that's a concern.
