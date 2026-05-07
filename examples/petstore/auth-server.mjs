#!/usr/bin/env node
// Tiny in-memory IDP for the Petstore example. Issues HMAC-signed bearer
// tokens that the petstore mock can verify without a callback. Demonstrates a
// journey hitting two different APIs (different base URLs) in one flow.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.AUTH_PORT ?? 5182);
const HOST = process.env.HOST ?? "127.0.0.1";
const SECRET = process.env.AUTH_SECRET ?? "journey-shared-dev-secret";
const TOKEN_TTL_SECONDS = 3600;

// MOCK_USERS=user1:pass1,user2:pass2  (default covers all three example envs)
const RAW_USERS =
  process.env.MOCK_USERS ?? "alice:wonderland,ci-bot:ci-secret,staging-user:staging-pass";
const users = new Map();
for (const pair of RAW_USERS.split(",")) {
  const [u, p] = pair.split(":");
  if (u && p) users.set(u, p);
}

// --- token format ----------------------------------------------------------
// idp.<base64url(JSON payload)>.<hex hmac-sha256 of "idp.<payload>">
//
// Symmetric HMAC keeps the example zero-dep while still demonstrating a real
// trust boundary between IDP and resource server (both must agree on SECRET).

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const head = `idp.${body}`;
  const sig = createHmac("sha256", SECRET).update(head).digest("hex");
  return `${head}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "idp") return null;
  const head = `idp.${parts[1]}`;
  const expected = createHmac("sha256", SECRET).update(head).digest("hex");
  const got = parts[2];
  if (got.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== "number" || Date.now() / 1000 > payload.exp) return null;
  if (typeof payload.sub !== "string") return null;
  return payload;
}

// --- helpers ---------------------------------------------------------------

function send(res, status, body) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
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

function requireBearer(req) {
  const auth = req.headers["authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  return verifyToken(m[1]);
}

// --- routing ---------------------------------------------------------------

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, null);
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "POST" && url.pathname === "/auth/login") {
    const body = await readJson(req);
    if (body === Symbol.for("__bad_json__")) {
      return send(res, 400, { code: 400, message: "invalid JSON body" });
    }
    if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
      return send(res, 400, { code: 400, message: "username and password are required" });
    }
    if (users.get(body.username) !== body.password) {
      return send(res, 401, { code: 401, message: "bad credentials" });
    }
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const token = signToken({ sub: body.username, exp });
    return send(res, 200, { token, expiresIn: TOKEN_TTL_SECONDS });
  }

  if (req.method === "GET" && url.pathname === "/auth/whoami") {
    const payload = requireBearer(req);
    if (!payload) {
      return send(res, 401, { code: 401, message: "missing or invalid bearer token" });
    }
    return send(res, 200, { username: payload.sub });
  }

  send(res, 404, { code: 404, message: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`IDP mock listening at http://${HOST}:${PORT}`);
  console.log(`  users: ${[...users.keys()].join(", ")}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
