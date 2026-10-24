import test from "node:test";
import assert from "node:assert/strict";
import { deleteIngredientRecord, recipeCost, productionPlan, productionWithHomeSupply, reverseProductionStock, correctPurchaseInventory } from "../domain.js";
import { createBackup, parseBackup, emptyState } from "../storage.js";
import { buildBusinessReport } from "../pdf-export.js";

const ingredient = { id: "h", name: "Harina", baseUnit: "g", stock: 1000, averageCost: 0.052, costHistory: [{ newCost: 0.052 }] };
const product = { id: "p", yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 500, unit: "g" }] };

test("elimina con stock y costos sin perder referencias, ni modificar el original", () => {
  const removed = deleteIngredientRecord(ingredient, "2026-10-24T15:00:00Z", "test@example.com");
  assert.equal(removed.stock, 1000);
  assert.equal(removed.averageCost, 0.052);
  assert.deepEqual(removed.costHistory, ingredient.costHistory);
  assert.equal(removed.deletedBy, "test@example.com");
  assert.equal(ingredient.deletedAt, undefined);
  assert.equal(recipeCost(product, [removed]).unitCost, 26);
  assert.throws(() => deleteIngredientRecord(removed, "today"), /ya fue eliminado/);
});

test("impide consumir el stock eliminado en recetas o combos, incluso con aportes", () => {
  const removed = deleteIngredientRecord(ingredient, "2026-10-24");
  const combo = { id: "combo", kind: "combo", items: [{ productId: "p", quantity: 2 }] };
  assert.throws(() => productionPlan(product, [removed]), /insumo eliminado/);
  assert.throws(() => productionPlan(combo, [removed], 1, [product, combo]), /insumo eliminado/);
  assert.throws(() => productionWithHomeSupply(product, [{ ...removed, stock: 0 }], 1, { h: 26 }), /insumo eliminado/);
});

test("compras y producciones anteriores pueden revertirse conservando la eliminación", () => {
  const removed = deleteIngredientRecord(ingredient, "2026-10-24");
  const restored = reverseProductionStock([removed], [{ ingredientId: "h", required: 500, cost: 26 }]);
  assert.equal(restored[0].stock, 1500);
  assert.equal(restored[0].deletedAt, removed.deletedAt);
  const corrected = correctPurchaseInventory([removed], { ingredientId: "h", baseQuantity: 500, totalCost: 26 });
  assert.equal(corrected[0].stock, 500);
  assert.equal(corrected[0].deletedAt, removed.deletedAt);
});

test("el respaldo conserva insumos eliminados y el informe excluye su valor activo", () => {
  const removed = deleteIngredientRecord(ingredient, "2026-10-24");
  const state = { ...structuredClone(emptyState), ingredients: [removed], products: [product] };
  assert.deepEqual(parseBackup(JSON.stringify(createBackup(state))).data, state);
  const report = buildBusinessReport(state);
  assert.equal(report.summary.stockValue, 0);
  const row = report.sections.find((item) => item.title === "Insumos y existencias actuales").rows[0];
  assert.match(row[4], /Excluido/);
  assert.match(row[5], /Eliminado/);
});
