import test from "node:test";
import assert from "node:assert/strict";
import { countedStock, correctPurchaseInventory, deleteProductRecord, ingredientQuantity, ingredientUnit, ingredientUnitCost, ingredientWithManualCost, productionPlan, productionWithHomeSupply, profitOnCostPercent, recipeCost, reverseProductionStock, toBaseQuantity, updateWeightedAverage } from "../domain.js";
import { createBackup, emptyState, parseBackup } from "../storage.js";

test("un insumo en kg acepta compras en gramos y calcula costo por kg", () => {
  const ingredient = ingredientWithManualCost({ id: "h", baseUnit: "kg", stock: 0 }, 52, "kg");
  assert.equal(ingredient.averageCost, 52);
  assert.equal(ingredientWithManualCost(ingredient, 0.052, "g").averageCost, 52);
  assert.equal(toBaseQuantity(500, "g", "kg"), 0.5);
  const purchased = updateWeightedAverage(ingredient.stock, ingredient.averageCost, toBaseQuantity(2000, "g", "kg"), 104);
  assert.deepEqual(purchased, { stock: 2, averageCost: 52 });
  const corrected = correctPurchaseInventory([{ ...ingredient, ...purchased }], { ingredientId: "h", baseQuantity: 2, totalCost: 104 }, { ingredientId: "h", baseQuantity: 1, totalCost: 60 });
  assert.equal(corrected[0].stock, 1);
  assert.equal(corrected[0].averageCost, 60);
});

test("mostrar Harina en kg conserva recetas existentes, stock y valoración", () => {
  const original = { id: "h", baseUnit: "g", stock: 1500, averageCost: 0.052 };
  const ingredient = { ...original, displayUnit: "kg" };
  assert.equal(ingredientUnit(ingredient), "kg");
  assert.equal(ingredientUnitCost(ingredient), 52);
  assert.equal(ingredientQuantity(ingredient, ingredient.stock), 1.5);
  assert.equal(ingredientUnitCost(ingredient) * ingredientQuantity(ingredient, ingredient.stock), original.stock * original.averageCost);
  const recipe = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 500 }] };
  assert.equal(recipeCost(recipe, [ingredient]).unitCost, 26);
  assert.equal(productionPlan(recipe, [ingredient]).requirements[0].required, 500);
  const counted = countedStock(ingredient, toBaseQuantity(2, ingredientUnit(ingredient), ingredient.baseUnit), 26);
  assert.equal(counted.stock, 2000);
  assert.equal(counted.averageCost, 0.052);
});

test("recetas con gramos y kg suman cantidades compatibles y revierten la producción", () => {
  const ingredient = { id: "h", name: "Harina", baseUnit: "kg", stock: 2, averageCost: 52 };
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 250, unit: "g" }, { ingredientId: "h", quantity: 0.25, unit: "kg" }] };
  assert.equal(recipeCost(product, [ingredient]).unitCost, 26);
  const plan = productionPlan(product, [ingredient], 2);
  assert.equal(plan.requirements[0].required, 1);
  assert.equal(plan.totalCost, 52);
  assert.equal(plan.canProduce, true);
  const consumed = [{ ...ingredient, stock: ingredient.stock - plan.requirements[0].required }];
  assert.equal(reverseProductionStock(consumed, plan.requirements)[0].stock, 2);
  assert.equal(recipeCost({ recipe: [{ ingredientId: "h", quantity: 500, unit: "g" }] }, [{ ...ingredient, baseUnit: "g", averageCost: 0.052 }]).unitCost, 26);
});

test("aportes de casa y anulación funcionan con insumos en kg", () => {
  const ingredient = { id: "h", name: "Harina", baseUnit: "kg", stock: 0.25, averageCost: 52 };
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 500, unit: "g" }] };
  const prepared = productionWithHomeSupply(product, [ingredient], 1, { h: 13 });
  assert.equal(prepared.plan.totalCost, 26);
  assert.equal(prepared.adjustments[0].delta, 0.25);
  const consumed = prepared.ingredients.map((item) => ({ ...item, stock: 0 }));
  const restored = reverseProductionStock(consumed, prepared.plan.requirements, prepared.adjustments);
  assert.equal(restored[0].stock, 0.25);
  assert.equal(restored[0].averageCost, 52);
});

test("rechaza unidades incompatibles en recetas", () => {
  assert.throws(() => recipeCost({ recipe: [{ ingredientId: "h", quantity: 1, unit: "ml" }] }, [{ id: "h", baseUnit: "kg", averageCost: 52 }]), /no es compatible/);
});

test("ganancia sobre costo: 100 a 120 es 20%, contempla pérdidas y costo cero", () => {
  assert.equal(profitOnCostPercent(120, 100), 20);
  assert.equal(profitOnCostPercent(80, 100), -20);
  assert.equal(profitOnCostPercent(0, 100), -100);
  assert.equal(profitOnCostPercent(100, 100), 0);
  assert.ok(Math.abs(profitOnCostPercent(790, 26) - 2938.46153846) < 1e-6);
  for (const cost of [0, -1, NaN, Infinity]) assert.equal(profitOnCostPercent(100, cost), null);
});

test("eliminar receta conserva el producto para ventas e informes históricos", () => {
  const product = { id: "p", name: "Torta", recipe: [{ ingredientId: "h", quantity: 500 }] };
  const orders = [{ productId: "p", status: "entregado" }, { productId: "p", status: "cancelado" }, { productId: "p", status: "pendiente", deletedAt: "ayer" }];
  const removed = deleteProductRecord(product, orders, "2026-10-21T12:00:00Z", "user-id");
  assert.equal(removed.deletedAt, "2026-10-21T12:00:00Z");
  assert.equal(removed.deletedBy, "user-id");
  assert.equal(removed.name, product.name);
  assert.deepEqual(removed.recipe, product.recipe);
  assert.equal(product.deletedAt, undefined);
  assert.throws(() => deleteProductRecord(removed, [], "hoy"), /ya fue eliminada/);
});

test("no elimina recetas con pedidos pendientes, confirmados, en producción o listos", () => {
  for (const status of ["pendiente", "confirmado", "produccion", "listo"]) {
    assert.throws(() => deleteProductRecord({ id: "p" }, [{ productId: "p", status }], "hoy"), /pedidos pendientes/);
  }
});

test("el respaldo conserva kg, unidad de visualización, unidades de receta y eliminación", () => {
  const data = { ...structuredClone(emptyState), ingredients: [{ id: "h", baseUnit: "g", displayUnit: "kg", stock: 1000, averageCost: 0.052 }, { id: "a", baseUnit: "kg", stock: 1, averageCost: 50 }], products: [deleteProductRecord({ id: "p", recipe: [{ ingredientId: "h", quantity: 0.5, unit: "kg" }] }, [], "hoy")], sales: [{ id: "s", productId: "p", quantity: 1, unitCostSnapshot: 26, unitPrice: 790 }] };
  const restored = parseBackup(JSON.stringify(createBackup(data))).data;
  assert.deepEqual(restored, data);
});
