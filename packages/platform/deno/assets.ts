import { extname, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

export async function createAssetHandler(directory: string) {
  const root = await Deno.realPath(directory);
  if (!(await Deno.stat(root)).isDirectory) {
    throw new Error(`前端构建目录无效：${directory}`);
  }
  const index = resolve(root, "index.html");
  if (!(await Deno.stat(index)).isFile) {
    throw new Error(`前端构建目录缺少 index.html：${directory}`);
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (pathname.split("/").includes("..") || pathname.includes("\0")) {
      return new Response(null, { status: 404 });
    }
    const candidate = resolve(root, "." + pathname);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return new Response(null, { status: 404 });
    }
    let file = candidate;
    try {
      if (!(await Deno.stat(file)).isFile) file = index;
    } catch {
      if (
        extname(pathname) ||
        !request.headers.get("Accept")?.includes("text/html")
      ) {
        return new Response(null, { status: 404 });
      }
      file = index;
    }
    const bytes = await Deno.readFile(file);
    const type = contentTypes[extname(file)] ?? "application/octet-stream";
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: {
        "Content-Type": type,
        "Cache-Control": file === index
          ? "no-cache"
          : "public, max-age=31536000, immutable",
        "Content-Length": String(bytes.byteLength),
      },
    });
  };
}
