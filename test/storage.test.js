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
  assert.equal(restored.schemaVersion, 2);
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
  assert.deepEqual(backupSummary(sample()), { ingredients: 1, stockAdjustments: 0, purchases: 0, products: 1, productions: 0, clients: 0, orders: 0, sales: 0 });
});

test("los datos anteriores sin historial de ajustes siguen siendo válidos", () => {
  const old = sample();
  delete old.stockAdjustments;
  const restored = parseBackup(JSON.stringify({ application: "Dulce Gestión", schemaVersion: 1, data: old }));
  assert.deepEqual(restored.data.stockAdjustments, []);
});

test("el respaldo conserva el historial de ajustes", () => {
  const data = sample();
  data.stockAdjustments.push({ id: "adj-1", ingredientId: "ing-1", delta: -50, reason: "family" });
  const restored = parseBackup(JSON.stringify(createBackup(data)));
  assert.equal(restored.data.stockAdjustments[0].reason, "family");
});
