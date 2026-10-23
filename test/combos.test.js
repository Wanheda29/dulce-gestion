import test from "node:test";
import assert from "node:assert/strict";
import { deleteProductRecord, monthlySummary, productDefinition, productionCostBreakdown, productionPlan, productionWithHomeSupply, recipeCost, reverseProductionStock, saleFromOrder } from "../domain.js";
import { createBackup, emptyState, parseBackup } from "../storage.js";

const ingredients = () => [{ id: "h", name: "Harina", baseUnit: "g", averageCost: 0.1, stock: 2000 }, { id: "a", name: "Azúcar", baseUnit: "g", averageCost: 0.2, stock: 1000 }];
const products = () => [
  { id: "b", name: "Brownie", yieldQuantity: 4, recipe: [{ ingredientId: "h", quantity: 400, unit: "g" }], optionalCosts: { gas: 8, labor: 12 }, salePrice: 30 },
  { id: "a", name: "Alfajor", yieldQuantity: 2, recipe: [{ ingredientId: "h", quantity: 0.1, unit: "kg" }, { ingredientId: "a", quantity: 50 }], optionalCosts: { packaging: 4 }, salePrice: 25 },
];
const combo = () => ({ id: "c", kind: "combo", name: "Merienda", yieldQuantity: 1, items: [{ productId: "b", quantity: 2 }, { productId: "a", quantity: 4 }], optionalCosts: { packaging: 10 }, salePrice: 130 });

test("suma costos por unidad según el rendimiento y agrega solo el empaque del combo", () => {
  assert.deepEqual(recipeCost(combo(), ingredients(), products()), { ingredientCost: 60, optionalCost: 28, batchCost: 88, unitCost: 88 });
  const resolved = productDefinition(combo(), products());
  assert.deepEqual(resolved.optionalCosts, { packaging: 18, gas: 4, labor: 6 });
  assert.equal(resolved.yieldQuantity, 1);
});

test("un cambio en el precio de insumos o en una receta actualiza el costo del pack", () => {
  const nextIngredients = ingredients();
  nextIngredients[0].averageCost = 0.2;
  assert.equal(recipeCost(combo(), nextIngredients, products()).unitCost, 128);
  const nextProducts = products();
  nextProducts[0].recipe[0].quantity = 800;
  assert.equal(recipeCost(combo(), ingredients(), nextProducts).unitCost, 108);
});

test("producción de dos combos agrupa insumos compartidos y permite revertir stock", () => {
  const plan = productionPlan(combo(), ingredients(), 2, products());
  assert.equal(plan.producedQuantity, 2);
  assert.equal(plan.requirements.find((item) => item.ingredientId === "h").required, 800);
  assert.equal(plan.requirements.find((item) => item.ingredientId === "a").required, 200);
  assert.equal(plan.totalCost, 176);
  assert.equal(plan.unitCost, 88);
  const consumed = ingredients().map((item) => ({ ...item, stock: item.stock - plan.requirements.find((line) => line.ingredientId === item.id).required }));
  assert.deepEqual(reverseProductionStock(consumed, plan.requirements), ingredients());
  const snapshot = { totalCostSnapshot: plan.totalCost, requirementsSnapshot: plan.requirements, optionalCostsSnapshot: Object.entries(productDefinition(combo(), products()).optionalCosts).map(([label, value]) => ({ label, totalCost: value * 2 })) };
  assert.equal(productionCostBreakdown(snapshot).optionalLines.reduce((total, line) => total + line.totalCost, 0), 56);
});

test("los aportes de casa de un combo cubren faltantes y pueden anularse", () => {
  const stock = ingredients().map((item) => ({ ...item, stock: 0 }));
  const prepared = productionWithHomeSupply(combo(), stock, 1, {}, products());
  assert.equal(prepared.plan.canProduce, true);
  assert.equal(prepared.plan.totalCost, 88);
  const consumed = prepared.ingredients.map((item) => ({ ...item, stock: 0 }));
  const restored = reverseProductionStock(consumed, prepared.plan.requirements, prepared.adjustments);
  assert.equal(restored[0].stock, 0);
  assert.equal(restored[1].stock, 0);
});

test("la venta de un combo desde pedido congela su costo y alimenta el informe", () => {
  const sale = saleFromOrder({ id: "o", quantity: 2, totalPrice: 260 }, combo(), ingredients(), "2026-10-23", "s", products());
  assert.equal(sale.unitCostSnapshot, 88);
  assert.equal(sale.unitPrice, 130);
  const changed = ingredients().map((item) => ({ ...item, averageCost: 10 }));
  recipeCost(combo(), changed, products());
  assert.equal(sale.unitCostSnapshot, 88);
  assert.deepEqual(monthlySummary([sale], "2026-10"), { orders: 1, units: 2, revenue: 260, cost: 176, profit: 84 });
});

test("rechaza combos vacíos, cantidades inválidas, productos borrados y combos anidados", () => {
  assert.throws(() => productDefinition({ ...combo(), items: [] }, products()), /al menos un producto/);
  for (const quantity of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => productDefinition({ ...combo(), items: [{ productId: "b", quantity }] }, products()), /entero mayor a cero/);
  }
  assert.throws(() => productDefinition(combo(), []), /no está disponible/);
  assert.throws(() => productDefinition(combo(), products().map((item) => ({ ...item, deletedAt: "hoy" }))), /no está disponible/);
  assert.throws(() => productDefinition({ ...combo(), items: [{ productId: "c", quantity: 1 }] }, [combo()]), /otro combo/);
  for (const packaging of [-1, NaN, Infinity]) assert.throws(() => productDefinition({ ...combo(), optionalCosts: { packaging } }, products()), /costo adicional/);
});

test("protege productos usados por combos y conserva historial al eliminar un combo", () => {
  assert.throws(() => deleteProductRecord(products()[0], [], "hoy", null, [combo()]), /forma parte de un combo/);
  assert.doesNotThrow(() => deleteProductRecord(products()[0], [], "hoy", null, [{ ...combo(), deletedAt: "ayer" }]));
  assert.throws(() => deleteProductRecord(combo(), [{ productId: "c", status: "pendiente" }], "hoy"), /pedidos pendientes/);
  const removed = deleteProductRecord(combo(), [], "hoy");
  assert.deepEqual(removed.items, combo().items);
  assert.equal(removed.deletedAt, "hoy");
});

test("los combos sobreviven a la sincronización y al respaldo versión 3", () => {
  const state = { ...structuredClone(emptyState), ingredients: ingredients(), products: [...products(), combo()] };
  const backup = createBackup(state);
  assert.equal(backup.schemaVersion, 3);
  const restored = parseBackup(JSON.stringify(backup)).data;
  assert.deepEqual(restored, state);
  assert.equal(recipeCost(restored.products[2], restored.ingredients, restored.products).unitCost, 88);
  assert.deepEqual(parseBackup(JSON.stringify({ application: "Dulce Gestión", schemaVersion: 2, data: { products: products() } })).data.products, products());
});
