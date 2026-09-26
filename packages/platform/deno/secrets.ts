import { createSecretStore } from "../../core/secrets.ts";
export function loadSecretStore() {
  return createSecretStore(Deno.env.get("PUSHRSS_MASTER_KEY"));
}
