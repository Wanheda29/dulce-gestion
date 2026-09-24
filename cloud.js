import { cloudConfig } from "./cloud-config.js";

let clientPromise = null;

export function isCloudConfigured() {
  return Boolean(
    cloudConfig.enabled &&
    /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cloudConfig.url) &&
    cloudConfig.publishableKey.startsWith("sb_publishable_"),
  );
}

async function loadLibrary() {
  if (globalThis.supabase?.createClient) return globalThis.supabase;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar la conexión con Supabase."));
    document.head.append(script);
  });
  return globalThis.supabase;
}

async function getClient() {
  if (!isCloudConfigured()) throw new Error("La nube todavía no está configurada.");
  if (!clientPromise) clientPromise = loadLibrary().then((library) => library.createClient(cloudConfig.url, cloudConfig.publishableKey));
  return clientPromise;
}

export async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}

export async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function getSession() {
  if (!isCloudConfigured()) return null;
  const client = await getClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export async function getCloudAccount() {
  const client = await getClient();
  const { data: membership, error: membershipError } = await client.from("memberships").select("business_id, role").limit(1).maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw new Error("La cuenta no está asociada a ningún negocio.");
  const { data: business, error: businessError } = await client.from("businesses").select("id, name, subscription_status, grace_until").eq("id", membership.business_id).single();
  if (businessError) throw new Error(businessError.message);
  const graceExpired = business.subscription_status === "grace" && (!business.grace_until || new Date(business.grace_until) <= new Date());
  return { businessId: business.id, businessName: business.name, status: graceExpired ? "read_only" : business.subscription_status, graceUntil: business.grace_until, role: membership.role };
}

export async function pullCloudState(businessId) {
  const client = await getClient();
  const { data, error } = await client.from("business_data").select("data, revision, updated_at").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function pushCloudState(businessId, state, expectedRevision) {
  const client = await getClient();
  const { data, error } = await client.rpc("save_business_data", {
    p_business: businessId,
    p_expected_revision: expectedRevision,
    p_data: state,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}
