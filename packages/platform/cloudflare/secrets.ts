import { createSecretStore } from "../../core/secrets.ts";
export function loadSecretStore(env: { PUSHRSS_MASTER_KEY?: string }) {
  return createSecretStore(env.PUSHRSS_MASTER_KEY);
}
