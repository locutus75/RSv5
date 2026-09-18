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
