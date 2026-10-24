import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildBusinessReport, createBusinessPdf } from "../pdf-export.js";
const require = createRequire(import.meta.url);
const { jsPDF } = require("../vendor/jspdf.umd.min.js");
const { autoTable } = require("../vendor/jspdf.plugin.autotable.min.js");
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/pdf-state.json", import.meta.url), "utf8"));
const section = (report, title) => report.sections.find((item) => item.title === title);
const allRows = (item) => JSON.stringify(item.rows);

test("el informe abarca todas las colecciones sin modificar el estado", () => {
  const state = fixture();
  const before = structuredClone(state);
  const report = buildBusinessReport(state, { businessName: "Dulcería de Lucía", pendingChanges: true });
  assert.deepEqual(state, before);
  assert.equal(report.pendingChanges, true);
  for (const title of ["Clientes", "Insumos y existencias actuales", "Historial de costos manuales", "Productos y precios actuales", "Receta: Torta de merengue", "Combos y precios actuales", "Contenido del combo: Merienda para dos", "Histórico de compras de insumos", "Correcciones y eliminaciones de compras", "Historial de ajustes de stock", "Pedidos: entregas e importes", "Pedidos: contacto y seguimiento", "Histórico de ventas", "Resumen mensual de ventas", "Histórico de producciones"]) assert.ok(section(report, title), title);
  assert.match(allRows(section(report, "Clientes")), /María Núñez/);
  assert.match(allRows(section(report, "Clientes")), /@ejemplo/);
  assert.match(allRows(section(report, "Histórico de compras de insumos")), /Eliminado/);
  assert.match(allRows(section(report, "Historial de ajustes de stock")), /Anulado/);
});

test("los totales evitan duplicar pedidos y ventas y excluyen compras eliminadas", () => {
  const report = buildBusinessReport(fixture());
  assert.deepEqual(report.summary, { revenue: 3080, salesCost: 505, grossProfit: 2575, stockValue: 198, orderBalance: 2280, purchaseTotal: 100 });
  assert.equal(section(report, "Resumen mensual de ventas").rows.length, 2);
  assert.match(section(report, "Resumen del negocio").note, /no es ganancia neta/);
  assert.match(section(report, "Pedidos: entregas e importes").note, /no registra cobros posteriores/);
});

test("costos actuales, kg y costos históricos se mantienen separados", () => {
  const state = fixture();
  state.ingredients[0].averageCost = 0.1;
  const report = buildBusinessReport(state);
  const ingredientRow = section(report, "Insumos y existencias actuales").rows[0];
  assert.equal(ingredientRow[1], "1,5");
  assert.equal(ingredientRow[2], "kg");
  assert.match(ingredientRow[3], /100,00/);
  const productRow = section(report, "Productos y precios actuales").rows[0];
  assert.match(productRow[3], /160,00/);
  assert.match(allRows(section(report, "Histórico de ventas")), /240,00/);
  assert.match(allRows(section(report, "Producción: Torta de merengue - 20\/10\/2026")), /120,00/);
  assert.match(allRows(section(report, "Correcciones y eliminaciones de compras")), /Sin registro \(eliminado\)/);
});

test("un combo o receta con referencias faltantes se informa como no disponible", () => {
  const state = fixture();
  state.ingredients = [];
  let report = buildBusinessReport(state);
  assert.match(allRows(section(report, "Productos y precios actuales")), /No disponible/);
  state.products[2].items[0].productId = "missing";
  report = buildBusinessReport(state);
  assert.match(allRows(section(report, "Combos y precios actuales")), /No disponible/);
});

test("estados vacíos y fechas de exportación se validan", () => {
  const report = buildBusinessReport({}, { exportedAt: "2026-10-24T02:30:00Z" });
  assert.equal(report.exportedAt, "2026-10-24T02:30:00.000Z");
  assert.equal(report.summary.revenue, 0);
  assert.equal(section(report, "Clientes").rows.length, 0);
  assert.throws(() => buildBusinessReport({}, { exportedAt: "no date" }), /fecha de exportación/);
});

test("genera un PDF real paginado con tablas extensas y notas largas", () => {
  const state = fixture();
  state.clients = Array.from({ length: 90 }, (_, index) => ({ id: "c" + index, name: "María Núñez " + index, phone: "099000001", instagram: "@prueba", notes: "Indicaciones de entrega. ".repeat(index === 0 ? 90 : 3) }));
  const doc = createBusinessPdf(buildBusinessReport(state, { businessName: "Demostración - Dulcería de Lucía", exportedAt: "2026-10-24T15:00:00Z" }), { jsPDF, autoTable });
  assert.ok(doc.getNumberOfPages() >= 6);
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 10000);
});
