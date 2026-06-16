---
title: Journey
description: Local-first tool for scaffolding and running API tests from an OpenAPI spec.
layout: home
sources:
  - README.md
hero:
  name: Journey
  text: API testing, on disk, in your repo.
  tagline: Scaffold from OpenAPI. Write journeys in TypeScript. Run them from the CLI, the GUI, or as k6 scripts — one source of truth.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Writing journeys
      link: /guide/writing-journeys/
    - theme: alt
      text: CLI reference
      link: /guide/cli/
features:
  - title: Local-first
    details: Projects live on disk in your VCS. No cloud, no login, no subscription. Everything is diffable JSON / YAML / TS.
  - title: One source of truth
    details: A single `.journey.ts` file runs from the CLI, the GUI, and transpiles into k6. Replace the Postman + acceptance-suite + load-script triplication.
  - title: Typed end-to-end
    details: An OpenAPI spec generates typed endpoint refs and models. The typed response flows into `assert` / `after` callbacks with full IDE autocomplete.
  - title: Plain TypeScript
    details: State between steps is just closure variables. No templating DSL, no custom expression language — you have the whole language.
---

## Quick glance

```ts
import { journey, step, env, expect } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";

journey("multi-step crud", () => {
  let token = "";
  let petId = 0;

  step("login", {
    endpoint: endpoints.login,
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("create pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Mittens", status: "available" },
    assert(res) {
      expect(res.status).toBe(201);
    },
    after(res) {
      petId = (res.body as { id: number }).id;
    },
  });

  step("delete pet", {
    endpoint: endpoints.deletePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(204);
    },
  });
});
```

```sh
journey run journeys/multi-step-crud.journey.ts --env dev
```
