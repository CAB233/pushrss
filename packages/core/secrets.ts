import type { SecretStore } from "../shared/contracts.ts";
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("编码无效");
  return bytes;
}
/** 接收平台读取的环境变量；主密钥为 32 字节随机数的标准 Base64。 */
export async function createSecretStore(
  masterKey: string | undefined,
): Promise<SecretStore> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = decode(masterKey ?? "");
    if (raw.length !== 32) throw new Error();
  } catch {
    throw new Error("PUSHRSS_MASTER_KEY 必须为 32 字节随机密钥的 Base64 编码");
  }
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  raw.fill(0);
  return {
    async encrypt(plaintext, context) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode("pushrss:v1:" + context),
        },
        key,
        encoder.encode(plaintext),
      );
      return ["v1", encode(iv), encode(new Uint8Array(data))].join(".");
    },
    async decrypt(envelope, context) {
      try {
        const parts = envelope.split(".");
        if (parts.length !== 3 || parts[0] !== "v1") throw new Error();
        const iv = decode(parts[1]);
        if (iv.length !== 12) throw new Error();
        const data = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: encoder.encode("pushrss:v1:" + context),
          },
          key,
          decode(parts[2]),
        );
        return new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new Error("渠道凭据解密失败，请检查主密钥、渠道标识和密文完整性");
      }
    },
  };
}
/** 显式白名单投影，供 API 与日志复用。 */
export function publicChannel(
  channel: {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
  },
) {
  const { id, name, type, enabled, createdAt, updatedAt } = channel;
  return { id, name, type, enabled, createdAt, updatedAt };
}
