import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { hashToken, verifyToken, loadAdminAuth, isAuthRequired } from "../lib/admin-auth.js";

test("hashToken levert scrypt-record met salt en hash", () => {
  const rec = hashToken("mijn-geheime-token-1234");
  assert.equal(rec.algorithm, "scrypt");
  assert.match(rec.salt, /^[0-9a-f]{64}$/);
  assert.match(rec.hash, /^[0-9a-f]{128}$/);
  assert.ok(!Number.isNaN(Date.parse(rec.createdAt)));
});

test("verifyToken accepteert de juiste token en weigert andere", () => {
  const rec = hashToken("mijn-geheime-token-1234");
  assert.equal(verifyToken("mijn-geheime-token-1234", rec), true);
  assert.equal(verifyToken("mijn-geheime-token-1235", rec), false);
  assert.equal(verifyToken("", rec), false);
  assert.equal(verifyToken(undefined, rec), false);
});

test("verifyToken weigert alles als er geen record is", () => {
  assert.equal(verifyToken("wat-dan-ook", null), false);
});

test("loadAdminAuth leest bestand en isAuthRequired volgt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-auth-"));
  const file = path.join(dir, "admin-auth.json");
  assert.equal(loadAdminAuth(file), null);
  assert.equal(isAuthRequired(), false);
  fs.writeFileSync(file, JSON.stringify(hashToken("abc-def-ghi-jkl-1234")));
  const rec = loadAdminAuth(file);
  assert.equal(rec.algorithm, "scrypt");
  assert.equal(isAuthRequired(), true);
  assert.equal(verifyToken("abc-def-ghi-jkl-1234"), true);
  fs.writeFileSync(file, "{ dit is geen json");
  assert.equal(loadAdminAuth(file), null);
  assert.equal(isAuthRequired(), false);
});

import {
  configureSessions, createSession, getSession, destroySession,
  checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit,
  adminAuthMiddleware, hasValidSession, parseSessionCookie, SESSION_COOKIE
} from "../lib/admin-auth.js";

function fakeClock(startMs) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("sessie: aanmaken, ophalen, verlengen, vernietigen", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 12, maxDays: 7, now: clock.now });
  const id = createSession();
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(getSession(id));
  assert.equal(getSession("bestaat-niet"), null);
  destroySession(id);
  assert.equal(getSession(id), null);
});

test("sessie verloopt na idle-timeout, maar niet zolang hij gebruikt wordt", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 1, maxDays: 7, now: clock.now });
  const id = createSession();
  clock.advance(50 * 60 * 1000);
  assert.ok(getSession(id), "na 50 min nog geldig");
  clock.advance(50 * 60 * 1000);
  assert.ok(getSession(id), "verlengd door vorig gebruik");
  clock.advance(61 * 60 * 1000);
  assert.equal(getSession(id), null, "61 min ongebruikt → verlopen");
});

test("sessie verloopt absoluut na maxDays ondanks gebruik", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ idleHours: 24, maxDays: 1, now: clock.now });
  const id = createSession();
  for (let i = 0; i < 23; i++) { clock.advance(60 * 60 * 1000); assert.ok(getSession(id)); }
  clock.advance(2 * 60 * 60 * 1000);
  assert.equal(getSession(id), null);
});

test("rate-limit: 5 fouten blokkeren, blokkade verloopt, succes reset", () => {
  const clock = fakeClock(1_000_000);
  configureSessions({ now: clock.now });
  const ip = "10.0.0.5";
  resetLoginRateLimit(ip);
  for (let i = 0; i < 5; i++) {
    assert.equal(checkLoginRateLimit(ip).allowed, true);
    recordFailedLogin(ip);
  }
  const blocked = checkLoginRateLimit(ip);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 15 * 60);
  clock.advance(15 * 60 * 1000 + 1000);
  assert.equal(checkLoginRateLimit(ip).allowed, true);
  recordFailedLogin(ip);
  resetLoginRateLimit(ip);
  assert.equal(checkLoginRateLimit(ip).allowed, true);
  assert.equal(checkLoginRateLimit("10.0.0.6").allowed, true, "ander IP niet geraakt");
});

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

test("middleware: zonder auth-bestand alles doorlaten", () => {
  loadAdminAuth(path.join(os.tmpdir(), "rs-auth-niet-bestaand.json"));
  const res = fakeRes(); let called = false;
  adminAuthMiddleware({ headers: {}, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, true);
});

test("middleware: met auth-bestand alleen geldige cookie doorlaten, bearer genegeerd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-auth-"));
  const file = path.join(dir, "admin-auth.json");
  fs.writeFileSync(file, JSON.stringify(hashToken("abc-def-ghi-jkl-1234")));
  loadAdminAuth(file);
  configureSessions({ now: () => Date.now() });

  let called = false; let res = fakeRes();
  adminAuthMiddleware({ headers: {}, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, false); assert.equal(res.statusCode, 401);

  called = false; res = fakeRes();
  adminAuthMiddleware({ headers: { authorization: "Bearer abc-def-ghi-jkl-1234" }, query: { token: "abc-def-ghi-jkl-1234" }, method: "GET", path: "/tenants" }, res, () => { called = true; });
  assert.equal(called, false, "bearer/query token mag niet meer werken");

  const id = createSession();
  called = false; res = fakeRes();
  const req = { headers: { cookie: `foo=bar; ${SESSION_COOKIE}=${id}` }, method: "GET", path: "/tenants" };
  assert.equal(parseSessionCookie(req), id);
  assert.equal(hasValidSession(req), true);
  adminAuthMiddleware(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.adminSessionId, id);
});
