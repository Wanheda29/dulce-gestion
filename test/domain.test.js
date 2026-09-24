import test from "node:test";
import assert from "node:assert/strict";
import { correctPurchaseInventory, countedStock, marginPercent, monthlySummary, productionPlan, productionWithHomeSupply, recipeCost, reverseProductionStock, saleFromOrder, toBaseQuantity, updateWeightedAverage } from "../domain.js";

test("convierte kilogramos a gramos", () => assert.equal(toBaseQuantity(2.5, "kg", "g"), 2500));

test("calcula el costo promedio ponderado", () => {
  assert.deepEqual(updateWeightedAverage(2000, 0.1, 3000, 450), { stock: 5000, averageCost: 0.13 });
});

test("corrige o elimina una compra sin alterar el objeto original", () => {
  const ingredients = [{ id: "h", stock: 2000, averageCost: 0.1 }];
  const purchase = { ingredientId: "h", baseQuantity: 1000, totalCost: 100 };
  const edited = correctPurchaseInventory(ingredients, purchase, { ingredientId: "h", baseQuantity: 1500, totalCost: 180 });
  assert.equal(edited[0].stock, 2500);
  assert.equal(edited[0].averageCost, 0.112);
  const deleted = correctPurchaseInventory(ingredients, purchase);
  assert.equal(deleted[0].stock, 1000);
  assert.equal(deleted[0].averageCost, 0.1);
  assert.equal(ingredients[0].stock, 2000);
});

test("impide eliminar una compra cuyo stock ya se consumió", () => {
  assert.throws(() => correctPurchaseInventory([{ id: "h", stock: 200, averageCost: 0.1 }], { ingredientId: "h", baseQuantity: 1000, totalCost: 100 }), /ya se consumió/);
});

test("impide una corrección que dejaría negativo el valor del inventario", () => {
  assert.throws(() => correctPurchaseInventory([{ id: "h", stock: 1000, averageCost: 0.05 }], { ingredientId: "h", baseQuantity: 500, totalCost: 100 }), /valor actual del stock/);
});

test("permite corregir el insumo de una compra cuando ambos stocks quedan válidos", () => {
  const result = correctPurchaseInventory(
    [{ id: "h", stock: 1000, averageCost: 0.1 }, { id: "a", stock: 0, averageCost: 0 }],
    { ingredientId: "h", baseQuantity: 1000, totalCost: 100 },
    { ingredientId: "a", baseQuantity: 500, totalCost: 50 },
  );
  assert.deepEqual(result.map((item) => item.stock), [0, 500]);
  assert.equal(result[1].averageCost, 0.1);
});

test("calcula una receta con gastos opcionales", () => {
  const ingredients = [{ id: "harina", averageCost: 0.1 }];
  const product = { yieldQuantity: 2, recipe: [{ ingredientId: "harina", quantity: 500 }], optionalCosts: { labor: 100 } };
  assert.deepEqual(recipeCost(product, ingredients), { ingredientCost: 50, optionalCost: 100, batchCost: 150, unitCost: 75 });
});

test("los gastos opcionales pueden omitirse", () => assert.equal(recipeCost({ yieldQuantity: 1, recipe: [] }, []).unitCost, 0));

test("resume ventas usando el costo histórico", () => {
  const summary = monthlySummary([{ date: "2026-09-18", quantity: 2, unitPrice: 100, unitCostSnapshot: 60 }], "2026-09");
  assert.deepEqual(summary, { orders: 1, units: 2, revenue: 200, cost: 120, profit: 80 });
  assert.equal(marginPercent(100, 60), 40);
});

test("convierte un pedido entregado en una venta con costo congelado", () => {
  const ingredients = [{ id: "harina", averageCost: 0.1 }];
  const product = { id: "torta", yieldQuantity: 1, recipe: [{ ingredientId: "harina", quantity: 500 }] };
  const order = { id: "pedido-1", productId: "torta", quantity: 2, totalPrice: 1200 };
  assert.deepEqual(saleFromOrder(order, product, ingredients, "2026-09-18", "venta-1"), {
    id: "venta-1", productId: "torta", quantity: 2, unitPrice: 600, unitCostSnapshot: 50, date: "2026-09-18", sourceOrderId: "pedido-1",
  });
});

test("planifica una producción y detecta insumos insuficientes", () => {
  const product = { yieldQuantity: 12, recipe: [{ ingredientId: "harina", quantity: 500 }], optionalCosts: { labor: 100 } };
  const plan = productionPlan(product, [{ id: "harina", name: "Harina", baseUnit: "g", stock: 800, averageCost: 0.1 }], 2);
  assert.equal(plan.producedQuantity, 24);
  assert.equal(plan.totalCost, 300);
  assert.equal(plan.unitCost, 12.5);
  assert.equal(plan.canProduce, false);
  assert.equal(plan.requirements[0].required, 1000);
});

test("un recuento manual de stock conserva el costo al reducir y pondera al aumentar", () => {
  const ingredient = { id: "harina", stock: 1000, averageCost: 0.1 };
  assert.deepEqual(countedStock(ingredient, 700), { stock: 700, averageCost: 0.1, previousStock: 1000, delta: -300, addedValue: 0 });
  assert.deepEqual(countedStock(ingredient, 1500, 100), { stock: 1500, averageCost: 0.13333333333333333, previousStock: 1000, delta: 500, addedValue: 100 });
  assert.throws(() => countedStock(ingredient, -1), /no negativos/);
});

test("el aporte de casa cubre faltantes sin dejar stock negativo y ajusta el costo", () => {
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "harina", quantity: 500 }] };
  const ingredients = [{ id: "harina", name: "Harina", baseUnit: "g", stock: 200, averageCost: 0.1 }];
  const result = productionWithHomeSupply(product, ingredients, 1, { harina: 60 });
  assert.equal(result.adjustments[0].delta, 300);
  assert.equal(result.adjustments[0].addedValue, 60);
  assert.equal(result.plan.canProduce, true);
  assert.equal(result.plan.totalCost, 80);
  assert.equal(result.ingredients[0].stock, 500);
  assert.equal(ingredients[0].stock, 200);
  assert.throws(() => productionWithHomeSupply(product, ingredients, 1, { harina: -1 }), /no negativos/);
});

test("suma las líneas repetidas del mismo insumo antes de evaluar el stock", () => {
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 300 }, { ingredientId: "h", quantity: 300 }] };
  const ingredients = [{ id: "h", name: "Harina", baseUnit: "g", stock: 500, averageCost: 0.1 }];
  const plan = productionPlan(product, ingredients);
  assert.equal(plan.canProduce, false);
  assert.equal(plan.requirements[0].required, 600);
  assert.equal(productionWithHomeSupply(product, ingredients).adjustments[0].delta, 100);
});

test("anular una producción revierte el consumo y el aporte de casa", () => {
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 500 }] };
  const original = [{ id: "h", name: "Harina", baseUnit: "g", stock: 200, averageCost: 0.1 }];
  const prepared = productionWithHomeSupply(product, original, 1, { h: 60 });
  const consumed = prepared.ingredients.map((item) => ({ ...item, stock: item.stock - 500 }));
  const restored = reverseProductionStock(consumed, prepared.plan.requirements, prepared.adjustments);
  assert.equal(restored[0].stock, 200);
  assert.ok(Math.abs(restored[0].averageCost - 0.1) < 1e-10);
  assert.equal(consumed[0].stock, 0);
});

test("un aporte sin valor conocido permite producir pero se marca como costo parcial", () => {
  const product = { yieldQuantity: 1, recipe: [{ ingredientId: "h", quantity: 100 }] };
  const result = productionWithHomeSupply(product, [{ id: "h", name: "Harina", baseUnit: "g", stock: 0, averageCost: 0 }]);
  assert.equal(result.plan.canProduce, true);
  assert.equal(result.costUnestimated, true);
  assert.equal(result.adjustments[0].delta, 100);
});
