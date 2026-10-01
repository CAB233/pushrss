import {
  i18n,
  parseLanguagePreference,
  resolveLanguage,
} from "../apps/web/src/i18n.ts";
import en from "../apps/web/src/locales/en.json" with { type: "json" };
import zhCN from "../apps/web/src/locales/zh-CN.json" with { type: "json" };

Deno.test("语言匹配遵循浏览器优先级，异常配置回退自动模式", () => {
  for (
    const [languages, expected] of [
      [["en-US", "zh-CN"], "en"],
      [["zh-TW", "en-US"], "zh-CN"],
      [["fr-FR", "zh-Hans-CN"], "zh-CN"],
      [["EN-gb"], "en"],
      [["ja-JP"], "en"],
      [[], "en"],
    ] as const
  ) {
    if (resolveLanguage(languages) !== expected) {
      throw new Error(`语言匹配失败: ${languages}`);
    }
  }
  for (const value of [null, "invalid", "system"]) {
    if (parseLanguagePreference(value) !== "system") {
      throw new Error("自动模式回退失败");
    }
  }
  for (const value of ["en", "zh-CN"] as const) {
    if (parseLanguagePreference(value) !== value) {
      throw new Error("手动语言选择失败");
    }
  }
});
Deno.test("中英文词条、插值参数保持一致，框架正确插入动态内容", () => {
  if (
    JSON.stringify(Object.keys(en).sort()) !==
      JSON.stringify(Object.keys(zhCN).sort())
  ) {
    throw new Error("中英文词条缺失");
  }
  const placeholders = (value: string) =>
    [...value.matchAll(/{{(.*?)}}/g)].map((m) => m[1]).sort().join(",");
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    if (
      !en[key] || !zhCN[key] ||
      placeholders(en[key]) !== placeholders(zhCN[key])
    ) {
      throw new Error(`词条或参数不完整: ${key}`);
    }
  }
  for (const lng of ["en", "zh-CN"]) {
    const message = i18n.t("error.request", { lng, status: 503 });
    if (!message.includes("503") || message.includes("{{")) {
      throw new Error("插值失败");
    }
  }
});
