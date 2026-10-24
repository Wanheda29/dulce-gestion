import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildIndividualReport, clientRegistrationDate, createBusinessPdf, reportPeriod } from "../pdf-export.js";
const require = createRequire(import.meta.url);
const { jsPDF } = require("../vendor/jspdf.umd.min.js");
const { autoTable } = require("../vendor/jspdf.plugin.autotable.min.js");
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/pdf-state.json", import.meta.url), "utf8"));

test("fechas inclusivas, meses y calendario real se validan antes de exportar", () => {
  const range = reportPeriod({ mode: "range", from: "2024-02-28", to: "2024-02-29" });
  assert.equal(range.includes("2024-02-28"), true);
  assert.equal(range.includes("2024-02-29"), true);
  assert.equal(range.includes("2024-03-01"), false);
  assert.equal(reportPeriod({ mode: "month", month: "2026-10" }).includes("2026-09-30"), false);
  for (const value of ["2026-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "0000-01-01", "bad"]) {
    assert.throws(() => reportPeriod({ mode: "range", from: value, to: "2026-12-31" }), /fechas/);
  }
  assert.throws(() => reportPeriod({ mode: "month", month: "2026-13" }), /mes válido/);
  assert.throws(() => reportPeriod({ mode: "range", from: "2026-10-24", to: "2026-10-23" }), /posterior/);
  assert.throws(() => buildIndividualReport({}, { type: "other", mode: "all" }), /tipo de reporte/);
});

test("ventas por mes y rango usan costos históricos y no incluyen pedidos ni compras", () => {
  const state = fixture();
  const before = structuredClone(state);
  const month = buildIndividualReport(state, { type: "sales", mode: "month", month: "2026-10" });
  assert.deepEqual(month.summary, { count: 1, units: 1, revenue: 1500, cost: 265, profit: 1235 });
  assert.equal(month.sections.length, 2);
  assert.match(month.sections[1].rows[0][2], /Merienda/);
  assert.equal(month.filename, "dulce-gestion-ventas-2026-10.pdf");
  const range = buildIndividualReport(state, { type: "sales", mode: "range", from: "2026-09-23", to: "2026-10-22" });
  assert.equal(range.summary.revenue, 3080);
  assert.equal(range.summary.cost, 505);
  assert.deepEqual(state, before);
  state.sales.push({ ...state.sales[0], id: "removed", deletedAt: "2026-10-24" }, { ...state.sales[0], id: "voided", voidedAt: "2026-10-24" });
  assert.equal(buildIndividualReport(state, { type: "sales", mode: "all" }).summary.count, 2);
});

test("compras no suman registros eliminados y conservan las unidades originales", () => {
  const report = buildIndividualReport(fixture(), { type: "purchases", mode: "range", from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(report.summary, { count: 1, total: 100 });
  assert.equal(report.sections[1].rows[0][3], "kg");
  assert.match(report.sections[1].rows[0][5], /50,00/);
  assert.equal(buildIndividualReport(fixture(), { type: "purchases", mode: "all" }).summary.total, 100);
});

test("registro de clientes respeta horario de Uruguay y no infiere fechas faltantes", () => {
  assert.equal(clientRegistrationDate({ createdAt: "2026-11-01T02:30:00Z" }), "2026-10-31");
  assert.equal(clientRegistrationDate({ createdAt: "2026-11-01T03:30:00Z" }), "2026-11-01");
  assert.equal(clientRegistrationDate({ createdAt: "2026-10-24" }), "2026-10-24");
  for (const createdAt of [undefined, "bad", "2026-02-30", "2026-02-30T12:00:00Z", "2026-11-01T02:30:00"]) assert.equal(clientRegistrationDate({ createdAt }), null);
  const state = fixture();
  state.clients[0].createdAt = "2026-11-01T02:30:00Z";
  const report = buildIndividualReport(state, { type: "clients", mode: "month", month: "2026-10" });
  assert.deepEqual(report.summary, { count: 1, unknownDates: 1 });
  assert.match(report.sections[0].note, /Se excluyen/);
  assert.equal(report.sections[1].rows[0][1], "31/10/2026");
  const all = buildIndividualReport(state, { type: "clients", mode: "all" });
  assert.equal(all.summary.count, 2);
  assert.match(JSON.stringify(all.sections[1].rows), /Sin fecha registrada/);
});

test("períodos vacíos y registros sin fecha se informan sin inventar movimientos", () => {
  for (const type of ["sales", "purchases", "clients"]) {
    const report = buildIndividualReport({}, { type, mode: "month", month: "2026-01" });
    assert.equal(report.summary.count, 0);
    assert.deepEqual(report.sections[1].rows, []);
  }
  const state = fixture();
  state.sales[0].date = "invalid";
  assert.equal(buildIndividualReport(state, { type: "sales", mode: "month", month: "2026-10" }).summary.count, 1);
  const all = buildIndividualReport(state, { type: "sales", mode: "all" });
  assert.equal(all.summary.count, 2);
  assert.match(JSON.stringify(all.sections), /Sin fecha válida/);
});

test("los tres reportes independientes generan PDFs reales incluso sin movimientos", () => {
  for (const type of ["sales", "purchases", "clients"]) {
    for (const state of [{}, fixture()]) {
      const report = buildIndividualReport(state, { type, mode: "all", pendingChanges: true });
      const doc = createBusinessPdf(report, { jsPDF, autoTable });
      const bytes = new Uint8Array(doc.output("arraybuffer"));
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
      assert.ok(doc.getNumberOfPages() >= 1);
      assert.equal(report.pendingChanges, true);
    }
  }
});
