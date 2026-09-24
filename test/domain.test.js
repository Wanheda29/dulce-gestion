import test from "node:test";
import assert from "node:assert/strict";
import { marginPercent, monthlySummary, productionPlan, recipeCost, saleFromOrder, toBaseQuantity, updateWeightedAverage } from "../domain.js";

test("convierte kilogramos a gramos", () => assert.equal(toBaseQuantity(2.5, "kg", "g"), 2500));

test("calcula el costo promedio ponderado", () => {
  assert.deepEqual(updateWeightedAverage(2000, 0.1, 3000, 450), { stock: 5000, averageCost: 0.13 });
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
