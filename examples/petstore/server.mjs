#!/usr/bin/env node
// Tiny in-memory implementation of the Petstore example API. No deps; runs on
// node:http. Used by `pnpm dev:web` so journeys can hit a real backend offline.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5180);
const HOST = process.env.HOST ?? "127.0.0.1";

// --- in-memory state -------------------------------------------------------

let nextPetId = 1;
let nextNoteId = 1;
const pets = new Map(); // id -> Pet
const notesByPet = new Map(); // petId -> Note[]
const sessions = new Set(); // bearer tokens

const VALID_USER = process.env.MOCK_USER ?? "alice";
const VALID_PASSWORD = process.env.MOCK_PASSWORD ?? "wonderland";

function seed() {
  const initial = [
    { name: "Rex", status: "available", tags: ["dog", "puppy"] },
    { name: "Whiskers", status: "available", tags: ["cat"] },
    { name: "Buddy", status: "pending", tags: ["dog", "senior"] },
    { name: "Goldie", status: "sold", tags: ["fish"] },
  ];
  for (const p of initial) {
    const pet = { id: nextPetId++, ...p };
    pets.set(pet.id, pet);
  }
  notesByPet.set(1, [
    { id: nextNoteId++, petId: 1, text: "House-trained", createdAt: new Date().toISOString() },
  ]);
}
seed();

// --- helpers ---------------------------------------------------------------

function send(res, status, body, extraHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type, Authorization, X-Request-Id",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    ...extraHeaders,
  };
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return Symbol.for("__bad_json__");
  }
}

function requireAuth(req, res) {
  const auth = req.headers["authorization"] ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !sessions.has(match[1])) {
    send(res, 401, { code: 401, message: "missing or invalid bearer token" });
    return false;
  }
  return true;
}

function isPetInput(b) {
  return (
    b &&
    typeof b === "object" &&
    typeof b.name === "string" &&
    ["available", "pending", "sold"].includes(b.status)
  );
}

// --- routing ---------------------------------------------------------------

const routes = [
  {
    method: "POST",
    re: /^\/auth\/login$/,
    handler: async (req, res) => {
      const body = await readJson(req);
      if (body === Symbol.for("__bad_json__")) {
        return send(res, 400, { code: 400, message: "invalid JSON body" });
      }
      if (!body || body.username !== VALID_USER || body.password !== VALID_PASSWORD) {
        return send(res, 401, { code: 401, message: "bad credentials" });
      }
      const token = randomBytes(16).toString("hex");
      sessions.add(token);
      return send(res, 200, { token, expiresIn: 3600 });
    },
  },
  {
    method: "GET",
    re: /^\/pet\/findByStatus$/,
    handler: (req, res, _m, url) => {
      const status = url.searchParams.get("status");
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.max(0, parseInt(limitParam, 10)) : 50;
      let out = [...pets.values()];
      if (status) out = out.filter((p) => p.status === status);
      return send(res, 200, out.slice(0, limit));
    },
  },
  {
    method: "POST",
    re: /^\/pet$/,
    handler: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJson(req);
      if (!isPetInput(body)) {
        return send(res, 400, { code: 400, message: "name and status are required" });
      }
      const pet = {
        id: nextPetId++,
        name: body.name,
        status: body.status,
        tags: Array.isArray(body.tags) ? body.tags : [],
      };
      pets.set(pet.id, pet);
      return send(res, 201, pet, { location: `/pet/${pet.id}` });
    },
  },
  {
    method: "GET",
    re: /^\/pet\/(\d+)$/,
    handler: (req, res, m) => {
      const pet = pets.get(Number(m[1]));
      if (!pet) return send(res, 404, { code: 404, message: "not found" });
      return send(res, 200, pet);
    },
  },
  {
    method: "PUT",
    re: /^\/pet\/(\d+)$/,
    handler: async (req, res, m) => {
      if (!requireAuth(req, res)) return;
      const id = Number(m[1]);
      if (!pets.has(id)) return send(res, 404, { code: 404, message: "not found" });
      const body = await readJson(req);
      if (!isPetInput(body)) {
        return send(res, 400, { code: 400, message: "name and status are required" });
      }
      const pet = {
        id,
        name: body.name,
        status: body.status,
        tags: Array.isArray(body.tags) ? body.tags : [],
      };
      pets.set(id, pet);
      return send(res, 200, pet);
    },
  },
  {
    method: "PATCH",
    re: /^\/pet\/(\d+)$/,
    handler: async (req, res, m) => {
      if (!requireAuth(req, res)) return;
      const id = Number(m[1]);
      const existing = pets.get(id);
      if (!existing) return send(res, 404, { code: 404, message: "not found" });
      const body = await readJson(req);
      if (!body || typeof body !== "object") {
        return send(res, 400, { code: 400, message: "JSON object body required" });
      }
      const next = {
        ...existing,
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(["available", "pending", "sold"].includes(body.status) ? { status: body.status } : {}),
        ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
      };
      pets.set(id, next);
      return send(res, 200, next);
    },
  },
  {
    method: "DELETE",
    re: /^\/pet\/(\d+)$/,
    handler: (req, res, m) => {
      if (!requireAuth(req, res)) return;
      const id = Number(m[1]);
      if (!pets.delete(id)) return send(res, 404, { code: 404, message: "not found" });
      notesByPet.delete(id);
      return send(res, 204, null);
    },
  },
  {
    method: "GET",
    re: /^\/pet\/(\d+)\/notes$/,
    handler: (req, res, m) => {
      const id = Number(m[1]);
      if (!pets.has(id)) return send(res, 404, { code: 404, message: "not found" });
      return send(res, 200, notesByPet.get(id) ?? []);
    },
  },
  {
    method: "POST",
    re: /^\/pet\/(\d+)\/notes$/,
    handler: async (req, res, m) => {
      if (!requireAuth(req, res)) return;
      const id = Number(m[1]);
      if (!pets.has(id)) return send(res, 404, { code: 404, message: "not found" });
      const body = await readJson(req);
      if (!body || typeof body.text !== "string") {
        return send(res, 400, { code: 400, message: "text is required" });
      }
      const note = {
        id: nextNoteId++,
        petId: id,
        text: body.text,
        createdAt: new Date().toISOString(),
      };
      const list = notesByPet.get(id) ?? [];
      list.push(note);
      notesByPet.set(id, list);
      return send(res, 201, note);
    },
  },
];

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, null);
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  for (const route of routes) {
    if (route.method !== req.method) continue;
    const m = route.re.exec(url.pathname);
    if (m) {
      try {
        await route.handler(req, res, m, url);
      } catch (err) {
        send(res, 500, { code: 500, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }
  send(res, 404, { code: 404, message: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Petstore mock listening at http://${HOST}:${PORT}`);
  console.log(`  user: ${VALID_USER} / password: ${VALID_PASSWORD}`);
  console.log(`  seeded ${pets.size} pets`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
