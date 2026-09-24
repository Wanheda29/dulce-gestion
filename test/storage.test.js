import test from "node:test";
import assert from "node:assert/strict";
import { backupSummary, createBackup, emptyState, parseBackup } from "../storage.js";

const sample = () => ({
  ...structuredClone(emptyState),
  ingredients: [{ id: "ing-1", name: "Harina" }],
  products: [{ id: "prd-1", name: "Torta" }],
});

test("crea y restaura un respaldo versionado", () => {
  const backup = createBackup(sample(), "2026-09-18T12:00:00.000Z");
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.legacy, false);
  assert.equal(restored.data.ingredients[0].name, "Harina");
});

test("acepta un respaldo anterior sin envoltorio", () => {
  const restored = parseBackup(JSON.stringify(sample()));
  assert.equal(restored.legacy, true);
  assert.equal(restored.data.products.length, 1);
});

test("rechaza colecciones dañadas e identificadores repetidos", () => {
  assert.throws(() => parseBackup(JSON.stringify({ ingredients: "no-es-lista" })), /colección/);
  assert.throws(() => parseBackup(JSON.stringify({ ingredients: [{ id: "1" }, { id: "1" }] })), /repetidos/);
});

test("resume el contenido del respaldo", () => {
  assert.deepEqual(backupSummary(sample()), { ingredients: 1, purchases: 0, products: 1, productions: 0, clients: 0, orders: 0, sales: 0 });
});
