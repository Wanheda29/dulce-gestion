import { correctPurchaseInventory, countedStock, customerKey, deleteIngredientRecord, deleteProductRecord, deleteProductionRecord, ingredientQuantity, ingredientUnit, ingredientUnitCost, ingredientWithManualCost, monthlySummary, pagedOrders, productionCostBreakdown, productDefinition, productionPlan, productionWithHomeSupply, profitOnCostPercent, recipeCost, reverseProductionStock, saleCustomerName as resolveSaleCustomerName, saleFromOrder, toBaseQuantity, unitGroups, updateWeightedAverage } from "./domain.js";
import { renderCombos as renderComboPage } from "./combos.js";
import { exportBusinessPdf, exportIndividualPdf } from "./pdf-export.js";
import { backupSummary, emptyState, exportState, loadState, normalizeState, parseBackup, saveState, uid } from "./storage.js";
import { getCloudAccount, getSession, isCloudConfigured, pullCloudState, pushCloudState, signIn, signOut } from "./cloud.js";

let state = isCloudConfigured() ? structuredClone(emptyState) : loadState();
const app = document.querySelector("#app");
const money = new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 0 });
const preciseMoney = new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ingredientMoney = new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const decimal = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 2 });
const titles = { inicio: "Resumen", insumos: "Insumos", compras: "Compras", productos: "Productos y recetas", combos: "Combos", produccion: "Producción", clientes: "Clientes", pedidos: "Pedidos", agenda: "Agenda", ventas: "Ventas", informes: "Informes", datos: "Datos y respaldos", cuenta: "Cuenta" };
const optionalLabels = { packaging: "Envases", labor: "Mano de obra", gas: "Gas", electricity: "Electricidad", delivery: "Reparto", other: "Otros" };
const statusLabels = { pendiente: "Pendiente", confirmado: "Confirmado", produccion: "En producción", listo: "Listo", entregado: "Entregado", cancelado: "Cancelado" };
const subscriptionLabels = { active: "Activa", grace: "Período de gracia", read_only: "Solo lectura", suspended: "Suspendida" };
const adjustmentLabels = { family: "Uso familiar", home: "Insumos de casa", correction: "Corrección de inventario", production: "Aporte de casa para producción" };
let cloudSession = null;
let cloudAccount = null;
let cloudLoading = isCloudConfigured();
let cloudRevision = 0;
let cloudSaveQueue = Promise.resolve();
let cloudWriteBlocked = false;
let cloudSyncError = "";
let cloudLoginError = "";
let confirmedCloudState = structuredClone(emptyState);
const cloudDraftKey = (businessId) => `dulce-gestion-cloud-draft-${businessId}`;

function readCloudDraft(businessId) {
  try {
    return JSON.parse(localStorage.getItem(cloudDraftKey(businessId)));
  } catch {
    return null;
  }
}

function writeCloudDraft(businessId, data, baseRevision) {
  localStorage.setItem(cloudDraftKey(businessId), JSON.stringify({ data, baseRevision, savedAt: new Date().toISOString() }));
}

const h = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const currentMonth = () => today().slice(0, 7);
const pdfReportFilters = { type: "sales", mode: "month", month: currentMonth(), from: `${currentMonth()}-01`, to: today() };
const activeIngredients = () => state.ingredients.filter((item) => !item.deletedAt);
const ingredientById = (id) => state.ingredients.find((item) => item.id === id);
const productById = (id) => state.products.find((item) => item.id === id);
const activeProducts = () => state.products.filter((item) => !item.deletedAt && item.kind !== "combo");
const activeSellables = () => state.products.filter((item) => {
  if (item.deletedAt) return false;
  try { productDefinition(item, state.products); return true; }
  catch { return false; }
});
const productionProducts = () => activeSellables().filter((product) => productDefinition(product, state.products).recipe?.every((line) => {
  const ingredient = ingredientById(line.ingredientId);
  return ingredient && !ingredient.deletedAt;
}));
const clientById = (id) => state.clients.find((item) => item.id === id);
const saleCustomerName = (sale) => resolveSaleCustomerName(sale, state.orders);
const customerOptions = (names, selected) => [...new Map(names.filter(Boolean).map((name) => [customerKey(name), name.trim()])).entries()]
  .sort((a, b) => a[1].localeCompare(b[1], "es"))
  .map(([key, label]) => `<option value="${h(key)}" ${selected === key ? "selected" : ""}>${h(label)}</option>`).join("");
let orderFilters = { client: "", status: "", page: 1 };
let reportClientFilter = "";

document.querySelector("#today").textContent = new Intl.DateTimeFormat("es-UY", { dateStyle: "long" }).format(new Date());
document.querySelector("#data-button").addEventListener("click", () => { location.hash = "datos"; });
const sidebar = document.querySelector(".sidebar");
const navBackdrop = document.querySelector("#nav-backdrop");
function setMenuOpen(open) {
  sidebar.classList.toggle("open", open);
  navBackdrop.hidden = !open;
  document.body.classList.toggle("menu-open", open);
  document.querySelector("#menu-button").setAttribute("aria-expanded", String(open));
}
document.querySelector("#menu-button").addEventListener("click", () => setMenuOpen(!sidebar.classList.contains("open")));
document.querySelector("#close-menu").addEventListener("click", () => setMenuOpen(false));
navBackdrop.addEventListener("click", () => setMenuOpen(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenuOpen(false); });
window.addEventListener("resize", () => { if (window.innerWidth > 900) setMenuOpen(false); });
window.addEventListener("hashchange", render);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

function persist(message) {
  if (["read_only", "suspended"].includes(cloudAccount?.status)) {
    state = structuredClone(confirmedCloudState);
    toast("La cuenta está en modo de solo lectura");
    render();
    return;
  }
  if (!cloudAccount?.businessId) {
    saveState(state);
    toast(message);
    render();
    return;
  }
  const businessId = cloudAccount.businessId;
  const snapshot = structuredClone(state);
  const existingDraft = readCloudDraft(businessId);
  writeCloudDraft(businessId, snapshot, existingDraft?.baseRevision ?? cloudRevision);
  toast("Guardando en la nube…");
  render();
  if (cloudWriteBlocked) return;
  cloudSaveQueue = cloudSaveQueue.then(async () => {
    if (cloudWriteBlocked) return;
    const nextRevision = await pushCloudState(businessId, snapshot, cloudRevision);
    cloudRevision = nextRevision;
    confirmedCloudState = structuredClone(snapshot);
    const latestDraft = readCloudDraft(businessId);
    if (latestDraft && JSON.stringify(latestDraft.data) === JSON.stringify(snapshot)) {
      localStorage.removeItem(cloudDraftKey(businessId));
      toast(message);
    } else if (latestDraft) {
      writeCloudDraft(businessId, latestDraft.data, nextRevision);
    }
  }).catch((error) => {
    cloudWriteBlocked = true;
    cloudSyncError = error.message;
    render();
    toast("No se pudo sincronizar. Se conservó un borrador en este dispositivo.");
  });
}

function toast(message, duration = 2200) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), duration);
}

function pageHeading(title, description, button = "") {
  return `<div class="section-heading"><div><h2>${title}</h2><p>${description}</p></div>${button}</div>`;
}

function empty(message, action = "") {
  return `<div class="empty"><span class="empty-icon">♡</span><p>${message}</p>${action}</div>`;
}

function dialog(content) {
  const element = document.createElement("dialog");
  element.innerHTML = `<div class="dialog-body">${content}</div>`;
  document.body.append(element);
  element.addEventListener("close", () => element.remove());
  element.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => element.close()));
  element.showModal();
  return element;
}

function confirmAction(title, message, actionLabel, onConfirm) {
  const modal = dialog(`<h2>${title}</h2><p>${message}</p><div class="form-actions"><button class="ghost" data-close>Cancelar</button><button class="danger" id="confirm-action">${actionLabel}</button></div>`);
  modal.querySelector("#confirm-action").addEventListener("click", () => { modal.close(); onConfirm(); });
}

function render() {
  const page = location.hash.slice(1) || "inicio";
  document.querySelector("#page-title").textContent = titles[page] ?? titles.inicio;
  document.querySelectorAll("nav a").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  setMenuOpen(false);
  if (cloudLoading) { renderCloudLoading(); return; }
  if (isCloudConfigured() && !cloudSession && page !== "cuenta") { location.hash = "cuenta"; return; }
  if (isCloudConfigured() && cloudSession && !cloudAccount && page !== "cuenta") { location.hash = "cuenta"; return; }
  if (cloudAccount?.status === "suspended" && page !== "cuenta") { renderSuspended(); return; }
  if (cloudWriteBlocked && page !== "cuenta" && page !== "datos") { renderSyncProblem(); return; }
  ({ inicio: renderDashboard, insumos: renderIngredients, compras: renderPurchases, productos: renderProducts, combos: renderCombos, produccion: renderProduction, clientes: renderClients, pedidos: renderOrders, agenda: renderAgenda, ventas: renderSales, informes: renderReports, datos: renderData, cuenta: renderAccount }[page] ?? renderDashboard)();
  labelResponsiveTables();
}

function labelResponsiveTables() {
  app.querySelectorAll(".table-wrap table").forEach((table) => {
    if (!table.querySelector("thead")) return;
    const labels = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
    table.classList.add("responsive-table");
    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.cells].forEach((cell, index) => { cell.dataset.label = labels[index] || ""; });
    });
  });
}

function renderCloudLoading() {
  app.innerHTML = `<article class="card account-state"><div class="spinner"></div><h2>Conectando con el negocio…</h2><p>Estamos comprobando la sesión y el estado del servicio.</p></article>`;
}

function renderSuspended() {
  app.innerHTML = `<article class="card account-state suspended-state"><div class="backup-icon">!</div><h2>Servicio suspendido</h2><p>Los datos están protegidos y no pueden consultarse mientras la cuenta esté suspendida. Contactá al proveedor del servicio para regularizarla.</p><button class="ghost" id="go-account">Ver cuenta</button></article>`;
  app.querySelector("#go-account").addEventListener("click", () => { location.hash = "cuenta"; });
}

function renderSyncProblem() {
  app.innerHTML = `<article class="card account-state"><span class="status status-cancelado">Sin sincronizar</span><h2>Hay cambios pendientes en este dispositivo</h2><p>${h(cloudSyncError || "No se pudo completar el guardado.")}</p><p>Conservamos un borrador local. Descargá una copia antes de decidir qué hacer.</p><div class="hero-actions"><button class="primary" id="export-pending">Descargar borrador</button><button class="secondary" id="retry-pending">Reintentar</button><button class="ghost" id="load-remote">Revisar datos de la nube</button></div></article>`;
  app.querySelector("#export-pending").addEventListener("click", () => exportState(state));
  app.querySelector("#retry-pending").addEventListener("click", retryCloudDraft);
  app.querySelector("#load-remote").addEventListener("click", () => confirmAction("Cargar datos de la nube", "Se descartará el borrador guardado en este dispositivo. Descargá una copia antes si querés conservarlo.", "Descartar borrador y cargar", discardCloudDraft));
}

function renderDashboard() {
  const summary = monthlySummary(state.sales, currentMonth());
  const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const upcoming = state.orders.filter((order) => !order.deletedAt && !["entregado", "cancelado"].includes(order.status)).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).slice(0, 5);
  app.innerHTML = `
    <section class="hero">
      <div><p class="eyebrow">Tu negocio, con números claros</p><h2>Sabé cuánto cuesta antes de ponerle precio.</h2><p>Registrá compras, armá recetas y conservá el costo real de cada venta. Los gastos de gas, luz, reparto y trabajo siempre son opcionales.</p><div class="hero-actions"><button class="primary" data-go="pedidos">Nuevo pedido</button><button class="secondary" data-go="agenda">Ver agenda</button></div></div>
    </section>
    <div class="stats">
      <article class="stat"><small>Ventas del mes</small><strong>${money.format(summary.revenue)}</strong></article>
      <article class="stat"><small>Costo del mes</small><strong>${money.format(summary.cost)}</strong></article>
      <article class="stat"><small>Ganancia bruta</small><strong class="positive">${money.format(summary.profit)}</strong></article>
      <article class="stat"><small>Encargos registrados</small><strong>${summary.orders}</strong></article>
    </div>
    <div class="grid-2">
      <article class="card"><h3>Próximas entregas</h3>${upcoming.length ? `<div class="order-list compact">${upcoming.map((order) => `<div class="order-row"><div><strong>${h(order.customerName)}</strong><small>${h(productById(order.productId)?.name || "Producto eliminado")}</small></div><div><strong>${order.deliveryDate}</strong><span class="status status-${order.status}">${statusLabels[order.status]}</span></div></div>`).join("")}</div>` : empty("No hay pedidos pendientes.")}</article>
      <article class="card"><h3>Últimas ventas</h3>${recent.length ? `<div class="table-wrap"><table><tbody>${recent.map((sale) => `<tr><td>${h(productById(sale.productId)?.name || "Producto eliminado")}</td><td>${sale.date}</td><td>${money.format(sale.quantity * sale.unitPrice)}</td></tr>`).join("")}</tbody></table></div>` : empty("Todavía no registraste ventas.")}</article>
    </div>`;
  app.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => { location.hash = button.dataset.go; }));
}

function renderIngredients() {
  const adjustments = [...state.stockAdjustments].sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")));
  app.innerHTML = pageHeading("Insumos", "Editá los costos y corregí la existencia; también podés registrar compras.", `<button class="primary" id="new-ingredient">Nuevo insumo</button>`) + `
    <article class="card">${activeIngredients().length ? `<div class="table-wrap"><table><thead><tr><th>Insumo</th><th>Existencia</th><th>Costo por unidad</th><th>Valor en stock</th><th></th></tr></thead><tbody>${activeIngredients().map((item) => `<tr><td><strong>${h(item.name)}</strong></td><td>${decimal.format(ingredientQuantity(item, item.stock))} ${ingredientUnit(item)}</td><td>${ingredientMoney.format(ingredientUnitCost(item))} / ${ingredientUnit(item)}</td><td>${money.format(item.stock * item.averageCost)}</td><td class="actions"><div class="row-actions"><button class="ghost compact-button" data-cost-ingredient="${item.id}">Editar costo</button><button class="ghost compact-button" data-adjust-ingredient="${item.id}">Ajustar stock</button><button class="ghost compact-button" data-edit-ingredient="${item.id}">Editar</button><button class="danger compact-button" data-delete-ingredient="${item.id}">Eliminar</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("Creá harina, azúcar, huevos o cualquier materia prima.", `<button class="primary" id="empty-ingredient">Crear primer insumo</button>`)}</article>
    <article class="card stock-history"><h3>Historial de ajustes</h3><p class="muted">Los cambios manuales y los aportes desde casa quedan registrados aquí. Las compras se consultan en Compras.</p>${adjustments.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Insumo</th><th>Cambio</th><th>Existencia</th><th>Motivo</th><th>Valor agregado</th><th>Registrado por</th></tr></thead><tbody>${adjustments.map((entry) => `<tr><td>${h(entry.date || entry.createdAt?.slice(0, 10) || "")}</td><td><strong>${h(ingredientById(entry.ingredientId)?.name || entry.ingredientName || "Insumo eliminado")}</strong></td><td>${entry.delta > 0 ? "+" : ""}${decimal.format(entry.delta)} ${h(entry.unit || "")}</td><td>${decimal.format(entry.previousStock)} → ${decimal.format(entry.newStock)} ${h(entry.unit || "")}</td><td>${h(adjustmentLabels[entry.reason] || entry.reason)}${entry.note ? `<small class="muted history-note">${h(entry.note)}</small>` : ""}${entry.voidedAt ? `<small class="muted history-note">Anulado con la producción</small>` : ""}</td><td>${entry.delta > 0 ? money.format(entry.addedValue || 0) : "—"}${entry.costUnestimated ? `<small class="muted history-note">Sin estimar</small>` : ""}</td><td>${h(entry.actorEmail || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("Todavía no hay ajustes de stock.")}</article>`;
  app.querySelector("#new-ingredient")?.addEventListener("click", () => openIngredientDialog());
  app.querySelector("#empty-ingredient")?.addEventListener("click", () => openIngredientDialog());
  app.querySelectorAll("[data-edit-ingredient]").forEach((button) => button.addEventListener("click", () => openIngredientDialog(ingredientById(button.dataset.editIngredient))));
  app.querySelectorAll("[data-cost-ingredient]").forEach((button) => button.addEventListener("click", () => openIngredientCostDialog(ingredientById(button.dataset.costIngredient))));
  app.querySelectorAll("[data-adjust-ingredient]").forEach((button) => button.addEventListener("click", () => openStockAdjustmentDialog(ingredientById(button.dataset.adjustIngredient))));
  app.querySelectorAll("[data-delete-ingredient]").forEach((button) => button.addEventListener("click", () => deleteIngredient(button.dataset.deleteIngredient)));
}

function deleteIngredient(ingredientId) {
  const ingredient = ingredientById(ingredientId);
  if (!ingredient) return;
  confirmAction("Eliminar insumo", `Se eliminará «${h(ingredient.name)}» del inventario activo, aunque tenga stock, costos o movimientos. Las compras, ajustes y costos históricos se conservarán. Las recetas que lo usen conservarán su último costo, pero tendrás que reemplazarlo o quitarlo para volver a producir.`, "Eliminar insumo", () => {
    Object.assign(ingredient, deleteIngredientRecord(ingredient, new Date().toISOString(), cloudSession?.user?.email || null));
    persist("Insumo eliminado");
  });
}

function openStockAdjustmentDialog(ingredient) {
  const modal = dialog(`<h2>Ajustar stock</h2><p>${h(ingredient.name)}: el sistema registra ${decimal.format(ingredientQuantity(ingredient, ingredient.stock))} ${h(ingredientUnit(ingredient))}. Indicá cuánto hay realmente; el cambio quedará en el historial.</p><form id="stock-adjustment-form"><div class="form-grid"><div class="field"><label>Existencia real (${h(ingredientUnit(ingredient))})</label><input name="actualStock" type="number" min="0" step="any" value="${ingredientQuantity(ingredient, ingredient.stock)}" required></div><div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}" required></div><div class="field full"><label>Motivo</label><select name="reason"><option value="correction">Corrección de inventario</option><option value="family">Uso familiar</option><option value="home">Insumos de casa</option></select></div><div class="field full"><label>Nota (opcional)</label><input name="note" maxlength="200" placeholder="Ej. Usaron harina para cocinar en casa"></div><div class="field full" id="added-value-field" hidden><label>Valor estimado del aumento ($)</label><input name="addedValue" type="number" min="0" step="0.01"><small class="muted">No se registra como compra. Si no conocés el valor, podés dejarlo en cero y figurará como sin estimar.</small></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar ajuste</button></div></form>`);
  const form = modal.querySelector("form");
  const valueField = form.querySelector("#added-value-field");
  let valueEdited = false;
  let reasonEdited = false;
  form.elements.addedValue.addEventListener("input", () => { valueEdited = true; });
  form.elements.reason.addEventListener("change", () => { reasonEdited = true; });
  form.elements.actualStock.addEventListener("input", () => {
    const delta = toBaseQuantity(form.elements.actualStock.value, ingredientUnit(ingredient), ingredient.baseUnit) - Number(ingredient.stock);
    valueField.hidden = !(delta > 0);
    if (delta > 0 && !valueEdited) form.elements.addedValue.value = (delta * Number(ingredient.averageCost || 0)).toFixed(2);
    if (!reasonEdited) form.elements.reason.value = delta > 0 ? "home" : delta < 0 ? "family" : "correction";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const actualStock = toBaseQuantity(form.elements.actualStock.value, ingredientUnit(ingredient), ingredient.baseUnit);
      const counted = countedStock(ingredient, actualStock, Number(form.elements.addedValue.value || 0));
      if (!counted.delta) return toast("La existencia no cambió");
      state.stockAdjustments.push({ id: uid("adj"), ingredientId: ingredient.id, ingredientName: ingredient.name, unit: ingredient.baseUnit, previousStock: counted.previousStock, newStock: counted.stock, delta: counted.delta, addedValue: counted.addedValue, costUnestimated: counted.delta > 0 && counted.addedValue === 0, reason: form.elements.reason.value, note: form.elements.note.value.trim(), date: form.elements.date.value, createdAt: new Date().toISOString(), actorEmail: cloudSession?.user?.email || null, sourceProductionId: null });
      ingredient.stock = counted.stock;
      ingredient.averageCost = counted.averageCost;
      modal.close();
      persist("Stock ajustado e historial actualizado");
    } catch (error) { toast(error.message); }
  });
}

function openIngredientCostDialog(ingredient) {
  const units = unitGroups[ingredient.baseUnit];
  const initialUnit = units.find((unit) => unit.value === ingredient.displayUnit) || units.at(-1);
  const initialCost = Number(ingredient.averageCost || 0) * initialUnit.factor;
  const modal = dialog(`<h2>Editar costo</h2><p><strong>${h(ingredient.name)}</strong>: indicá el costo de referencia para calcular las recetas y valorar el stock actual. Las ventas y producciones ya registradas conservan sus costos históricos.</p><form id="ingredient-cost-form"><div class="form-grid"><div class="field"><label for="ingredient-cost">Costo ($)</label><input id="ingredient-cost" name="cost" type="number" min="0" step="any" value="${initialCost}" required></div><div class="field"><label for="ingredient-cost-unit">Por cada</label><select id="ingredient-cost-unit" name="costUnit">${units.map((unit) => `<option value="${unit.value}" ${unit.value === initialUnit.value ? "selected" : ""}>${{ g: "gramo", kg: "kilogramo", ml: "mililitro", l: "litro", unidad: "unidad" }[unit.value]}</option>`).join("")}</select></div><div class="field full"><small class="muted">Este cambio no registra una compra ni modifica la cantidad disponible. Las próximas compras volverán a calcular el costo promedio.</small></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar costo</button></div></form>`);
  const form = modal.querySelector("form");
  let selectedUnit = initialUnit;
  form.elements.costUnit.addEventListener("change", () => {
    const nextUnit = units.find((unit) => unit.value === form.elements.costUnit.value);
    if (form.elements.cost.value !== "" && Number.isFinite(Number(form.elements.cost.value))) {
      form.elements.cost.value = Number(form.elements.cost.value) / selectedUnit.factor * nextUnit.factor;
    }
    selectedUnit = nextUnit;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const updated = ingredientWithManualCost(ingredient, form.elements.cost.value, form.elements.costUnit.value);
      if (updated.averageCost === Number(ingredient.averageCost || 0) && ingredientUnit(ingredient) === form.elements.costUnit.value) {
        modal.close();
        return toast("El costo no cambió");
      }
      const history = ingredient.costHistory || [];
      ingredient.costHistory = [...history, {
        previousCost: Number(ingredient.averageCost || 0), newCost: updated.averageCost,
        amount: Number(form.elements.cost.value), costUnit: form.elements.costUnit.value,
        createdAt: new Date().toISOString(), actorEmail: cloudSession?.user?.email || null,
      }];
      ingredient.averageCost = updated.averageCost;
      ingredient.displayUnit = form.elements.costUnit.value;
      modal.close();
      persist("Costo del insumo actualizado");
    } catch (error) { toast(error.message); }
  });
}

function openIngredientDialog(existing = null) {
  const unitLocked = existing && (Number(existing.stock || 0) > 0 || Number(existing.averageCost || 0) > 0 || existing.costHistory?.length || state.stockAdjustments.some((entry) => entry.ingredientId === existing.id) || state.purchases.some((purchase) => purchase.ingredientId === existing.id) || state.products.some((product) => product.recipe?.some((line) => line.ingredientId === existing.id)));
  const options = [{ value: "g", label: "Gramos" }, { value: "kg", label: "Kilogramos" }, { value: "ml", label: "Mililitros" }, { value: "unidad", label: "Unidades" }].filter((unit) => !unitLocked || unitGroups[existing.baseUnit].some((option) => option.value === unit.value));
  const modal = dialog(`<h2>${existing ? "Editar insumo" : "Nuevo insumo"}</h2><p>Elegí la unidad en la que querés ver la existencia y el costo del insumo.</p><form id="ingredient-form"><div class="form-grid"><div class="field full"><label>Nombre</label><input name="name" required value="${h(existing?.name || "")}" placeholder="Ej. Harina 0000"></div><div class="field full"><label for="ingredient-unit">Unidad del insumo</label><select id="ingredient-unit" name="baseUnit">${options.map((unit) => `<option value="${unit.value}" ${unit.value === (existing ? ingredientUnit(existing) : "g") ? "selected" : ""}>${unit.label}</option>`).join("")}</select>${unitLocked ? `<small class="muted">Las unidades compatibles se convierten automáticamente. Las recetas y los movimientos anteriores conservan sus cantidades.</small>` : ""}</div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar insumo</button></div></form>`);
  modal.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (existing) {
      existing.name = data.get("name").trim();
      if (unitLocked) existing.displayUnit = data.get("baseUnit");
      else { existing.baseUnit = data.get("baseUnit"); delete existing.displayUnit; }
    } else state.ingredients.push({ id: uid("ing"), name: data.get("name").trim(), baseUnit: data.get("baseUnit"), stock: 0, averageCost: 0 });
    modal.close();
    persist(existing ? "Insumo actualizado" : "Insumo creado");
  });
}

function renderPurchases() {
  const purchases = state.purchases.filter((item) => !item.deletedAt).slice().reverse();
  const changes = state.purchases.flatMap((item) => (item.history || []).map((change) => ({ ...change, purchaseId: item.id }))).sort((a, b) => b.at.localeCompare(a.at));
  app.innerHTML = pageHeading("Compras", "Cada compra actualiza el costo promedio y la existencia.", `<button class="primary" id="new-purchase" ${activeIngredients().length ? "" : "disabled"}>Registrar compra</button>`) + `
    ${!activeIngredients().length ? `<p class="warning">Antes de registrar una compra necesitás crear al menos un insumo.</p>` : ""}
    <article class="card">${purchases.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Insumo</th><th>Cantidad</th><th>Total pagado</th><th></th></tr></thead><tbody>${purchases.map((purchase) => `<tr><td>${h(purchase.date)}</td><td><strong>${h(ingredientById(purchase.ingredientId)?.name || "Insumo eliminado")}</strong></td><td>${decimal.format(purchase.quantity)} ${h(purchase.purchaseUnit)}</td><td>${money.format(purchase.totalCost)}</td><td class="actions"><div class="row-actions"><button class="ghost compact-button" data-edit-purchase="${purchase.id}">Editar</button><button class="danger compact-button" data-delete-purchase="${purchase.id}">Eliminar</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("Las compras aparecerán aquí.")}</article>
    <article class="card stock-history"><h3>Correcciones de compras</h3><p class="muted">Se conserva qué se cambió o eliminó y quién lo hizo. Los costos históricos de ventas y producciones no se modifican.</p>${changes.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Antes</th><th>Después</th><th>Registrado por</th></tr></thead><tbody>${changes.map((change) => `<tr><td>${h(change.at.slice(0, 10))}</td><td>${change.type === "delete" ? "Eliminada" : "Editada"}</td><td>${h(purchaseDescription(change.before))}</td><td>${change.after ? h(purchaseDescription(change.after)) : "—"}</td><td>${h(change.actorEmail || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("Todavía no hay compras corregidas.")}</article>`;
  app.querySelector("#new-purchase")?.addEventListener("click", openPurchaseDialog);
  app.querySelectorAll("[data-edit-purchase]").forEach((button) => button.addEventListener("click", () => openPurchaseDialog(state.purchases.find((item) => item.id === button.dataset.editPurchase))));
  app.querySelectorAll("[data-delete-purchase]").forEach((button) => button.addEventListener("click", () => deletePurchase(button.dataset.deletePurchase)));
}

function purchaseSnapshot(purchase) {
  return { ingredientId: purchase.ingredientId, quantity: purchase.quantity, purchaseUnit: purchase.purchaseUnit, baseQuantity: purchase.baseQuantity, totalCost: purchase.totalCost, date: purchase.date };
}

function purchaseDescription(purchase) {
  const ingredient = ingredientById(purchase.ingredientId);
  return `${purchase.date} · ${ingredient?.name || "Insumo eliminado"} · ${decimal.format(purchase.quantity)} ${purchase.purchaseUnit} · ${money.format(purchase.totalCost)}`;
}

function deletePurchase(purchaseId) {
  const purchase = state.purchases.find((item) => item.id === purchaseId && !item.deletedAt);
  if (!purchase) return;
  let updatedIngredients;
  try { updatedIngredients = correctPurchaseInventory(state.ingredients, purchase); }
  catch (error) { return toast(error.message, 6000); }
  confirmAction("Eliminar compra", `Se quitará la compra de ${h(ingredientById(purchase.ingredientId)?.name || "este insumo")} y se descontarán ${decimal.format(purchase.baseQuantity)} ${h(ingredientById(purchase.ingredientId)?.baseUnit || "unidades")} del stock actual. La corrección quedará en el historial.`, "Eliminar compra", () => {
    state.ingredients = updatedIngredients;
    purchase.history ??= [];
    purchase.history.push({ type: "delete", before: purchaseSnapshot(purchase), after: null, at: new Date().toISOString(), actorEmail: cloudSession?.user?.email || null });
    purchase.deletedAt = new Date().toISOString();
    persist("Compra eliminada y stock corregido");
  });
}

function openPurchaseDialog(existing = null) {
  const modal = dialog(`<h2>${existing ? "Editar compra" : "Registrar compra"}</h2><p>${existing ? "Al guardar se ajustarán el stock y el costo actuales. Los costos históricos no cambian." : "Ingresá el total pagado; el costo unitario se calcula automáticamente."}</p><form id="purchase-form"><div class="form-grid"><div class="field full"><label>Insumo</label><select name="ingredientId">${state.ingredients.filter((item) => !item.deletedAt || item.id === existing?.ingredientId).map((item) => `<option value="${item.id}">${h(item.name)}${item.deletedAt ? " (eliminado)" : ""}</option>`).join("")}</select></div><div class="field"><label>Cantidad</label><input name="quantity" type="number" min="0.001" step="0.001" value="${existing?.quantity ?? ""}" required></div><div class="field"><label>Unidad de compra</label><select name="purchaseUnit"></select></div><div class="field"><label>Total pagado ($)</label><input name="totalCost" type="number" min="0" step="0.01" value="${existing?.totalCost ?? ""}" required></div><div class="field"><label>Fecha</label><input name="date" type="date" value="${existing?.date || today()}" required></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">${existing ? "Guardar cambios" : "Guardar compra"}</button></div></form>`);
  const form = modal.querySelector("form");
  const ingredientSelect = form.elements.ingredientId;
  const updateUnits = () => { const ingredient = ingredientById(ingredientSelect.value); form.elements.purchaseUnit.innerHTML = unitGroups[ingredient.baseUnit].map((unit) => `<option value="${unit.value}">${unit.label}</option>`).join(""); };
  ingredientSelect.addEventListener("change", updateUnits);
  if (existing) ingredientSelect.value = existing.ingredientId;
  updateUnits();
  if (existing) form.elements.purchaseUnit.value = existing.purchaseUnit;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const ingredient = ingredientById(data.get("ingredientId"));
    const baseQuantity = toBaseQuantity(data.get("quantity"), data.get("purchaseUnit"), ingredient.baseUnit);
    const values = { ingredientId: ingredient.id, quantity: Number(data.get("quantity")), purchaseUnit: data.get("purchaseUnit"), baseQuantity, totalCost: Number(data.get("totalCost")), date: data.get("date") };
    if (existing) {
      let updatedIngredients;
      try { updatedIngredients = correctPurchaseInventory(state.ingredients, existing, values); }
      catch (error) { return toast(error.message, 6000); }
      state.ingredients = updatedIngredients;
      existing.history ??= [];
      existing.history.push({ type: "edit", before: purchaseSnapshot(existing), after: values, at: new Date().toISOString(), actorEmail: cloudSession?.user?.email || null });
      Object.assign(existing, values);
    } else {
      const updated = updateWeightedAverage(ingredient.stock, ingredient.averageCost, baseQuantity, values.totalCost);
      ingredient.stock = updated.stock;
      ingredient.averageCost = updated.averageCost;
      state.purchases.push({ id: uid("buy"), ...values, createdAt: new Date().toISOString(), history: [] });
    }
    modal.close();
    persist(existing ? "Compra corregida y stock actualizado" : "Compra registrada y costo actualizado");
  });
}

function renderCombos() {
  renderComboPage({ app, state, pageHeading, dialog, persist, toast, h, money, decimal, uid, deleteProduct });
}

function renderProducts() {
  const products = activeProducts();
  app.innerHTML = pageHeading("Productos y recetas", "El costo se recalcula con los precios actuales de los insumos.", `<button class="primary" id="new-product" ${activeIngredients().length ? "" : "disabled"}>Nuevo producto</button>`) + `
    ${!activeIngredients().length ? `<p class="warning">Creá al menos un insumo antes de armar una receta.</p>` : ""}
    <div class="grid-2">${products.length ? products.map((product) => { const cost = recipeCost(product, state.ingredients, state.products); const profitPercent = profitOnCostPercent(product.salePrice, cost.unitCost); return `<article class="card"><div class="card-title-row"><span class="pill">${h(product.category || "Producto")}</span><div class="row-actions"><button class="ghost compact-button" data-edit-product="${product.id}">Editar</button><button class="danger compact-button" data-delete-product="${product.id}">Eliminar receta</button></div></div><h2>${h(product.name)}</h2>${product.recipe?.some((line) => ingredientById(line.ingredientId)?.deletedAt) ? `<p class="warning">Esta receta usa insumos eliminados. Conserva su último costo; reemplazalos o quitalos para volver a producir.</p>` : ""}<p class="muted">La receta rinde ${decimal.format(product.yieldQuantity)} ${product.yieldQuantity === 1 ? "unidad" : "unidades"}.</p><div class="stats" style="grid-template-columns:1fr 1fr"><div><small class="muted">Costo unitario</small><br><strong>${money.format(cost.unitCost)}</strong></div><div><small class="muted">Precio de venta</small><br><strong>${money.format(product.salePrice)}</strong></div></div><p>Ganancia sobre costo: <strong>${profitPercent === null ? "Sin costo definido" : `${decimal.format(profitPercent)}%`}</strong></p></article>`; }).join("") : `<article class="card" style="grid-column:1/-1">${empty("Todavía no hay productos ni recetas.")}</article>`}</div>`;
  app.querySelector("#new-product")?.addEventListener("click", () => openProductDialog());
  app.querySelectorAll("[data-edit-product]").forEach((button) => button.addEventListener("click", () => openProductDialog(productById(button.dataset.editProduct))));
  app.querySelectorAll("[data-delete-product]").forEach((button) => button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct)));
}

function deleteProduct(productId) {
  const product = productById(productId);
  try { deleteProductRecord(product, state.orders, new Date().toISOString(), null, state.products); }
  catch (error) { return toast(error.message, 6000); }
  const label = product.kind === "combo" ? "combo" : "receta";
  confirmAction(`Eliminar ${label}`, "Se quitará «" + h(product.name) + "» del catálogo y de las opciones para nuevos registros. Las ventas, producciones e informes anteriores se conservan.", `Eliminar ${label}`, () => {
    try {
      Object.assign(product, deleteProductRecord(product, state.orders, new Date().toISOString(), cloudSession?.user?.email || null, state.products));
      persist(product.kind === "combo" ? "Combo eliminado" : "Receta eliminada");
    } catch (error) { toast(error.message, 6000); }
  });
}

function ingredientOptions(selectedId = null) {
  return state.ingredients.filter((item) => !item.deletedAt || item.id === selectedId).map((item) => `<option value="${item.id}">${h(item.name)} (${ingredientUnit(item)})${item.deletedAt ? " - eliminado" : ""}</option>`).join("");
}

function openProductDialog(existing = null) {
  const modal = dialog(`<h2>${existing ? "Editar producto" : "Nuevo producto"}</h2><p>Solo la receta es necesaria. Todos los gastos adicionales pueden quedar en cero.</p><form id="product-form"><div class="form-grid"><div class="field"><label>Nombre</label><input name="name" required value="${h(existing?.name || "")}" placeholder="Ej. Torta de frutilla"></div><div class="field"><label>Categoría</label><input name="category" value="${h(existing?.category || "")}" placeholder="Ej. Tortas"></div><div class="field"><label>Rendimiento de la receta</label><input name="yieldQuantity" type="number" min="0.01" step="0.01" value="${existing?.yieldQuantity || 1}" required></div><div class="field"><label>Precio de venta ($)</label><input name="salePrice" type="number" min="0" step="0.01" value="${existing?.salePrice || 0}" required></div><div class="field full"><label>Ingredientes</label><div id="recipe-lines" class="recipe-lines"></div><button type="button" class="ghost" id="add-line">+ Agregar ingrediente</button></div><div class="field full optional-box"><h3>Gastos opcionales por receta</h3><p>Completá solamente lo que quieras incluir en el cálculo.</p><div class="form-grid">${Object.entries(optionalLabels).map(([key, label]) => `<div class="field"><label>${label} ($)</label><input name="${key}" type="number" min="0" step="0.01" value="${existing?.optionalCosts?.[key] || ""}" placeholder="0"></div>`).join("")}</div></div><div class="field full"><div class="cost-preview"><span>Costo estimado de la receta</span><strong id="cost-preview">${money.format(0)}</strong></div></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar producto</button></div></form>`);
  const form = modal.querySelector("form");
  const lines = form.querySelector("#recipe-lines");
  const addLine = (line = null) => {
    const row = document.createElement("div");
    row.className = "recipe-line";
    row.innerHTML = `<div class="field"><select class="line-ingredient" aria-label="Ingrediente">${ingredientOptions(line?.ingredientId)}</select></div><div class="field"><input class="line-quantity" type="number" min="0.000001" step="any" value="${line?.quantity || ""}" placeholder="Cantidad" aria-label="Cantidad de ingrediente" required></div><div class="field"><select class="line-unit" aria-label="Unidad de ingrediente"></select></div><button type="button" aria-label="Quitar ingrediente">×</button>`;
    const ingredientSelect = row.querySelector(".line-ingredient");
    const quantityInput = row.querySelector(".line-quantity");
    const unitSelect = row.querySelector(".line-unit");
    if (line) ingredientSelect.value = line.ingredientId;
    let selectedIngredient = ingredientById(ingredientSelect.value);
    let selectedUnit = line?.unit || (line ? selectedIngredient.baseUnit : ingredientUnit(selectedIngredient));
    const updateUnits = () => {
      unitSelect.innerHTML = unitGroups[selectedIngredient.baseUnit].map((unit) => '<option value="' + unit.value + '">' + unit.label + '</option>').join("");
      unitSelect.value = selectedUnit;
    };
    updateUnits();
    ingredientSelect.addEventListener("change", () => {
      selectedIngredient = ingredientById(ingredientSelect.value);
      if (!unitGroups[selectedIngredient.baseUnit].some((unit) => unit.value === selectedUnit)) selectedUnit = ingredientUnit(selectedIngredient);
      updateUnits();
      updatePreview();
    });
    unitSelect.addEventListener("change", () => {
      if (quantityInput.value !== "") quantityInput.value = toBaseQuantity(quantityInput.value, selectedUnit, selectedIngredient.baseUnit) / toBaseQuantity(1, unitSelect.value, selectedIngredient.baseUnit);
      selectedUnit = unitSelect.value;
      updatePreview();
    });
    row.querySelector("button").addEventListener("click", () => { if (lines.children.length > 1) row.remove(); updatePreview(); });
    quantityInput.addEventListener("input", updatePreview);
    lines.append(row);
  };
  const getDraft = () => ({ yieldQuantity: Number(form.elements.yieldQuantity.value || 1), recipe: [...lines.children].map((row) => ({ ingredientId: row.querySelector(".line-ingredient").value, quantity: Number(row.querySelector(".line-quantity").value || 0), unit: row.querySelector(".line-unit").value })), optionalCosts: Object.fromEntries(Object.keys(optionalLabels).map((key) => [key, Number(form.elements[key].value || 0)])) });
  const updatePreview = () => { form.querySelector("#cost-preview").textContent = money.format(recipeCost(getDraft(), state.ingredients).batchCost); };
  form.querySelector("#add-line").disabled = !activeIngredients().length;
  form.querySelector("#add-line").addEventListener("click", () => addLine());
  form.querySelectorAll("input").forEach((field) => field.addEventListener("input", updatePreview));
  (existing?.recipe?.length ? existing.recipe : [null]).forEach(addLine);
  updatePreview();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = getDraft();
    const values = { name: form.elements.name.value.trim(), category: form.elements.category.value.trim(), salePrice: Number(form.elements.salePrice.value), ...draft };
    if (existing) Object.assign(existing, values);
    else state.products.push({ id: uid("prd"), ...values });
    modal.close();
    persist(existing ? "Producto actualizado" : "Producto y receta guardados");
  });
}

function renderProduction() {
  const productions = state.productions.filter((item) => !item.deletedAt).slice().reverse();
  app.innerHTML = pageHeading("Producción", "Registrá cada elaboración y descontá sus insumos del inventario.", `<button class="primary" id="new-production" ${productionProducts().length ? "" : "disabled"}>Registrar producción</button>`) + `
    ${!productionProducts().length ? `<p class="warning">Necesitás una receta con insumos activos para producir. Si eliminaste un insumo, reemplazalo o quitalo de las recetas que lo usen.</p>` : ""}
    <article class="card">${productions.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tandas</th><th>Unidades obtenidas</th><th>Costo total</th><th>Estado</th><th></th></tr></thead><tbody>${productions.map((production) => `<tr class="production-row ${production.voidedAt ? "voided-row" : ""}" data-production-details="${production.id}"><td>${h(production.date)}</td><td><button class="production-name" data-open-production="${production.id}">${h(production.productNameSnapshot || productById(production.productId)?.name || "Producto eliminado")}<small>Ver desglose</small></button></td><td>${decimal.format(production.batches)}</td><td>${decimal.format(production.producedQuantity)}</td><td>${money.format(production.totalCostSnapshot)}${production.costUnestimated ? `<small class="history-note muted">Costo parcial: aporte sin estimar</small>` : ""}</td><td>${production.voidedAt ? `<span class="status status-cancelado">Anulada</span>` : `<span class="status status-entregado">Registrada</span>`}</td><td class="actions"><div class="row-actions">${production.voidedAt ? "" : `<button class="ghost compact-button" data-void-production="${production.id}">Anular</button>`}<button class="danger compact-button" data-delete-production="${production.id}">Eliminar</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("Las elaboraciones registradas aparecerán aquí.")}</article>`;
  app.querySelector("#new-production")?.addEventListener("click", openProductionDialog);
  app.querySelectorAll("[data-production-details]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("[data-void-production], [data-delete-production]")) return;
    openProductionDetails(row.dataset.productionDetails);
  }));
  app.querySelectorAll("[data-void-production]").forEach((button) => button.addEventListener("click", () => confirmAction("Anular producción", "Se devolverán los insumos descontados y se revertirán los aportes automáticos de casa. El registro permanecerá visible como anulado.", "Anular producción", () => voidProduction(button.dataset.voidProduction))));
  app.querySelectorAll("[data-delete-production]").forEach((button) => button.addEventListener("click", () => deleteProduction(button.dataset.deleteProduction)));
}

function openProductionDetails(productionId) {
  const production = state.productions.find((item) => item.id === productionId && !item.deletedAt);
  if (!production) return;
  const breakdown = productionCostBreakdown(production);
  const optionalLines = breakdown.optionalLines === null && breakdown.optionalCost > 0
    ? [{ label: "Otros gastos (detalle anterior no disponible)", totalCost: breakdown.optionalCost }]
    : breakdown.optionalLines || [];
  dialog(`<h2>Desglose de producción</h2><p>${h(production.productNameSnapshot || productById(production.productId)?.name || "Producto eliminado")} · ${h(production.date)} · ${decimal.format(production.batches)} tanda${production.batches === 1 ? "" : "s"} · ${decimal.format(production.producedQuantity)} ${production.producedQuantity === 1 ? "unidad" : "unidades"}</p>
    ${production.voidedAt ? `<p class="warning">Esta producción fue anulada. Los importes son los registrados originalmente.</p>` : ""}
    ${production.costUnestimated ? `<p class="warning">Costo parcial: se utilizaron insumos de casa sin valor estimado.</p>` : ""}
    <div class="breakdown"><h3>Insumos</h3>${breakdown.ingredients.length ? breakdown.ingredients.map((line) => `<div class="breakdown-line"><span>${h(line.name)}<small>${decimal.format(line.quantity)} ${h(line.unit)} · ${preciseMoney.format(line.quantity ? line.cost / line.quantity : 0)} por ${h(line.unit || "unidad")}</small></span><strong>${preciseMoney.format(line.cost)}</strong></div>`).join("") : `<p class="muted">No se registraron insumos.</p>`}<div class="breakdown-line subtotal"><span>Subtotal de insumos</span><strong>${preciseMoney.format(breakdown.ingredientCost)}</strong></div>
    <h3>Gastos adicionales</h3>${optionalLines.length ? optionalLines.map((line) => `<div class="breakdown-line"><span>${h(line.label)}</span><strong>${preciseMoney.format(line.totalCost)}</strong></div>`).join("") : `<p class="muted">No se incluyeron gastos adicionales.</p>`}<div class="breakdown-line subtotal"><span>Subtotal de gastos</span><strong>${preciseMoney.format(breakdown.optionalCost)}</strong></div>
    <div class="breakdown-line total"><span>Costo total</span><strong>${preciseMoney.format(breakdown.totalCost)}</strong></div><div class="breakdown-line"><span>Costo por unidad obtenida</span><strong>${preciseMoney.format(breakdown.unitCost)}</strong></div></div>
    <div class="form-actions"><button class="primary" data-close>Cerrar</button></div>`);
}

function reverseRegisteredProduction(production) {
  const homeAdjustments = state.stockAdjustments.filter((entry) => entry.sourceProductionId === production.id && !entry.voidedAt);
  const restoredIngredients = reverseProductionStock(state.ingredients, production.requirementsSnapshot, homeAdjustments);
  state.ingredients = restoredIngredients;
  homeAdjustments.forEach((entry) => { entry.voidedAt = new Date().toISOString(); });
  production.voidedAt = new Date().toISOString();
}

function voidProduction(productionId) {
  const production = state.productions.find((item) => item.id === productionId);
  if (!production || production.voidedAt || production.deletedAt) return;
  try { reverseRegisteredProduction(production); }
  catch (error) { return toast(error.message); }
  persist("Producción anulada e insumos devueltos");
}

function deleteProduction(productionId) {
  const production = state.productions.find((item) => item.id === productionId && !item.deletedAt);
  if (!production) return;
  const message = production.voidedAt
    ? "Se quitará esta producción anulada de la lista. El stock no cambiará otra vez. El respaldo conservará el registro."
    : "Se quitará esta producción de la lista y se devolverán sus insumos al stock, como al anularla. El respaldo conservará el registro.";
  confirmAction("Eliminar producción", message, "Eliminar producción", () => {
    let result;
    try { result = deleteProductionRecord(state.ingredients, state.stockAdjustments, production, new Date().toISOString(), cloudSession?.user?.email || null); }
    catch (error) { return toast(error.message, 6000); }
    state.ingredients = result.ingredients;
    state.stockAdjustments = result.adjustments;
    Object.assign(production, result.production);
    persist("Producción eliminada e inventario actualizado");
  });
}

function openProductionDialog() {
  const modal = dialog(`<h2>Registrar producción</h2><p>Si falta stock registrado, podés indicar que usaste insumos de casa.</p><form><div class="form-grid"><div class="field full"><label>Producto</label><select name="productId">${productionProducts().map((product) => `<option value="${product.id}">${product.kind === "combo" ? "Combo · " : ""}${h(product.name)}</option>`).join("")}</select></div><div class="field"><label>Cantidad de tandas</label><input name="batches" type="number" min="0.01" step="0.01" value="1" required></div><div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}" required></div><div class="field full"><div id="production-preview" class="production-preview"></div></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary" id="save-production">Registrar y descontar</button></div></form>`);
  const form = modal.querySelector("form");
  const preview = form.querySelector("#production-preview");
  const homeValues = () => Object.fromEntries([...preview.querySelectorAll("[data-home-cost]")].map((field) => [field.dataset.homeCost, Number(field.value || 0)]));
  const refreshCost = () => {
    try {
      const result = productionWithHomeSupply(productById(form.elements.productId.value), state.ingredients, Number(form.elements.batches.value || 1), homeValues(), state.products);
      preview.querySelector("#production-cost").textContent = money.format(result.plan.totalCost);
    } catch { /* El formulario nativo señala valores incompletos. */ }
  };
  const updatePreview = () => {
    const product = productById(form.elements.productId.value);
    const plan = productionPlan(product, state.ingredients, Number(form.elements.batches.value || 1), state.products);
    preview.innerHTML = `<div class="cost-preview"><span>Se obtendrá${plan.producedQuantity === 1 ? "" : "n"} <strong>${decimal.format(plan.producedQuantity)}</strong> ${plan.producedQuantity === 1 ? "unidad" : "unidades"}</span><strong id="production-cost">${money.format(plan.totalCost)}</strong></div><div class="requirement-list">${plan.requirements.map((line) => `<div class="requirement ${line.enough ? "enough" : "missing"}"><span>${h(line.name)}</span><span>${decimal.format(line.required)} ${h(line.unit)} / ${decimal.format(line.available)} ${h(line.unit)}</span></div>`).join("")}</div>${plan.canProduce ? "" : `<div class="warning"><strong>Falta stock registrado.</strong> Si usaste insumos de casa, indicá el valor aproximado de lo que faltó. El aporte quedará en el historial, no en Compras.${plan.requirements.filter((line) => !line.enough).map((line) => `<div class="field home-cost-field"><label>Valor de ${decimal.format(line.required - line.available)} ${h(line.unit)} de ${h(line.name)} ($)</label><input data-home-cost="${h(line.ingredientId)}" type="number" min="0" step="0.01" value="${((line.required - line.available) * Number(ingredientById(line.ingredientId)?.averageCost || 0)).toFixed(2)}"><small>Si no conocés el valor, dejá cero y el costo se marcará como parcial.</small></div>`).join("")}</div>`}`;
    form.querySelector("#save-production").textContent = plan.canProduce ? "Registrar y descontar" : "Registrar con insumos de casa";
    preview.querySelectorAll("[data-home-cost]").forEach((field) => field.addEventListener("input", refreshCost));
    refreshCost();
  };
  form.elements.productId.addEventListener("change", updatePreview);
  form.elements.batches.addEventListener("input", updatePreview);
  updatePreview();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const product = productById(form.elements.productId.value);
    let result;
    try { result = productionWithHomeSupply(product, state.ingredients, Number(form.elements.batches.value), homeValues(), state.products); }
    catch (error) { return toast(error.message); }
    const productionId = uid("prod");
    result.ingredients.forEach((updated) => {
      const ingredient = ingredientById(updated.id);
      ingredient.stock = updated.stock;
      ingredient.averageCost = updated.averageCost;
    });
    result.adjustments.forEach((entry) => state.stockAdjustments.push({ ...entry, id: uid("adj"), ingredientName: ingredientById(entry.ingredientId).name, unit: ingredientById(entry.ingredientId).baseUnit, reason: "production", note: `Producción de ${product.name}`, date: form.elements.date.value, createdAt: new Date().toISOString(), actorEmail: cloudSession?.user?.email || null, sourceProductionId: productionId }));
    result.plan.requirements.forEach((line) => { ingredientById(line.ingredientId).stock -= line.required; });
    const optionalCostsSnapshot = Object.entries(productDefinition(product, state.products).optionalCosts || {}).map(([key, value]) => ({ label: optionalLabels[key] || key, totalCost: Number(value || 0) * result.plan.batches })).filter((line) => line.totalCost > 0);
    state.productions.push({ id: productionId, productId: product.id, productNameSnapshot: product.name, date: form.elements.date.value, batches: result.plan.batches, producedQuantity: result.plan.producedQuantity, totalCostSnapshot: result.plan.totalCost, unitCostSnapshot: result.plan.unitCost, costUnestimated: result.costUnestimated, requirementsSnapshot: result.plan.requirements, optionalCostsSnapshot });
    modal.close();
    persist("Producción registrada e insumos descontados");
  });
}

function renderClients() {
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, "es"));
  app.innerHTML = pageHeading("Clientes", "Guardá sus datos una vez y reutilizalos en nuevos pedidos.", `<button class="primary" id="new-client">Nuevo cliente</button>`) + `
    <div class="client-grid">${clients.length ? clients.map((client) => {
      const clientOrders = state.orders.filter((order) => !order.deletedAt && order.clientId === client.id);
      return `<article class="card client-card"><div class="card-title-row"><div class="client-avatar">${h(client.name.slice(0, 1).toUpperCase())}</div><div class="row-actions"><button class="ghost compact-button" data-edit-client="${client.id}">Editar</button><button class="danger compact-button" data-delete-client="${client.id}">Eliminar</button></div></div><h2>${h(client.name)}</h2>${client.phone ? `<a href="tel:${h(client.phone)}">${h(client.phone)}</a>` : `<span class="muted">Sin teléfono</span>`}${client.instagram ? `<p>${h(client.instagram)}</p>` : ""}<small class="muted">${clientOrders.length} pedido${clientOrders.length === 1 ? "" : "s"} registrado${clientOrders.length === 1 ? "" : "s"}</small></article>`;
    }).join("") : `<article class="card" style="grid-column:1/-1">${empty("Todavía no hay clientes guardados.")}</article>`}</div>`;
  app.querySelector("#new-client")?.addEventListener("click", () => openClientDialog());
  app.querySelectorAll("[data-edit-client]").forEach((button) => button.addEventListener("click", () => openClientDialog(clientById(button.dataset.editClient))));
  app.querySelectorAll("[data-delete-client]").forEach((button) => button.addEventListener("click", () => deleteClient(button.dataset.deleteClient)));
}

function deleteClient(clientId) {
  const client = clientById(clientId);
  if (!client) return;
  confirmAction("Eliminar cliente", `Se eliminará «${h(client.name)}» del fichero. Sus pedidos conservarán el nombre y el teléfono anotados, pero dejarán de estar vinculados a este cliente.`, "Eliminar cliente", () => {
    state.orders.filter((order) => order.clientId === clientId).forEach((order) => { order.clientId = null; });
    state.clients = state.clients.filter((item) => item.id !== clientId);
    persist("Cliente eliminado; pedidos conservados");
  });
}

function openClientDialog(existing = null) {
  const modal = dialog(`<h2>${existing ? "Editar cliente" : "Nuevo cliente"}</h2><p>El teléfono, Instagram y las notas son opcionales.</p><form><div class="form-grid"><div class="field full"><label>Nombre</label><input name="name" required value="${h(existing?.name || "")}" placeholder="Nombre del cliente"></div><div class="field"><label>Teléfono</label><input name="phone" value="${h(existing?.phone || "")}" placeholder="099 000 000"></div><div class="field"><label>Instagram</label><input name="instagram" value="${h(existing?.instagram || "")}" placeholder="@usuario"></div><div class="field full"><label>Notas</label><input name="notes" value="${h(existing?.notes || "")}" placeholder="Preferencias o indicaciones útiles"></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar cliente</button></div></form>`);
  const form = modal.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = { name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), instagram: form.elements.instagram.value.trim(), notes: form.elements.notes.value.trim() };
    if (existing) Object.assign(existing, values);
    else state.clients.push({ id: uid("cli"), createdAt: new Date().toISOString(), ...values });
    modal.close();
    persist(existing ? "Cliente actualizado" : "Cliente creado");
  });
}

function renderAgenda() {
  const active = state.orders.filter((order) => !order.deletedAt && !["entregado", "cancelado"].includes(order.status)).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const grouped = active.reduce((days, order) => {
    (days[order.deliveryDate] ??= []).push(order);
    return days;
  }, {});
  app.innerHTML = pageHeading("Agenda de entregas", "Pedidos activos organizados por fecha.", `<button class="primary" id="agenda-new-order" ${activeSellables().length ? "" : "disabled"}>Nuevo pedido</button>`) + `
    ${active.length ? `<div class="agenda">${Object.entries(grouped).map(([date, orders]) => `<section class="agenda-day"><header><span>${new Intl.DateTimeFormat("es-UY", { weekday: "long" }).format(new Date(`${date}T12:00:00`))}</span><strong>${new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00`))}</strong></header><div>${orders.map((order) => `<article class="agenda-order"><div><span class="status status-${order.status}">${statusLabels[order.status]}</span><h3>${h(order.customerName)}</h3><p>${h(productById(order.productId)?.name || "Producto eliminado")} · ${decimal.format(order.quantity)}</p></div><div class="agenda-balance"><small>Saldo</small><strong>${money.format(Math.max(order.totalPrice - order.deposit, 0))}</strong></div></article>`).join("")}</div></section>`).join("")}</div>` : `<article class="card">${empty("No hay entregas pendientes en la agenda.")}</article>`}`;
  app.querySelector("#agenda-new-order")?.addEventListener("click", () => openOrderDialog());
}

function renderOrders() {
  const activeOrders = state.orders.filter((order) => !order.deletedAt);
  const { items: orders, total, page, pageCount } = pagedOrders(state.orders, orderFilters);
  orderFilters.page = page;
  app.innerHTML = pageHeading("Pedidos", "Organizá encargos, señas, saldos y fechas de entrega.", `<button class="primary" id="new-order" ${activeSellables().length ? "" : "disabled"}>Nuevo pedido</button>`) + `
    ${!activeSellables().length ? `<p class="warning">Antes de tomar un pedido necesitás crear al menos un producto.</p>` : ""}
    <div class="filter-bar"><div class="field"><label for="order-client-filter">Cliente</label><select id="order-client-filter"><option value="">Todos los clientes</option>${customerOptions([...state.clients.map((client) => client.name), ...activeOrders.map((order) => order.customerName)], orderFilters.client)}</select></div><div class="field"><label for="order-status-filter">Estado</label><select id="order-status-filter"><option value="">Todos los estados</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${orderFilters.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div>
    ${orders.length ? `<div class="order-grid">${orders.map((order) => {
      const product = productById(order.productId);
      const balance = Math.max(order.totalPrice - order.deposit, 0);
      return `<article class="card order-card"><div class="order-card-head"><div><span class="status status-${order.status}">${statusLabels[order.status]}</span><h2>${h(order.customerName)}</h2><p>${h(product?.name || "Producto eliminado")} · ${decimal.format(order.quantity)} unidad${order.quantity === 1 ? "" : "es"}</p></div><time>${order.deliveryDate}</time></div><div class="order-finance"><div><small>Total</small><strong>${money.format(order.totalPrice)}</strong></div><div><small>Seña</small><strong>${money.format(order.deposit)}</strong></div><div><small>Saldo</small><strong>${money.format(balance)}</strong></div></div>${order.notes ? `<p class="order-notes">${h(order.notes)}</p>` : ""}<div class="order-actions"><label>Estado <select data-order-status="${order.id}" ${order.status === "entregado" ? "disabled" : ""}>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>${!["entregado", "cancelado"].includes(order.status) ? `<button class="ghost" data-edit-order="${order.id}">Editar</button>` : ""}<button class="danger" data-delete-order="${order.id}">Eliminar</button></div>${order.saleId ? `<small class="sale-linked">✓ Venta registrada</small>` : ""}</article>`;
    }).join("")}</div>` : `<article class="card">${empty(activeOrders.length ? "No hay pedidos con estos filtros." : "Todavía no hay pedidos. Creá el primero para organizar la próxima entrega.")}</article>`}
    <nav class="pagination" aria-label="Páginas de pedidos"><span>${total} pedido${total === 1 ? "" : "s"} · Página ${page} de ${pageCount}</span><div class="row-actions"><button class="ghost" id="previous-orders" ${page === 1 ? "disabled" : ""}>Anterior</button><button class="ghost" id="next-orders" ${page === pageCount ? "disabled" : ""}>Siguiente</button></div></nav>`;
  app.querySelector("#new-order")?.addEventListener("click", () => openOrderDialog());
  app.querySelector("#order-client-filter").addEventListener("change", (event) => { orderFilters.client = event.target.value; orderFilters.page = 1; renderOrders(); });
  app.querySelector("#order-status-filter").addEventListener("change", (event) => { orderFilters.status = event.target.value; orderFilters.page = 1; renderOrders(); });
  app.querySelector("#previous-orders").addEventListener("click", () => { orderFilters.page -= 1; renderOrders(); });
  app.querySelector("#next-orders").addEventListener("click", () => { orderFilters.page += 1; renderOrders(); });
  app.querySelectorAll("[data-edit-order]").forEach((button) => button.addEventListener("click", () => openOrderDialog(state.orders.find((order) => order.id === button.dataset.editOrder))));
  app.querySelectorAll("[data-delete-order]").forEach((button) => button.addEventListener("click", () => deleteOrder(button.dataset.deleteOrder)));
  app.querySelectorAll("[data-order-status]").forEach((select) => select.addEventListener("change", () => updateOrderStatus(select.dataset.orderStatus, select.value)));
}

function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId && !item.deletedAt);
  if (!order) return;
  const saleWarning = order.saleId ? " La venta ya registrada permanecerá en los informes." : "";
  confirmAction("Eliminar pedido", `Se quitará el pedido de ${h(order.customerName)} de la lista y la agenda. No aparecerá como cancelado.${saleWarning}`, "Eliminar pedido", () => {
    order.deletedAt = new Date().toISOString();
    order.deletedBy = cloudSession?.user?.email || null;
    persist("Pedido eliminado");
  });
}

function openOrderDialog(existing = null) {
  const orderProducts = [...activeSellables()];
  const existingProduct = productById(existing?.productId);
  if (existingProduct && !orderProducts.some((product) => product.id === existingProduct.id)) orderProducts.push(existingProduct);
  const selectedProduct = productById(existing?.productId) || activeSellables()[0];
  const modal = dialog(`<h2>${existing ? "Editar pedido" : "Nuevo pedido"}</h2><p>Registrá lo necesario para preparar y cobrar el encargo.</p><form><div class="form-grid">${state.clients.length ? `<div class="field full"><label>Cliente guardado (opcional)</label><select name="clientId"><option value="">Ingresar manualmente</option>${state.clients.map((client) => `<option value="${client.id}" ${existing?.clientId === client.id ? "selected" : ""}>${h(client.name)}</option>`).join("")}</select></div>` : ""}<div class="field"><label>Cliente</label><input name="customerName" required value="${h(existing?.customerName || "")}" placeholder="Nombre del cliente"></div><div class="field"><label>Teléfono (opcional)</label><input name="phone" value="${h(existing?.phone || "")}" placeholder="099 000 000"></div><div class="field full"><label>Producto</label><select name="productId">${orderProducts.map((product) => `<option value="${product.id}" ${product.id === selectedProduct.id ? "selected" : ""}>${product.kind === "combo" ? "Combo · " : ""}${h(product.name)}</option>`).join("")}</select></div><div class="field"><label>Cantidad</label><input name="quantity" type="number" min="0.01" step="0.01" value="${existing?.quantity || 1}" required></div><div class="field"><label>Entrega</label><input name="deliveryDate" type="date" value="${existing?.deliveryDate || today()}" required></div><div class="field"><label>Total acordado ($)</label><input name="totalPrice" type="number" min="0" step="0.01" value="${existing?.totalPrice ?? selectedProduct.salePrice}" required></div><div class="field"><label>Seña recibida ($)</label><input name="deposit" type="number" min="0" step="0.01" value="${existing?.deposit || 0}"></div><div class="field full"><label>Notas (opcional)</label><input name="notes" value="${h(existing?.notes || "")}" placeholder="Decoración, horario, dedicatoria..."></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">${existing ? "Guardar cambios" : "Crear pedido"}</button></div></form>`);
  const form = modal.querySelector("form");
  let automaticPrice = !existing;
  const suggestTotal = () => {
    if (!automaticPrice) return;
    const product = productById(form.elements.productId.value);
    form.elements.totalPrice.value = Number(product.salePrice) * Number(form.elements.quantity.value || 1);
  };
  form.elements.productId.addEventListener("change", suggestTotal);
  form.elements.quantity.addEventListener("input", suggestTotal);
  form.elements.totalPrice.addEventListener("input", () => { automaticPrice = false; });
  if (form.elements.clientId) form.elements.clientId.addEventListener("change", () => {
    const client = clientById(form.elements.clientId.value);
    if (client) { form.elements.customerName.value = client.name; form.elements.phone.value = client.phone; }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = { clientId: data.get("clientId") || null, customerName: data.get("customerName").trim(), phone: data.get("phone").trim(), productId: data.get("productId"), quantity: Number(data.get("quantity")), deliveryDate: data.get("deliveryDate"), totalPrice: Number(data.get("totalPrice")), deposit: Number(data.get("deposit") || 0), notes: data.get("notes").trim() };
    if (productById(values.productId)?.deletedAt && !["entregado", "cancelado"].includes(existing?.status)) return toast("La receta fue eliminada. Elegí otra receta.", 6000);
    if (values.deposit > values.totalPrice) return toast("La seña no puede superar el total");
    if (existing) Object.assign(existing, values);
    else state.orders.push({ id: uid("ord"), status: "pendiente", saleId: null, createdAt: today(), ...values });
    modal.close();
    persist(existing ? "Pedido actualizado" : "Pedido creado");
  });
}

function updateOrderStatus(orderId, status) {
  const order = state.orders.find((item) => item.id === orderId);
  if (productById(order.productId)?.deletedAt && !["entregado", "cancelado"].includes(status)) return toast("La receta fue eliminada. Creá una receta nueva antes de reactivar el pedido.", 6000);
  if (status === "entregado" && !order.saleId) {
    const product = productById(order.productId);
    let sale;
    try { sale = saleFromOrder(order, product, state.ingredients, today(), uid("sale"), state.products); }
    catch (error) { return toast(error.message, 6000); }
    order.status = status;
    state.sales.push(sale);
    order.saleId = sale.id;
    order.deliveredAt = today();
    persist("Pedido entregado y venta registrada");
    return;
  }
  order.status = status;
  persist("Estado del pedido actualizado");
}

function renderSales() {
  const sales = [...state.sales].sort((a, b) => b.date.localeCompare(a.date));
  app.innerHTML = pageHeading("Ventas", "Cada venta conserva el costo que tenía la receta ese día.", `<button class="primary" id="new-sale" ${activeSellables().length ? "" : "disabled"}>Registrar venta</button>`) + `
    ${!activeSellables().length ? `<p class="warning">Antes de vender necesitás crear un producto.</p>` : ""}
    <article class="card">${sales.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Ingresos</th><th>Ganancia bruta</th></tr></thead><tbody>${sales.map((sale) => `<tr><td>${sale.date}</td><td><strong>${h(productById(sale.productId)?.name || "Producto eliminado")}</strong></td><td>${decimal.format(sale.quantity)}</td><td>${money.format(sale.quantity * sale.unitPrice)}</td><td>${money.format(sale.quantity * (sale.unitPrice - sale.unitCostSnapshot))}</td></tr>`).join("")}</tbody></table></div>` : empty("Las ventas por encargo aparecerán aquí.")}</article>`;
  app.querySelector("#new-sale")?.addEventListener("click", openSaleDialog);
}

function openSaleDialog() {
  const modal = dialog(`<h2>Registrar venta</h2><p>Podés cambiar el precio para este encargo sin modificar el producto. El cliente es opcional.</p><form><div class="form-grid">${state.clients.length ? `<div class="field full"><label>Cliente guardado (opcional)</label><select name="clientId"><option value="">Ingresar manualmente</option>${state.clients.map((client) => `<option value="${client.id}">${h(client.name)}</option>`).join("")}</select></div>` : ""}<div class="field full"><label>Nombre del cliente (opcional)</label><input name="customerName" placeholder="Ej. Lucía"></div><div class="field full"><label>Producto</label><select name="productId">${activeSellables().map((product) => `<option value="${product.id}">${product.kind === "combo" ? "Combo · " : ""}${h(product.name)}</option>`).join("")}</select></div><div class="field"><label>Cantidad</label><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></div><div class="field"><label>Precio por unidad ($)</label><input name="unitPrice" type="number" min="0" step="0.01" required></div><div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}" required></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar venta</button></div></form>`);
  const form = modal.querySelector("form");
  const setPrice = () => { form.elements.unitPrice.value = productById(form.elements.productId.value).salePrice; };
  form.elements.productId.addEventListener("change", setPrice);
  if (form.elements.clientId) form.elements.clientId.addEventListener("change", () => {
    form.elements.customerName.value = clientById(form.elements.clientId.value)?.name || "";
  });
  setPrice();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const product = productById(data.get("productId"));
    let cost;
    try { cost = recipeCost(product, state.ingredients, state.products).unitCost; }
    catch (error) { return toast(error.message, 6000); }
    const customerName = String(data.get("customerName") || "").trim();
    const selectedClient = clientById(data.get("clientId"));
    state.sales.push({ id: uid("sale"), productId: product.id, quantity: Number(data.get("quantity")), unitPrice: Number(data.get("unitPrice")), unitCostSnapshot: cost, date: data.get("date"), customerName, clientId: selectedClient && customerKey(selectedClient.name) === customerKey(customerName) ? selectedClient.id : null });
    modal.close();
    persist("Venta registrada");
  });
}

function renderReports() {
  const month = app.dataset.reportMonth || currentMonth();
  const sales = state.sales.filter((sale) => sale.date.startsWith(month) && (!reportClientFilter || (reportClientFilter === "__no_client__" ? !saleCustomerName(sale) : customerKey(saleCustomerName(sale)) === reportClientFilter)));
  const summary = monthlySummary(sales, month);
  const productRows = state.products.map((product) => {
    const productSales = sales.filter((sale) => sale.productId === product.id);
    const units = productSales.reduce((total, sale) => total + sale.quantity, 0);
    const revenue = productSales.reduce((total, sale) => total + sale.quantity * sale.unitPrice, 0);
    const profit = productSales.reduce((total, sale) => total + sale.quantity * (sale.unitPrice - sale.unitCostSnapshot), 0);
    return { product, units, revenue, profit };
  }).filter((row) => row.units > 0).sort((a, b) => b.revenue - a.revenue);
  const sortedSales = [...sales].sort((a, b) => b.date.localeCompare(a.date));
  app.innerHTML = pageHeading("Informes", "Descargá reportes individuales o consultá el resumen mensual de ventas.") + `
    <article class="card report-download">
      <h3>Descargar reporte en PDF</h3>
      <p>Elegí ventas, compras de insumos o clientes registrados. Cada descarga contiene únicamente el reporte seleccionado.</p>
      <form id="individual-report-form">
        <div class="filter-bar">
          <div class="field"><label for="pdf-report-type">Reporte</label><select id="pdf-report-type" name="type"><option value="sales">Ventas</option><option value="purchases">Compras de insumos</option><option value="clients">Clientes registrados</option></select></div>
          <div class="field"><label for="pdf-report-mode">Período</label><select id="pdf-report-mode" name="mode"><option value="month">Mes específico</option><option value="range">Rango de fechas</option><option value="all">Todos los períodos</option></select></div>
          <div class="field" data-pdf-month><label for="pdf-report-month">Mes del reporte PDF</label><input id="pdf-report-month" name="month" type="month" required value="${h(pdfReportFilters.month)}"></div>
          <div class="field" data-pdf-range><label for="pdf-report-from">Desde (inclusive)</label><input id="pdf-report-from" name="from" type="date" required value="${h(pdfReportFilters.from)}"></div>
          <div class="field" data-pdf-range><label for="pdf-report-to">Hasta (inclusive)</label><input id="pdf-report-to" name="to" type="date" required value="${h(pdfReportFilters.to)}"></div>
        </div>
        <p id="individual-report-note" class="muted"></p>
        <button class="primary" type="submit">Descargar reporte PDF</button>
        <p id="individual-report-status" class="muted" role="status" aria-live="polite"></p>
      </form>
    </article>
    <h2>Resumen mensual de ventas</h2><p>Los filtros de esta consulta en pantalla son independientes del reporte PDF.</p>
    <div class="filter-bar"><div class="field"><label for="report-month">Mes</label><input id="report-month" type="month" value="${h(month)}"></div><div class="field"><label for="report-client-filter">Cliente</label><select id="report-client-filter"><option value="">Todos los clientes</option>${customerOptions([...state.clients.map((client) => client.name), ...state.sales.map(saleCustomerName)], reportClientFilter)}<option value="__no_client__" ${reportClientFilter === "__no_client__" ? "selected" : ""}>Sin cliente</option></select></div></div>
    <div class="stats"><article class="stat"><small>Encargos</small><strong>${summary.orders}</strong></article><article class="stat"><small>Ingresos</small><strong>${money.format(summary.revenue)}</strong></article><article class="stat"><small>Costos</small><strong>${money.format(summary.cost)}</strong></article><article class="stat"><small>Ganancia bruta</small><strong class="positive">${money.format(summary.profit)}</strong></article></div>
    <article class="card"><h3>Resultados por producto</h3>${productRows.length ? `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos</th><th>Ganancia</th></tr></thead><tbody>${productRows.map((row) => `<tr><td><strong>${h(row.product.name)}</strong></td><td>${decimal.format(row.units)}</td><td>${money.format(row.revenue)}</td><td>${money.format(row.profit)}</td></tr>`).join("")}</tbody></table></div>` : empty("No hay ventas con estos filtros.")}</article>
    <article class="card stock-history"><h3>Ventas del período</h3>${sortedSales.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Ingresos</th><th>Ganancia</th></tr></thead><tbody>${sortedSales.map((sale) => `<tr><td>${h(sale.date)}</td><td>${h(saleCustomerName(sale) || "Sin cliente")}</td><td>${h(productById(sale.productId)?.name || "Producto eliminado")}</td><td>${money.format(sale.quantity * sale.unitPrice)}</td><td>${money.format(sale.quantity * (sale.unitPrice - sale.unitCostSnapshot))}</td></tr>`).join("")}</tbody></table></div>` : empty("No hay ventas con estos filtros.")}</article>`;
  app.querySelector("#report-month").addEventListener("change", (event) => { app.dataset.reportMonth = event.target.value; renderReports(); });
  app.querySelector("#report-client-filter").addEventListener("change", (event) => { reportClientFilter = event.target.value; renderReports(); });
  const form = app.querySelector("#individual-report-form");
  form.elements.type.value = pdfReportFilters.type;
  form.elements.mode.value = pdfReportFilters.mode;
  const updatePdfFilters = () => {
    for (const key of Object.keys(pdfReportFilters)) pdfReportFilters[key] = form.elements[key].value;
    for (const container of form.querySelectorAll("[data-pdf-month], [data-pdf-range]")) {
      const visible = container.hasAttribute("data-pdf-month") ? pdfReportFilters.mode === "month" : pdfReportFilters.mode === "range";
      container.hidden = !visible;
      container.querySelector("input").disabled = !visible;
    }
    form.elements.to.min = form.elements.from.value;
    form.querySelector("#individual-report-note").textContent = pdfReportFilters.type === "clients"
      ? "El período se aplica a la fecha de registro del cliente (Uruguay). Los clientes anteriores sin fecha registrada solo se incluyen al elegir Todos los períodos."
      : "Se incluyen todos los clientes. Los totales excluyen registros eliminados y anulados. Las fechas de inicio y fin están incluidas.";
    form.querySelector("#individual-report-status").textContent = "";
  };
  form.addEventListener("change", (event) => {
    if (event.target === form.elements.type && form.elements.type.value === "clients") form.elements.mode.value = "all";
    updatePdfFilters();
  });
  updatePdfFilters();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const status = form.querySelector("#individual-report-status");
    button.disabled = true;
    button.textContent = "Generando PDF…";
    status.textContent = "Preparando el reporte…";
    const filters = { ...pdfReportFilters };
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await exportIndividualPdf(state, { ...filters, businessName: cloudAccount?.businessName || "Dulce Gestión", exportedBy: cloudSession?.user?.email, pendingChanges: Boolean(cloudAccount?.businessId && readCloudDraft(cloudAccount.businessId)) });
      status.textContent = `PDF generado: ${result.pages} ${result.pages === 1 ? "página" : "páginas"}. Revisá tus descargas.`;
      toast("Reporte PDF descargado");
    } catch (error) {
      status.textContent = `No se pudo generar el PDF. ${error.message}`;
    } finally { button.disabled = false; button.textContent = "Descargar reporte PDF"; }
  });
}

function renderData() {
  const summary = backupSummary(state);
  const restoringDisabled = cloudAccount && (cloudWriteBlocked || !["active", "grace"].includes(cloudAccount.status));
  app.innerHTML = pageHeading("Datos y respaldos", "Descargá una copia o restaurá información desde un archivo válido.") + `
    <div class="backup-grid">
      <article class="card backup-card"><div class="backup-icon">↓</div><div><h2>Crear respaldo</h2><p>Descarga los insumos, el historial de ajustes, las recetas y combos, compras, clientes, pedidos, producciones y ventas en un único archivo JSON.</p></div><button class="primary" id="download-backup">Descargar respaldo</button></article>
      <article class="card backup-card"><div class="backup-icon">PDF</div><div><h2>Informe completo en PDF</h2><p>Exportá clientes, insumos, recetas, combos, compras, ajustes, pedidos, producciones y ventas en tablas, con totales e historial. Para restaurar datos necesitás el respaldo JSON.</p></div><button class="primary" id="download-pdf">Descargar PDF</button><p id="pdf-status" class="muted" role="status" aria-live="polite"></p></article>
      <article class="card backup-card"><div class="backup-icon">↑</div><div><h2>Restaurar respaldo</h2><p>El archivo se revisará antes de reemplazar los datos actuales. También se aceptan respaldos de la versión anterior.</p></div><button class="secondary" id="choose-backup" ${restoringDisabled ? "disabled" : ""}>Elegir archivo</button><input id="backup-file" type="file" accept="application/json,.json" hidden></article>
    </div>
    <article class="card data-summary"><h3>${cloudAccount ? "Datos del negocio" : "Contenido actual de este dispositivo"}</h3><div>${Object.entries({ Insumos: summary.ingredients, Ajustes: summary.stockAdjustments, Compras: summary.purchases, "Productos y combos": summary.products, Producciones: summary.productions, Clientes: summary.clients, Pedidos: summary.orders, Ventas: summary.sales }).map(([label, value]) => `<span><strong>${value}</strong><small>${label}</small></span>`).join("")}</div><p class="warning"><strong>Importante:</strong> ${cloudAccount ? cloudWriteBlocked ? "Hay cambios pendientes de sincronización. Descargá un respaldo del borrador." : "Descargá respaldos periódicos además de la sincronización." : "La información vive solamente en este navegador. Descargá respaldos con frecuencia."}</p></article>`;
  app.querySelector("#download-backup").addEventListener("click", () => { exportState(state); toast("Respaldo descargado"); });
  app.querySelector("#download-pdf").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = app.querySelector("#pdf-status");
    button.disabled = true;
    button.textContent = "Generando PDF…";
    status.textContent = "Preparando el informe. Los informes grandes pueden demorar unos segundos.";
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await exportBusinessPdf(state, {
        businessName: cloudAccount?.businessName || "Dulce Gestión",
        exportedBy: cloudSession?.user?.email,
        pendingChanges: Boolean(cloudAccount?.businessId && readCloudDraft(cloudAccount.businessId)),
      });
      status.textContent = "PDF generado: " + result.pages + " páginas. Revisá tus descargas.";
      toast("Informe PDF descargado");
    } catch (error) {
      status.textContent = "No se pudo generar el PDF. " + error.message;
      toast("No se pudo generar el informe PDF", 6000);
    } finally { button.disabled = false; button.textContent = "Descargar PDF"; }
  });
  const fileInput = app.querySelector("#backup-file");
  app.querySelector("#choose-backup").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("El archivo supera el límite de 5 MB"); fileInput.value = ""; return; }
    try {
      const backup = parseBackup(await file.text());
      const incoming = backupSummary(backup.data);
      const detail = `${incoming.ingredients} insumos, ${incoming.stockAdjustments} ajustes de stock, ${incoming.products} productos y combos, ${incoming.clients} clientes, ${incoming.orders} pedidos y ${incoming.sales} ventas`;
      confirmAction("Restaurar respaldo", `Se reemplazarán los datos de este navegador por: ${detail}. Esta acción no se puede deshacer sin un respaldo de la información actual.`, "Restaurar datos", () => {
        state = backup.data;
        persist(backup.legacy ? "Respaldo anterior restaurado" : "Respaldo restaurado");
      });
    } catch (error) {
      toast(error.message);
    } finally {
      fileInput.value = "";
    }
  });
}

function renderAccount() {
  if (!isCloudConfigured()) {
    app.innerHTML = pageHeading("Cuenta", "La aplicación está funcionando en modo local.") + `<article class="card account-state"><span class="status">Modo local</span><h2>Proyecto Supabase preparado</h2><p>La conexión con el proyecto nuevo se activará después de aplicar y verificar el esquema de base de datos.</p><p class="muted">Mientras tanto, podés seguir trabajando y descargar un respaldo desde Datos y respaldos.</p></article>`;
    return;
  }
  if (!cloudSession) {
    app.innerHTML = pageHeading("Ingresar", "Accedé a los datos de tu emprendimiento.") + `<article class="card login-card"><form id="login-form"><div class="field"><label>Correo electrónico</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div><button class="primary">Ingresar</button><p id="login-error" class="form-error">${h(cloudLoginError)}</p></form></article>`;
    app.querySelector("#login-form").addEventListener("submit", handleLogin);
    return;
  }
  const label = subscriptionLabels[cloudAccount?.status] || "Sin estado";
  app.innerHTML = pageHeading("Cuenta", "Estado del servicio y sincronización.") + `<article class="card account-state"><span class="status subscription-${cloudAccount?.status}">${label}</span><h2>${h(cloudAccount?.businessName || "Negocio")}</h2><p>${h(cloudSession.user.email)}</p>${cloudAccount?.status === "grace" && cloudAccount.graceUntil ? `<p class="warning">Período de gracia hasta ${new Intl.DateTimeFormat("es-UY", { dateStyle: "long" }).format(new Date(cloudAccount.graceUntil))}.</p>` : ""}${cloudAccount?.status === "read_only" ? `<p class="warning">Podés consultar y exportar los datos, pero no realizar cambios.</p>` : ""}${cloudAccount?.status === "suspended" ? `<p class="warning">El acceso a los datos está suspendido.</p>` : cloudWriteBlocked ? `<p class="warning">Hay un borrador pendiente de sincronización. Descargalo o reintentá desde cualquier sección.</p>` : `<p class="positive-text">Los cambios de este dispositivo se sincronizan automáticamente.</p>`}<div class="hero-actions"><button class="secondary" id="sync-now" ${cloudAccount?.status === "suspended" || cloudWriteBlocked ? "disabled" : ""}>Actualizar desde la nube</button>${cloudWriteBlocked ? `<button class="secondary" id="review-draft">Revisar borrador</button>` : ""}<button class="ghost" id="sign-out">Cerrar sesión</button></div></article>`;
  app.querySelector("#sign-out").addEventListener("click", handleSignOut);
  app.querySelector("#sync-now")?.addEventListener("click", syncFromCloud);
  app.querySelector("#review-draft")?.addEventListener("click", renderSyncProblem);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = form.querySelector("#login-error");
  errorBox.textContent = "";
  form.querySelector("button").disabled = true;
  try {
    cloudSession = await signIn(form.elements.email.value, form.elements.password.value);
    await loadCloudAccountAndData();
    cloudLoginError = "";
    location.hash = "inicio";
    render();
  } catch (error) {
    if (cloudSession) await signOut().catch(() => {});
    cloudSession = null;
    cloudAccount = null;
    errorBox.textContent = error.message;
  } finally {
    form.querySelector("button").disabled = false;
  }
}

async function handleSignOut() {
  await cloudSaveQueue;
  await signOut();
  cloudSession = null;
  cloudAccount = null;
  state = structuredClone(emptyState);
  confirmedCloudState = structuredClone(emptyState);
  cloudRevision = 0;
  cloudWriteBlocked = false;
  cloudSyncError = "";
  cloudLoginError = "";
  location.hash = "cuenta";
  render();
}

async function syncFromCloud() {
  try {
    await cloudSaveQueue;
    if (readCloudDraft(cloudAccount.businessId)) throw new Error("Hay un borrador pendiente. Descargalo o reintentá su envío antes de actualizar.");
    cloudAccount = await getCloudAccount();
    const remote = await pullCloudState(cloudAccount.businessId);
    state = normalizeState(remote?.data ?? emptyState);
    confirmedCloudState = structuredClone(state);
    cloudRevision = Number(remote?.revision || 0);
    toast("Datos actualizados desde la nube");
    renderAccount();
  } catch (error) {
    toast(error.message);
  }
}

async function loadCloudAccountAndData() {
  cloudAccount = await getCloudAccount();
  if (cloudAccount.status === "suspended") {
    state = structuredClone(emptyState);
    return;
  }
  const remote = await pullCloudState(cloudAccount.businessId);
  cloudRevision = Number(remote?.revision || 0);
  confirmedCloudState = normalizeState(remote?.data ?? emptyState);
  const draft = readCloudDraft(cloudAccount.businessId);
  if (draft) {
    state = normalizeState(draft.data);
    cloudWriteBlocked = true;
    cloudSyncError = Number(draft.baseRevision) === cloudRevision
      ? "Hay un borrador pendiente de una sesión anterior. Podés reintentar el envío."
      : "Los datos cambiaron en otro dispositivo. Descargá el borrador antes de decidir qué versión conservar.";
  } else {
    state = structuredClone(confirmedCloudState);
  }
}

async function retryCloudDraft() {
  if (!cloudAccount || !["active", "grace"].includes(cloudAccount.status)) return toast("La cuenta no permite guardar cambios.");
  const draft = readCloudDraft(cloudAccount.businessId);
  if (!draft) return toast("No hay borrador pendiente.");
  try {
    const remote = await pullCloudState(cloudAccount.businessId);
    const remoteRevision = Number(remote?.revision || 0);
    if (remoteRevision !== Number(draft.baseRevision)) {
      cloudSyncError = "Los datos cambiaron en otro dispositivo. Descargá el borrador antes de decidir qué versión conservar.";
      renderSyncProblem();
      return;
    }
    cloudRevision = await pushCloudState(cloudAccount.businessId, draft.data, remoteRevision);
    state = normalizeState(draft.data);
    confirmedCloudState = structuredClone(state);
    localStorage.removeItem(cloudDraftKey(cloudAccount.businessId));
    cloudWriteBlocked = false;
    cloudSyncError = "";
    toast("Borrador sincronizado");
    render();
  } catch (error) {
    cloudSyncError = error.message;
    renderSyncProblem();
  }
}

async function discardCloudDraft() {
  try {
    const remote = await pullCloudState(cloudAccount.businessId);
    state = normalizeState(remote?.data ?? emptyState);
    confirmedCloudState = structuredClone(state);
    cloudRevision = Number(remote?.revision || 0);
    localStorage.removeItem(cloudDraftKey(cloudAccount.businessId));
    cloudWriteBlocked = false;
    cloudSyncError = "";
    toast("Datos de la nube cargados");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function initializeApp() {
  if (isCloudConfigured()) {
    try {
      cloudSession = await getSession();
      if (cloudSession) await loadCloudAccountAndData();
    } catch (error) {
      cloudLoginError = error.message;
      cloudSession = null;
      cloudAccount = null;
      state = structuredClone(emptyState);
    }
  }
  cloudLoading = false;
  render();
}

initializeApp();
