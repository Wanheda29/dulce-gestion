import { productDefinition, profitOnCostPercent, recipeCost } from "./domain.js";

export function renderCombos(context) {
  const { app, state, pageHeading, dialog, persist, toast, h, money, decimal, uid, deleteProduct } = context;
  const products = state.products.filter((product) => !product.deletedAt && product.kind !== "combo");
  const combos = state.products.filter((product) => !product.deletedAt && product.kind === "combo");
  const productById = (id) => state.products.find((product) => product.id === id);
  const percentage = (price, cost) => {
    const value = profitOnCostPercent(price, cost);
    return value === null ? "Sin costo definido" : `${decimal.format(value)}%`;
  };

  app.innerHTML = pageHeading("Combos", "Armá packs de productos para ofrecer por redes y conocer su costo actualizado.", `<button class="primary" id="new-combo" ${products.length ? "" : "disabled"}>Nuevo combo</button>`) +
    (!products.length ? `<p class="warning">Creá al menos un producto con receta antes de armar un combo.</p>` : "") +
    `<div class="grid-2">${combos.length ? combos.map((combo) => {
      let cost;
      let error = "";
      try { cost = recipeCost(combo, state.ingredients, state.products); }
      catch (issue) { error = issue.message; }
      return `<article class="card combo-card"><div class="card-title-row"><span class="pill">Combo</span><div class="row-actions"><button class="ghost compact-button" data-edit-combo="${h(combo.id)}">Editar</button><button class="danger compact-button" data-delete-combo="${h(combo.id)}">Eliminar combo</button></div></div><h2>${h(combo.name)}</h2>${combo.description ? `<p class="muted">${h(combo.description)}</p>` : ""}<ul class="combo-items">${(combo.items || []).map((item) => `<li><span>${decimal.format(item.quantity)} × ${h(productById(item.productId)?.name || "Producto no disponible")}</span></li>`).join("")}</ul>${error ? `<p class="warning">${h(error)} Editá el combo para revisarlo.</p>` : `<div class="stats combo-stats"><div><small class="muted">Costo por combo</small><br><strong>${money.format(cost.unitCost)}</strong></div><div><small class="muted">Precio de venta</small><br><strong>${money.format(combo.salePrice)}</strong></div></div><p>Ganancia por combo: <strong>${money.format(Number(combo.salePrice) - cost.unitCost)}</strong></p><p>Ganancia sobre costo: <strong>${percentage(combo.salePrice, cost.unitCost)}</strong></p><small class="muted">Incluye ${money.format(combo.optionalCosts?.packaging || 0)} de empaque adicional.</small><div class="hero-actions"><button class="secondary" data-copy-combo="${h(combo.id)}">Copiar descripción para redes</button></div>`}</article>`;
    }).join("") : `<article class="card" style="grid-column:1/-1"><p class="muted">Todavía no hay combos. Elegí los productos y la cantidad de unidades que llevará cada pack.</p></article>`}</div>`;

  app.querySelector("#new-combo").addEventListener("click", () => openComboDialog());
  app.querySelectorAll("[data-edit-combo]").forEach((button) => button.addEventListener("click", () => openComboDialog(productById(button.dataset.editCombo))));
  app.querySelectorAll("[data-delete-combo]").forEach((button) => button.addEventListener("click", () => deleteProduct(button.dataset.deleteCombo)));
  app.querySelectorAll("[data-copy-combo]").forEach((button) => button.addEventListener("click", async () => {
    const combo = productById(button.dataset.copyCombo);
    const text = [combo.name, combo.description, ...combo.items.map((item) => `${item.quantity} × ${productById(item.productId).name}`), `Precio del combo: ${money.format(combo.salePrice)}`].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Descripción copiada para pegar en tus redes"); }
    catch { toast("No se pudo copiar. Revisá el permiso del navegador.", 5000); }
  }));

  function openComboDialog(existing = null) {
    const modal = dialog(`<h2>${existing ? "Editar combo" : "Nuevo combo"}</h2><p>Indicá cuántas unidades de cada producto incluye un pack. El costo usa las recetas y precios actuales de sus insumos.</p><form id="combo-form"><div class="form-grid"><div class="field full"><label for="combo-name">Nombre del combo</label><input id="combo-name" name="name" value="${h(existing?.name || "")}" placeholder="Ej. Merienda para dos" required></div><div class="field full"><label for="combo-description">Descripción para redes (opcional)</label><textarea id="combo-description" name="description" rows="2">${h(existing?.description || "")}</textarea></div><div class="field full"><label>Productos del pack</label><div id="combo-lines" class="recipe-lines"></div><button type="button" class="ghost" id="add-combo-line" ${products.length ? "" : "disabled"}>+ Agregar producto</button></div><div class="field"><label for="combo-packaging">Empaque adicional por combo ($)</label><input id="combo-packaging" name="packaging" type="number" min="0" step="0.01" value="${existing?.optionalCosts?.packaging ?? 0}"><small class="muted">Solo el empaque del pack. Los gastos de cada producto ya están incluidos.</small></div><div class="field"><label for="combo-price">Precio de venta del combo ($)</label><input id="combo-price" name="salePrice" type="number" min="0" step="0.01" value="${existing?.salePrice ?? ""}" required></div><div class="field full"><div id="combo-preview" class="combo-preview" aria-live="polite"></div></div></div><div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button class="primary">Guardar combo</button></div></form>`);
    const form = modal.querySelector("form");
    const lines = form.querySelector("#combo-lines");
    const preview = form.querySelector("#combo-preview");
    const getDraft = () => ({
      id: existing?.id,
      kind: "combo", yieldQuantity: 1,
      name: form.elements.name.value.trim(), description: form.elements.description.value.trim(),
      salePrice: Number(form.elements.salePrice.value),
      optionalCosts: { packaging: Number(form.elements.packaging.value || 0) },
      items: [...lines.children].map((row) => ({ productId: row.querySelector("select").value, quantity: Number(row.querySelector("input").value) })),
    });
    const updatePreview = () => {
      try {
        const draft = getDraft();
        const costs = recipeCost(draft, state.ingredients, state.products);
        const breakdown = draft.items.map((item) => {
          const product = productById(item.productId);
          return `<li><span>${item.quantity} × ${h(product.name)}</span><strong>${money.format(recipeCost(product, state.ingredients).unitCost * item.quantity)}</strong></li>`;
        }).join("");
        preview.innerHTML = `<ul class="combo-items">${breakdown}<li><span>Empaque adicional</span><strong>${money.format(draft.optionalCosts.packaging)}</strong></li></ul><div class="cost-preview"><span>Costo por combo</span><strong>${money.format(costs.unitCost)}</strong></div><p>Ganancia por combo: <strong>${money.format(draft.salePrice - costs.unitCost)}</strong> · Ganancia sobre costo: <strong>${percentage(draft.salePrice, costs.unitCost)}</strong></p>`;
      } catch (error) { preview.innerHTML = `<p class="warning">${h(error.message)}</p>`; }
    };
    const addLine = (item = null) => {
      const row = document.createElement("div");
      row.className = "combo-line";
      const available = products.some((product) => product.id === item?.productId);
      row.innerHTML = `<div class="field"><select aria-label="Producto del combo" required>${item && !available ? `<option value="${h(item.productId)}">Producto no disponible: elegí otro</option>` : ""}${products.map((product) => `<option value="${h(product.id)}">${h(product.name)}</option>`).join("")}</select></div><div class="field"><input aria-label="Unidades del producto" type="number" min="1" step="1" value="${item?.quantity ?? 1}" required></div><button type="button" class="danger compact-button" aria-label="Quitar producto">×</button>`;
      if (item) row.querySelector("select").value = item.productId;
      row.querySelectorAll("input,select").forEach((field) => field.addEventListener("input", updatePreview));
      row.querySelector("button").addEventListener("click", () => { row.remove(); updatePreview(); });
      lines.append(row);
    };
    form.querySelector("#add-combo-line").addEventListener("click", () => { addLine(); updatePreview(); });
    form.elements.packaging.addEventListener("input", updatePreview);
    form.elements.salePrice.addEventListener("input", updatePreview);
    (existing?.items?.length ? existing.items : products.length ? [null] : []).forEach(addLine);
    updatePreview();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const draft = getDraft();
        if (!draft.name) throw new Error("Ingresá un nombre para el combo.");
        if (!Number.isFinite(draft.salePrice) || draft.salePrice < 0) throw new Error("El precio debe ser mayor o igual a cero.");
        productDefinition(draft, state.products);
        if (existing) Object.assign(existing, draft);
        else state.products.push({ ...draft, id: uid("combo") });
        modal.close();
        persist(existing ? "Combo actualizado" : "Combo creado");
      } catch (error) { toast(error.message, 5000); }
    });
  }
}
