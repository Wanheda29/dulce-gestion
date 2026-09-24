export const unitGroups = {
  g: [
    { value: "g", label: "gramos", factor: 1 },
    { value: "kg", label: "kilogramos", factor: 1000 },
  ],
  ml: [
    { value: "ml", label: "mililitros", factor: 1 },
    { value: "l", label: "litros", factor: 1000 },
  ],
  unidad: [{ value: "unidad", label: "unidades", factor: 1 }],
};

export function toBaseQuantity(quantity, purchaseUnit, baseUnit) {
  const option = unitGroups[baseUnit]?.find((unit) => unit.value === purchaseUnit);
  if (!option) throw new Error("La unidad elegida no es compatible con el insumo.");
  return Number(quantity) * option.factor;
}

export function updateWeightedAverage(currentStock, currentAverage, addedQuantity, totalCost) {
  const stock = Number(currentStock);
  const average = Number(currentAverage);
  const added = Number(addedQuantity);
  const cost = Number(totalCost);
  if (added <= 0 || cost < 0) throw new Error("La cantidad debe ser positiva y el costo no puede ser negativo.");
  const newStock = stock + added;
  return {
    stock: newStock,
    averageCost: newStock === 0 ? 0 : (stock * average + cost) / newStock,
  };
}

export function correctPurchaseInventory(ingredients, previousPurchase, replacement = null) {
  const updated = ingredients.map((ingredient) => ({ ...ingredient }));
  const previousIngredient = updated.find((item) => item.id === previousPurchase.ingredientId);
  if (!previousIngredient) throw new Error("El insumo de la compra ya no existe.");
  const nextIngredient = replacement && updated.find((item) => item.id === replacement.ingredientId);
  if (replacement && !nextIngredient) throw new Error("El nuevo insumo no existe.");
  const adjust = (ingredient, quantityDelta, valueDelta, fallbackAverage) => {
    const oldStock = Number(ingredient.stock);
    const oldAverage = Number(ingredient.averageCost || 0);
    const newStock = oldStock + quantityDelta;
    const newValue = oldStock * oldAverage + valueDelta;
    if (![newStock, newValue].every(Number.isFinite) || newStock < -1e-9) {
      throw new Error("No se puede corregir: parte de esa compra ya se consumió. Revisá el stock antes de modificarla.");
    }
    if (newStock > 1e-9 && newValue < -1e-9) {
      throw new Error("No se puede corregir: el valor actual del stock quedaría negativo. Revisá los costos registrados.");
    }
    ingredient.stock = Math.max(0, newStock);
    ingredient.averageCost = ingredient.stock > 0 ? Math.max(0, newValue / ingredient.stock) : fallbackAverage;
  };
  const oldQuantity = Number(previousPurchase.baseQuantity);
  const oldValue = Number(previousPurchase.totalCost);
  if (!Number.isFinite(oldQuantity) || oldQuantity <= 0 || !Number.isFinite(oldValue) || oldValue < 0) {
    throw new Error("La compra anterior tiene cantidades o costos inválidos.");
  }
  if (replacement) {
    const newQuantity = Number(replacement.baseQuantity);
    const newValue = Number(replacement.totalCost);
    if (!Number.isFinite(newQuantity) || newQuantity <= 0 || !Number.isFinite(newValue) || newValue < 0) {
      throw new Error("La compra corregida necesita cantidad positiva y costo no negativo.");
    }
    if (replacement.ingredientId === previousPurchase.ingredientId) {
      adjust(previousIngredient, newQuantity - oldQuantity, newValue - oldValue, newValue / newQuantity);
    } else {
      adjust(previousIngredient, -oldQuantity, -oldValue, Number(previousIngredient.averageCost || 0));
      const added = updateWeightedAverage(nextIngredient.stock, nextIngredient.averageCost, newQuantity, newValue);
      Object.assign(nextIngredient, added);
    }
  } else {
    adjust(previousIngredient, -oldQuantity, -oldValue, Number(previousIngredient.averageCost || 0));
  }
  return updated;
}

export function countedStock(ingredient, actualStock, addedValue = 0) {
  const previousStock = Number(ingredient.stock);
  const newStock = Number(actualStock);
  const value = Number(addedValue);
  if (![previousStock, newStock, value].every(Number.isFinite) || previousStock < 0 || newStock < 0 || value < 0) {
    throw new Error("La existencia y el valor del aporte deben ser números no negativos.");
  }
  const delta = newStock - previousStock;
  const updated = delta > 0
    ? updateWeightedAverage(previousStock, ingredient.averageCost, delta, value)
    : { stock: newStock, averageCost: Number(ingredient.averageCost || 0) };
  return { ...updated, previousStock, delta, addedValue: delta > 0 ? value : 0 };
}

export function productionWithHomeSupply(product, ingredients, batches = 1, missingValues = {}) {
  const workingIngredients = ingredients.map((ingredient) => ({ ...ingredient }));
  const initialPlan = productionPlan(product, workingIngredients, batches);
  const adjustments = initialPlan.requirements.filter((line) => !line.enough).map((line) => {
    const ingredient = workingIngredients.find((item) => item.id === line.ingredientId);
    if (!ingredient) throw new Error("La receta contiene un insumo que ya no existe.");
    const previousAverageCost = Number(ingredient.averageCost || 0);
    const missing = line.required - line.available;
    const suppliedValue = missingValues[line.ingredientId];
    const addedValue = suppliedValue === undefined
      ? missing * Number(ingredient.averageCost || 0)
      : Number(suppliedValue);
    const counted = countedStock(ingredient, line.required, addedValue);
    ingredient.stock = counted.stock;
    ingredient.averageCost = counted.averageCost;
    return { ingredientId: ingredient.id, previousStock: counted.previousStock, previousAverageCost, newStock: counted.stock, delta: missing, addedValue, unitCost: addedValue / missing, costUnestimated: addedValue === 0 };
  });
  const plan = productionPlan(product, workingIngredients, batches);
  return { ingredients: workingIngredients, adjustments, plan, costUnestimated: adjustments.some((item) => item.costUnestimated) };
}

export function reverseProductionStock(ingredients, requirements, homeAdjustments = []) {
  const restored = ingredients.map((ingredient) => ({ ...ingredient }));
  for (const line of requirements) {
    const ingredient = restored.find((item) => item.id === line.ingredientId);
    if (ingredient) ingredient.stock += Number(line.required);
  }
  for (const entry of homeAdjustments) {
    const ingredient = restored.find((item) => item.id === entry.ingredientId);
    if (!ingredient) continue;
    const remainingStock = ingredient.stock - Number(entry.delta);
    const remainingValue = ingredient.stock * Number(ingredient.averageCost || 0) - Number(entry.addedValue || 0);
    if (remainingStock < 0) throw new Error("No se puede revertir el aporte: el stock resultaría negativo.");
    ingredient.stock = remainingStock;
    ingredient.averageCost = remainingStock > 0 ? Math.max(0, remainingValue / remainingStock) : Number(entry.previousAverageCost || 0);
  }
  return restored;
}

export function recipeCost(product, ingredients) {
  const ingredientCost = (product.recipe ?? []).reduce((total, line) => {
    const ingredient = ingredients.find((item) => item.id === line.ingredientId);
    return total + Number(line.quantity || 0) * Number(ingredient?.averageCost || 0);
  }, 0);
  const optionalCost = Object.values(product.optionalCosts ?? {}).reduce(
    (total, value) => total + Number(value || 0),
    0,
  );
  const batchCost = ingredientCost + optionalCost;
  const yieldQuantity = Math.max(Number(product.yieldQuantity || 1), 1);
  return { ingredientCost, optionalCost, batchCost, unitCost: batchCost / yieldQuantity };
}

export function marginPercent(price, cost) {
  const numericPrice = Number(price);
  if (numericPrice <= 0) return 0;
  return ((numericPrice - Number(cost)) / numericPrice) * 100;
}

export function monthKey(date) {
  return String(date).slice(0, 7);
}

export const customerKey = (name) => String(name || "").trim().toLocaleLowerCase("es");

export function saleCustomerName(sale, orders) {
  return sale.customerName?.trim() || orders.find((order) => order.id === sale.sourceOrderId)?.customerName?.trim() || "";
}

export function pagedOrders(orders, { client = "", status = "", page = 1, pageSize = 8 } = {}) {
  const filtered = orders.filter((order) => !order.deletedAt && (!client || customerKey(order.customerName) === client)
    && (!status || order.status === status)).slice().reverse();
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return { items: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), total: filtered.length, page: currentPage, pageCount };
}

export function monthlySummary(sales, month) {
  return sales
    .filter((sale) => monthKey(sale.date) === month)
    .reduce(
      (summary, sale) => {
        const quantity = Number(sale.quantity);
        const revenue = quantity * Number(sale.unitPrice);
        const cost = quantity * Number(sale.unitCostSnapshot);
        summary.orders += 1;
        summary.units += quantity;
        summary.revenue += revenue;
        summary.cost += cost;
        summary.profit += revenue - cost;
        return summary;
      },
      { orders: 0, units: 0, revenue: 0, cost: 0, profit: 0 },
    );
}

export function saleFromOrder(order, product, ingredients, date, id) {
  if (!order || !product || Number(order.quantity) <= 0) throw new Error("El pedido no se puede convertir en venta.");
  return {
    id,
    productId: product.id,
    quantity: Number(order.quantity),
    unitPrice: Number(order.totalPrice) / Number(order.quantity),
    unitCostSnapshot: recipeCost(product, ingredients).unitCost,
    date,
    sourceOrderId: order.id,
    clientId: order.clientId || null,
    customerName: order.customerName || "",
  };
}

export function productionPlan(product, ingredients, batches = 1) {
  const batchCount = Number(batches);
  if (!product || batchCount <= 0) throw new Error("La cantidad de tandas debe ser positiva.");
  const totals = new Map();
  for (const line of product.recipe ?? []) {
    totals.set(line.ingredientId, (totals.get(line.ingredientId) || 0) + Number(line.quantity) * batchCount);
  }
  const requirements = [...totals].map(([ingredientId, required]) => {
    const ingredient = ingredients.find((item) => item.id === ingredientId);
    const available = Number(ingredient?.stock || 0);
    return {
      ingredientId,
      name: ingredient?.name || "Insumo eliminado",
      unit: ingredient?.baseUnit || "",
      required,
      available,
      enough: available >= required,
      cost: required * Number(ingredient?.averageCost || 0),
    };
  });
  const costs = recipeCost(product, ingredients);
  return {
    batches: batchCount,
    producedQuantity: Number(product.yieldQuantity) * batchCount,
    requirements,
    canProduce: requirements.every((line) => line.enough),
    ingredientCost: costs.ingredientCost * batchCount,
    optionalCost: costs.optionalCost * batchCount,
    totalCost: costs.batchCost * batchCount,
    unitCost: costs.unitCost,
  };
}
