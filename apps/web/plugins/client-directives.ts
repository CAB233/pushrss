import type { Plugin } from "vite";

/** 纯客户端产物在合并模块前消化依赖的 RSC 客户端边界声明。 */
export function clientDirectives(): Plugin {
  return {
    name: "pushrss:client-directives",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (
        this.environment.config.consumer !== "client" ||
        !id.includes("/node_modules/") ||
        !/\.[cm]?js(?:\?|$)/.test(id) ||
        !code.includes("use client")
      ) return;

      const ast = this.parse(code);
      let transformed = code;
      let changed = false;
      for (const statement of ast.body) {
        // 仅检查 directive prologue，保留函数体和普通字符串表达式。
        if (
          statement.type !== "ExpressionStatement" ||
          !("directive" in statement) ||
          typeof statement.directive !== "string"
        ) break;
        if (statement.directive !== "use client") continue;
        transformed = transformed.slice(0, statement.start) +
          transformed.slice(statement.start, statement.end).replace(
            /[^\r\n]/g,
            " ",
          ) +
          transformed.slice(statement.end);
        changed = true;
      }
      // 等长空白保持行列位置，沿用已有 sourcemap。
      return changed ? { code: transformed, map: null } : undefined;
    },
  };
}
