/** UTF-8 编码允许用户使用中文和空格作为密码；Basic 用户名固定为 admin。 */
export function passwordAuthorization(password: string): string {
  const bytes = new TextEncoder().encode(`admin:${password}`);
  return "Basic " +
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

/** 使用主密钥签名会话，并让管理密码变更立即使旧会话失效。 */
export function sessionSigningSecret(
  masterKey: string,
  adminPassword: string,
): string {
  return `PushRSS/session/v1:${masterKey}:${adminPassword}`;
}
