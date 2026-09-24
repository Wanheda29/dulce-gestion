const STORAGE_KEY = "dulce-gestion-v1";
export const CURRENT_SCHEMA_VERSION = 1;

export const emptyState = {
  ingredients: [],
  purchases: [],
  products: [],
  productions: [],
  clients: [],
  orders: [],
  sales: [],
};

const collectionNames = Object.keys(emptyState);

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("El respaldo no contiene datos válidos.");
  const normalized = structuredClone(emptyState);
  for (const collection of collectionNames) {
    const value = candidate[collection];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error(`La colección “${collection}” no es válida.`);
    if (value.some((item) => !item || typeof item !== "object" || typeof item.id !== "string")) {
      throw new Error(`La colección “${collection}” contiene registros dañados.`);
    }
    const ids = value.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`La colección “${collection}” contiene identificadores repetidos.`);
    normalized[collection] = value;
  }
  return normalized;
}

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? normalizeState(saved) : structuredClone(emptyState);
  } catch {
    return structuredClone(emptyState);
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportState(state) {
  const backup = createBackup(state);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  link.href = objectUrl;
  link.download = `dulce-gestion-${localDate}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function createBackup(state, exportedAt = new Date().toISOString()) {
  return {
    application: "Dulce Gestión",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt,
    data: normalizeState(state),
  };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  const isEnvelope = parsed?.application === "Dulce Gestión" || Object.hasOwn(parsed ?? {}, "schemaVersion");
  if (isEnvelope) {
    if (parsed.application !== "Dulce Gestión") throw new Error("El archivo pertenece a otra aplicación.");
    if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) throw new Error("La versión del respaldo no es válida.");
    if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error("El respaldo fue creado con una versión más nueva de la aplicación.");
    return { data: normalizeState(parsed.data), schemaVersion: parsed.schemaVersion, exportedAt: parsed.exportedAt || null, legacy: false };
  }
  return { data: normalizeState(parsed), schemaVersion: 0, exportedAt: null, legacy: true };
}

export function backupSummary(state) {
  const data = normalizeState(state);
  return {
    ingredients: data.ingredients.length,
    purchases: data.purchases.length,
    products: data.products.length,
    productions: data.productions.length,
    clients: data.clients.length,
    orders: data.orders.length,
    sales: data.sales.length,
  };
}

export function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
