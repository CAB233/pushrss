import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Loader2, Rss } from "lucide-react";
import { SWRConfig } from "swr";
import { Toaster } from "sonner";
import { createApi, createSession } from "./api.ts";
import { Dashboard } from "./components/dashboard/dashboard.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Label } from "./components/ui/label.tsx";
import "./style.css";

function App() {
  const [session, setSession] = useState<
    "checking" | "signed-in" | "signed-out"
  >("checking");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const expired = () => {
      setSession("signed-out");
      setError("登录已过期，请重新输入管理密码");
    };
    globalThis.addEventListener("session-expired", expired);
    createApi()("/status", "GET", undefined, controller.signal).then(() => {
      if (!controller.signal.aborted) setSession("signed-in");
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setSession("signed-out");
        if (cause?.status !== 401) setError(cause.message);
      }
    });
    return () => {
      controller.abort();
      globalThis.removeEventListener("session-expired", expired);
    };
  }, []);
  if (session === "signed-in") {
    return (
      <SWRConfig value={{ shouldRetryOnError: false }}>
        <Dashboard />
        <Toaster />
      </SWRConfig>
    );
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="gap-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Rss aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1.5">
            <CardTitle>登录 PushRSS</CardTitle>
            <CardDescription>管理订阅源、推送渠道与路由</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {session === "checking"
            ? (
              <p
                role="status"
                className="text-center text-sm text-muted-foreground"
              >
                正在检查登录状态…
              </p>
            )
            : (
              <form
                className="flex flex-col gap-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const password = String(
                    new FormData(event.currentTarget).get("password") ?? "",
                  );
                  setPending(true);
                  setError("");
                  try {
                    await createSession(password);
                    setSession("signed-in");
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "登录失败",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">管理密码</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="请输入管理密码"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending}>
                  {pending && (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  )}
                  {pending ? "登录中…" : "登录"}
                </Button>
              </form>
            )}
        </CardContent>
      </Card>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
