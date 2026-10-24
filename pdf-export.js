import { ingredientQuantity, ingredientUnit, ingredientUnitCost, productDefinition, profitOnCostPercent, recipeCost, recipeLineQuantity, saleCustomerName } from "./domain.js";
import { normalizeState } from "./storage.js";

const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value) => String(value ?? "").trim() || "-";
const number = (value) => new Intl.NumberFormat("es-UY", { maximumFractionDigits: 6 }).format(numeric(value));
const money = (value, precise = false) => new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", minimumFractionDigits: 2, maximumFractionDigits: precise ? 6 : 2 }).format(numeric(value)).replace(/\u00a0/g, " ");
const date = (value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10).split("-").reverse().join("/") : text(value);
const percent = (price, cost) => {
  const value = profitOnCostPercent(price, cost);
  return value === null ? "Sin costo definido" : `${number(Math.round(value * 100) / 100)}%`;
};
const optionalLabels = { packaging: "Envases", labor: "Mano de obra", gas: "Gas", electricity: "Electricidad", delivery: "Reparto", other: "Otros" };
const reasons = { family: "Uso familiar", home: "Insumos de casa", correction: "Corrección de inventario", production: "Aporte para producción" };
const statuses = { pendiente: "Pendiente", confirmado: "Confirmado", produccion: "En producción", listo: "Listo", entregado: "Entregado", cancelado: "Cancelado" };
const recordStatus = (item) => [item.voidedAt ? `Anulado ${date(item.voidedAt)}` : "", item.deletedAt ? `Eliminado ${date(item.deletedAt)}` : ""].filter(Boolean).join("\n") || "Activo";
const newestFirst = (items) => [...items].sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));

/** Build human-readable tables from a snapshot. No state is modified or uploaded. */
export function buildBusinessReport(candidate, options = {}) {
  const state = normalizeState(candidate);
  const byId = (items, id) => items.find((item) => item.id === id);
  const ingredient = (id) => byId(state.ingredients, id);
  const product = (id) => byId(state.products, id);
  const clientName = (item) => text(item.customerName || byId(state.clients, item.clientId)?.name);
  const productName = (item) => text(item.productNameSnapshot || product(item.productId)?.name || "Producto no disponible");
  const ingredientName = (item) => text(item.ingredientName || ingredient(item.ingredientId)?.name || "Insumo no disponible");
  const section = (title, columns, rows, note = "") => ({ title, columns, rows, note });
  const costOf = (item) => {
    try {
      const definition = productDefinition(item, state.products);
      if ((definition.recipe || []).some((line) => !ingredient(line.ingredientId))) return null;
      return recipeCost(item, state.ingredients, state.products);
    }
    catch { return null; }
  };
  const currentProducts = state.products.filter((item) => item.kind !== "combo");
  const combos = state.products.filter((item) => item.kind === "combo");
  const sales = state.sales.filter((item) => !item.deletedAt && !item.voidedAt);
  const purchases = state.purchases.filter((item) => !item.deletedAt && !item.voidedAt);
  const validOrders = state.orders.filter((item) => !item.deletedAt && item.status !== "cancelado");
  const revenue = sales.reduce((sum, item) => sum + numeric(item.quantity) * numeric(item.unitPrice), 0);
  const salesCost = sales.reduce((sum, item) => sum + numeric(item.quantity) * numeric(item.unitCostSnapshot), 0);
  const stockValue = state.ingredients.reduce((sum, item) => sum + numeric(item.stock) * numeric(item.averageCost), 0);
  const orderBalance = validOrders.reduce((sum, item) => sum + Math.max(0, numeric(item.totalPrice) - numeric(item.deposit)), 0);
  const summary = { revenue, salesCost, grossProfit: revenue - salesCost, stockValue, orderBalance, purchaseTotal: purchases.reduce((sum, item) => sum + numeric(item.totalCost), 0) };
  const sections = [];
  sections.push(section("Resumen del negocio", ["Concepto", "Valor"], [
    ["Clientes registrados", number(state.clients.length)],
    ["Insumos registrados", number(state.ingredients.length)],
    ["Productos / recetas activos", number(currentProducts.filter((item) => !item.deletedAt).length)],
    ["Combos activos", number(combos.filter((item) => !item.deletedAt).length)],
    ["Valor actual de las existencias", money(stockValue)],
    ["Compras vigentes acumuladas", money(summary.purchaseTotal)],
    ["Ventas registradas acumuladas", money(revenue)],
    ["Costo histórico de las ventas", money(salesCost)],
    ["Ganancia bruta de las ventas", money(summary.grossProfit)],
    ["Señas de pedidos no cancelados", money(validOrders.reduce((sum, item) => sum + numeric(item.deposit), 0))],
    ["Saldo calculado de pedidos (total menos seña)", money(orderBalance)],
  ], "Importes en pesos uruguayos (UYU). Las compras eliminadas no se suman. Los pedidos y sus señas no se suman a las ventas para evitar duplicar ingresos. La ganancia bruta no es ganancia neta: solo descuenta los costos registrados en cada venta. Todos los períodos están incluidos."));

  sections.push(section("Clientes", ["Cliente", "Teléfono", "Instagram", "Notas"], state.clients.map((item) => [text(item.name), text(item.phone), text(item.instagram), text(item.notes)])));
  sections.push(section("Insumos y existencias actuales", ["Insumo", "Existencia", "Unidad", "Costo por unidad", "Valor en stock"], state.ingredients.map((item) => [text(item.name), number(ingredientQuantity(item, item.stock)), ingredientUnit(item), money(ingredientUnitCost(item), true), money(numeric(item.stock) * numeric(item.averageCost))])));

  const costHistory = state.ingredients.flatMap((item) => (item.costHistory || []).map((change) => [date(change.createdAt), text(item.name), `${money(change.previousCost, true)} / ${item.baseUnit}`, `${money(change.newCost, true)} / ${item.baseUnit}`, `${money(change.amount, true)} / ${text(change.costUnit)}`, text(change.actorEmail)]));
  sections.push(section("Historial de costos manuales", ["Fecha", "Insumo", "Costo anterior", "Costo nuevo", "Importe ingresado", "Registrado por"], costHistory, "Los costos anterior y nuevo se expresan en la unidad interna del insumo, indicada en cada celda. Cambiar la unidad de visualización no reescribe este historial."));

  sections.push(section("Productos y precios actuales", ["Producto", "Categoría", "Rendimiento", "Costo unitario actual", "Precio de venta", "Ganancia sobre costo", "Estado"], currentProducts.map((item) => {
    const cost = costOf(item);
    return [text(item.name), text(item.category), number(item.yieldQuantity), cost ? money(cost.unitCost) : "No disponible", money(item.salePrice), cost ? percent(item.salePrice, cost.unitCost) : "No disponible", recordStatus(item)];
  }), "Los costos de esta sección se calculan con las recetas y los precios de insumos actuales. No reemplazan los costos históricos de ventas o producciones."));
  for (const item of currentProducts) {
    const rows = (item.recipe || []).map((line) => {
      const source = ingredient(line.ingredientId);
      let lineCost = "No disponible";
      if (source) {
        try { lineCost = money(recipeLineQuantity(line, source) * numeric(source.averageCost)); }
        catch { /* Preserve the line and mark the unavailable calculation. */ }
      }
      return [text(source?.name || "Insumo no disponible"), number(line.quantity), text(line.unit || source?.baseUnit), source ? `${money(source.averageCost, true)} / ${source.baseUnit}` : "No disponible", lineCost];
    });
    for (const [key, value] of Object.entries(item.optionalCosts || {})) rows.push([optionalLabels[key] || key, "-", "Por receta", "-", money(value)]);
    const cost = costOf(item);
    if (cost) rows.push(["TOTAL POR RECETA", "", "", "", money(cost.batchCost)], ["COSTO POR UNIDAD", "", "", "", money(cost.unitCost)]);
    sections.push(section(`Receta: ${text(item.name)}`, ["Insumo / gasto", "Cantidad", "Unidad", "Costo actual de referencia", "Costo de la línea"], rows, `Rendimiento: ${number(item.yieldQuantity)} unidad(es). ${recordStatus(item)}. Costos calculados al exportar.`));
  }

  sections.push(section("Combos y precios actuales", ["Combo", "Descripción", "Costo por combo", "Precio de venta", "Ganancia sobre costo", "Estado"], combos.map((item) => {
    const cost = costOf(item);
    return [text(item.name), text(item.description), cost ? money(cost.unitCost) : "No disponible", money(item.salePrice), cost ? percent(item.salePrice, cost.unitCost) : "No disponible", recordStatus(item)];
  })));
  for (const item of combos) {
    const rows = (item.items || []).map((line) => {
      const source = product(line.productId);
      const cost = source ? costOf(source) : null;
      return [text(source?.name || "Producto no disponible"), number(line.quantity), cost ? money(cost.unitCost) : "No disponible", cost ? money(cost.unitCost * numeric(line.quantity)) : "No disponible"];
    });
    for (const [key, value] of Object.entries(item.optionalCosts || {})) rows.push([`${optionalLabels[key] || key} adicional del combo`, "1", money(value), money(value)]);
    const cost = costOf(item);
    if (cost) rows.push(["TOTAL POR COMBO", "", "", money(cost.unitCost)]);
    sections.push(section(`Contenido del combo: ${text(item.name)}`, ["Producto / adicional", "Unidades", "Costo unitario actual", "Subtotal"], rows, "El costo de cada producto ya incluye sus gastos opcionales. Solo se agrega el empaque adicional del pack."));
  }

  sections.push(section("Histórico de compras de insumos", ["Fecha", "Insumo", "Cantidad comprada", "Costo total", "Costo por unidad de compra", "Estado"], newestFirst(state.purchases).map((item) => [date(item.date), ingredientName(item), `${number(item.quantity)} ${text(item.purchaseUnit)}`, money(item.totalCost), numeric(item.quantity) > 0 ? `${money(numeric(item.totalCost) / numeric(item.quantity), true)} / ${text(item.purchaseUnit)}` : "No disponible", recordStatus(item)]), "Se incluyen compras eliminadas con su estado para conservar la trazabilidad. El importe de cada compra es el registrado, no el costo actual del insumo."));
  const purchaseDescription = (item) => item ? `${ingredientName(item)}; ${number(item.quantity)} ${text(item.purchaseUnit)}; total ${money(item.totalCost)}; fecha ${date(item.date)}` : "Sin registro (eliminado)";
  sections.push(section("Correcciones y eliminaciones de compras", ["Fecha del cambio", "Acción", "Antes", "Después", "Registrado por"], state.purchases.flatMap((item) => (item.history || []).map((change) => [date(change.at), change.type === "delete" ? "Eliminación" : "Edición", purchaseDescription(change.before), purchaseDescription(change.after), text(change.actorEmail)]))));

  sections.push(section("Historial de ajustes de stock", ["Fecha", "Insumo / unidad", "Existencia anterior", "Existencia nueva", "Cambio", "Valor aportado", "Motivo / nota", "Registrado por / estado"], newestFirst(state.stockAdjustments).map((item) => [date(item.date || item.createdAt), `${ingredientName(item)} (${text(item.unit)})`, number(item.previousStock), number(item.newStock), number(item.delta), item.costUnestimated ? "Sin estimar" : money(item.addedValue), `${reasons[item.reason] || text(item.reason)}\n${text(item.note)}`, `${text(item.actorEmail)}\n${recordStatus(item)}`])));

  const orderCodes = new Map(state.orders.map((item, index) => [item.id, `P${String(index + 1).padStart(4, "0")}`]));
  sections.push(section("Pedidos: entregas e importes", ["Ref. / creación", "Cliente", "Producto / combo", "Cantidad", "Entrega", "Total acordado", "Seña / saldo", "Estado"], state.orders.map((item) => [orderCodes.get(item.id) + `\n${date(item.createdAt)}`, clientName(item), productName(item), number(item.quantity), date(item.deliveryDate), money(item.totalPrice), `${money(item.deposit)} / ${money(Math.max(0, numeric(item.totalPrice) - numeric(item.deposit)))}`, `${statuses[item.status] || text(item.status)}${item.deletedAt ? `\nEliminado ${date(item.deletedAt)}` : ""}`]), "El saldo indicado es el total acordado menos la seña, con mínimo cero. Es un saldo calculado: la aplicación no registra cobros posteriores a la seña."));
  sections.push(section("Pedidos: contacto y seguimiento", ["Referencia", "Cliente", "Teléfono", "Notas", "Entregado el", "Venta vinculada", "Eliminado por"], state.orders.map((item) => [orderCodes.get(item.id), clientName(item), text(item.phone), text(item.notes), date(item.deliveredAt), item.saleId ? "Sí" : "No", text(item.deletedBy)])));

  sections.push(section("Histórico de ventas", ["Fecha / origen", "Cliente", "Producto / combo", "Unidades", "Precio unitario", "Ingresos", "Costo histórico total", "Ganancia bruta"], newestFirst(state.sales).map((item) => [date(item.date) + `\n${item.sourceOrderId ? orderCodes.get(item.sourceOrderId) || "Pedido vinculado" : "Venta directa"}${item.deletedAt || item.voidedAt ? `\n${recordStatus(item)}` : ""}`, text(saleCustomerName(item, state.orders) || byId(state.clients, item.clientId)?.name || "Sin cliente"), productName(item), number(item.quantity), money(item.unitPrice), money(numeric(item.quantity) * numeric(item.unitPrice)), money(numeric(item.quantity) * numeric(item.unitCostSnapshot)), money(numeric(item.quantity) * (numeric(item.unitPrice) - numeric(item.unitCostSnapshot)))]), "Los costos son las fotografías guardadas al registrar cada venta. No se recalculan con los precios actuales. La ganancia bruta no descuenta gastos que no hayan sido registrados en esos costos."));
  const months = new Map();
  for (const item of sales) {
    const month = String(item.date || "Sin fecha").slice(0, 7);
    const total = months.get(month) || { units: 0, revenue: 0, cost: 0 };
    total.units += numeric(item.quantity);
    total.revenue += numeric(item.quantity) * numeric(item.unitPrice);
    total.cost += numeric(item.quantity) * numeric(item.unitCostSnapshot);
    months.set(month, total);
  }
  sections.push(section("Resumen mensual de ventas", ["Mes", "Unidades vendidas", "Ingresos", "Costo histórico", "Ganancia bruta"], [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => [month, number(value.units), money(value.revenue), money(value.cost), money(value.revenue - value.cost)])));

  sections.push(section("Histórico de producciones", ["Fecha", "Producto / combo", "Tandas", "Unidades obtenidas", "Costo unitario histórico", "Costo total histórico", "Estado"], newestFirst(state.productions).map((item) => [date(item.date), productName(item), number(item.batches), number(item.producedQuantity), money(item.unitCostSnapshot), money(item.totalCostSnapshot), `${recordStatus(item)}${item.costUnestimated ? "\nCosto parcial: aporte sin estimar" : ""}`]), "Se incluyen producciones anuladas o eliminadas. Su detalle se conserva para auditoría y no representa existencias disponibles de productos terminados."));
  for (const item of newestFirst(state.productions)) {
    const rows = (item.requirementsSnapshot || []).map((line) => [text(line.name || ingredient(line.ingredientId)?.name || "Insumo no disponible"), number(line.required), text(line.unit), money(line.cost)]);
    if (Array.isArray(item.optionalCostsSnapshot)) {
      for (const line of item.optionalCostsSnapshot) rows.push([text(line.label), "-", "Gasto adicional", money(line.totalCost)]);
    } else {
      const known = (item.requirementsSnapshot || []).reduce((sum, line) => sum + numeric(line.cost), 0);
      rows.push(["Otros costos históricos sin desglose", "-", "", money(Math.max(0, numeric(item.totalCostSnapshot) - known))]);
    }
    rows.push(["TOTAL HISTÓRICO REGISTRADO", "", "", money(item.totalCostSnapshot)]);
    sections.push(section(`Producción: ${productName(item)} - ${date(item.date)}`, ["Insumo / gasto histórico", "Cantidad", "Unidad", "Costo histórico"], rows, `${recordStatus(item)}. ${item.costUnestimated ? "Costo parcial: hubo aportes sin estimar. " : ""}El detalle corresponde al momento de registrar esta producción.`));
  }
  const exportedAt = new Date(options.exportedAt || Date.now());
  if (!Number.isFinite(exportedAt.getTime())) throw new Error("La fecha de exportación no es válida.");
  return { businessName: text(options.businessName || "Dulce Gestión"), exportedAt: exportedAt.toISOString(), exportedBy: text(options.exportedBy), pendingChanges: Boolean(options.pendingChanges), summary, sections };
}

export function createBusinessPdf(report, { jsPDF, autoTable }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 14;
  const stamp = new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short", timeZone: "America/Montevideo" }).format(new Date(report.exportedAt));
  const pdfText = (value) => String(value).replace(/\u00a0/g, " ").replace(/[\u2010-\u2015]/g, "-").replace(/→/g, " a ");
  doc.setProperties({ title: `Informe del negocio - ${report.businessName}`, subject: "Datos comerciales, costos actuales e historial", author: "Dulce Gestión", creator: "Dulce Gestión" });
  doc.setFont("helvetica", "bold");
  doc.setTextColor(68, 35, 50);
  doc.setFontSize(22);
  const heading = doc.splitTextToSize(pdfText(report.businessName), width - margin * 2);
  doc.text(heading, margin, 20);
  let y = 20 + heading.length * 8;
  doc.setFontSize(13);
  doc.text("Informe completo del negocio", margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70);
  const intro = [
    `Exportado: ${stamp} (Uruguay). Moneda: pesos uruguayos (UYU).`,
    report.exportedBy !== "-" ? `Exportado por: ${report.exportedBy}` : "",
    report.pendingChanges ? "ATENCIÓN: incluye cambios locales pendientes de sincronización." : "Datos cargados en la aplicación al momento de exportar.",
    "Incluye registros eliminados y anulados que la aplicación conserva, identificados con su estado.",
    "Este informe es para consulta. Para restaurar la aplicación, conservá también el respaldo JSON.",
  ].filter(Boolean);
  for (const line of intro) {
    const wrapped = doc.splitTextToSize(pdfText(line), width - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4.5 + 1;
  }
  y += 5;
  for (let index = 0; index < report.sections.length; index++) {
    const section = report.sections[index];
    const title = `${index + 1}. ${section.title}`;
    const weights = section.title === "Clientes" ? [60, 30, 40, 139] : section.columns.map((column) => /Notas|Descripción|Antes|Después|Motivo/.test(column) ? 3 : /Producto|Cliente|Insumo|Combo|Concepto/.test(column) ? 2.3 : /Unidad|Cantidad|Rendimiento|Tandas|Mes/.test(column) ? 1.1 : 1.7);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const columnWidths = weights.map((weight) => (width - margin * 2) * weight / totalWeight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    let titleLines = doc.splitTextToSize(pdfText(title), width - margin * 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const noteLines = section.note ? doc.splitTextToSize(pdfText(section.note), width - margin * 2) : [];
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    const rowHeight = (row, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5);
      const lines = Math.max(1, ...row.map((cell, column) => doc.splitTextToSize(pdfText(cell), columnWidths[column] - 4.4).length));
      return lines * 8.5 * 25.4 / 72 * doc.getLineHeightFactor() + 4.4;
    };
    const tableHeight = rowHeight(section.columns, true) + (section.rows.length ? section.rows.reduce((sum, row) => sum + rowHeight(row), 0) : 9);
    const sectionHeight = titleLines.length * 5 + 2 + (noteLines.length ? noteLines.length * 4 + 3 : 0);
    const reservedTable = tableHeight + sectionHeight <= height - 38 ? tableHeight : 28;
    if (y + sectionHeight + reservedTable > height - 16) { doc.addPage(); y = 22; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.setTextColor(68, 35, 50);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 5 + 2;
    if (section.note) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(85);
      const wrapped = doc.splitTextToSize(pdfText(section.note), width - margin * 2);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 4 + 3;
    }
    const tableStartPage = doc.internal.getCurrentPageInfo().pageNumber;
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin, top: 22, bottom: 16 },
      head: [section.columns.map(pdfText)],
      body: section.rows.length ? section.rows.map((row) => row.map((cell) => pdfText(cell))) : [[{ content: "Sin registros", colSpan: section.columns.length }]],
      theme: "striped", showHead: "everyPage", rowPageBreak: "avoid",
      columnStyles: Object.fromEntries(columnWidths.map((cellWidth, column) => [column, { cellWidth }])),
      willDrawPage: () => {
        if (doc.internal.getCurrentPageInfo().pageNumber <= tableStartPage) return;
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100);
        doc.text(doc.splitTextToSize(pdfText(`${title} (continuación)`), width - margin * 2)[0], margin, 18);
      },
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, overflow: "linebreak", valign: "top", lineColor: [234, 223, 220], lineWidth: 0.1, textColor: [48, 37, 42] },
      headStyles: { fillColor: [138, 61, 85], fontSize: 8.5, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 247, 245] },
    });
    y = doc.lastAutoTable.finalY + 13;
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
    if (page > 1) doc.text(doc.splitTextToSize(pdfText(`${report.businessName} - Informe del negocio`), width - margin * 2)[0], margin, 12);
    doc.text("Dulce Gestión | Datos del negocio | UYU", margin, height - 8);
    doc.text(`Página ${page} de ${pages}`, width - margin, height - 8, { align: "right" });
  }
  return doc;
}

let libraryPromise;
async function pdfLibrary() {
  if (!libraryPromise) libraryPromise = (async () => {
    const load = (path) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL(path, import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error("No se pudo cargar el generador de PDF. Volvé a abrir la aplicación e intentá nuevamente.")); };
      document.head.append(script);
    });
    if (!globalThis.jspdf?.jsPDF) await load("./vendor/jspdf.umd.min.js");
    if (!globalThis.jspdf.jsPDF.API.autoTable) await load("./vendor/jspdf.plugin.autotable.min.js");
    return { jsPDF: globalThis.jspdf.jsPDF, autoTable: (doc, settings) => doc.autoTable(settings) };
  })().catch((error) => { libraryPromise = undefined; throw error; });
  return libraryPromise;
}

export async function exportBusinessPdf(state, options = {}) {
  const report = buildBusinessReport(structuredClone(state), options);
  const library = await pdfLibrary();
  const doc = createBusinessPdf(report, library);
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(report.exportedAt));
  await doc.save(`dulce-gestion-informe-${stamp}.pdf`, { returnPromise: true });
  return { pages: doc.getNumberOfPages() };
}
