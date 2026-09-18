import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { X509Certificate } from "crypto";
import { getAdminTlsOptions } from "../lib/admin-tls.js";

test("genereert self-signed certificaat bij eerste keer en hergebruikt daarna", async () => {
  const certsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs-"));
  const first = await getAdminTlsOptions({}, { certsDir });
  assert.equal(first.source, "generated");
  assert.ok(fs.existsSync(path.join(certsDir, "admin-cert.pem")));
  assert.ok(fs.existsSync(path.join(certsDir, "admin-key.pem")));
  const x = new X509Certificate(first.cert);
  assert.match(x.subject, /CN=/);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.match(x.subjectAltName, /IP Address:127\.0\.0\.1/);
  const yearsValid = (new Date(x.validTo) - new Date(x.validFrom)) / (365 * 24 * 3600 * 1000);
  assert.ok(yearsValid > 9.9 && yearsValid < 10.1);

  const second = await getAdminTlsOptions({}, { certsDir });
  assert.equal(second.source, "file");
  assert.equal(second.cert.toString(), first.cert.toString());
});

test("gebruikt geconfigureerd certificaat als certFile/keyFile zijn gezet", async () => {
  const certsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs-"));
  const gen = await getAdminTlsOptions({}, { certsDir });
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-certs2-"));
  fs.writeFileSync(path.join(otherDir, "mijn.crt"), gen.cert);
  fs.writeFileSync(path.join(otherDir, "mijn.key"), gen.key);
  const cfg = await getAdminTlsOptions({ tls: { certFile: path.join(otherDir, "mijn.crt"), keyFile: path.join(otherDir, "mijn.key") } }, { certsDir: otherDir });
  assert.equal(cfg.source, "config");
});

test("faalt duidelijk als geconfigureerd certificaat ontbreekt", async () => {
  await assert.rejects(
    () => getAdminTlsOptions({ tls: { certFile: "C:/bestaat/niet.crt", keyFile: "C:/bestaat/niet.key" } }),
    /niet gevonden/
  );
});
