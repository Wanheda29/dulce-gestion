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
  };
}

export function productionPlan(product, ingredients, batches = 1) {
  const batchCount = Number(batches);
  if (!product || batchCount <= 0) throw new Error("La cantidad de tandas debe ser positiva.");
  const requirements = (product.recipe ?? []).map((line) => {
    const ingredient = ingredients.find((item) => item.id === line.ingredientId);
    const required = Number(line.quantity) * batchCount;
    const available = Number(ingredient?.stock || 0);
    return {
      ingredientId: line.ingredientId,
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
