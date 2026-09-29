import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { useChannels, useFeeds, useLogs } from "../../lib/client.ts";
import { DeliveryLogPanel } from "./delivery-log.tsx";
import { AppHeader } from "./app-header.tsx";
import { ChannelsPanel } from "./channels-panel.tsx";
import { FeedsPanel } from "./feeds-panel.tsx";
import { RoutingMatrix } from "./routing-matrix.tsx";

function Count({ value }: { value?: number }) {
  if (value === undefined) return null;
  return (
    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
      {value}
    </span>
  );
}

export function Dashboard() {
  const { data: feeds } = useFeeds();
  const { data: channels } = useChannels();
  const { data: logs } = useLogs();
  const failed = logs?.filter((log) => !log.ok).length ?? 0;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <Tabs defaultValue="feeds" className="flex flex-col gap-5">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="feeds" className="min-w-0 gap-1.5 px-1 sm:px-3">
              订阅源 <Count value={feeds?.length} />
            </TabsTrigger>
            <TabsTrigger
              value="channels"
              className="min-w-0 gap-1.5 px-1 sm:px-3"
            >
              推送渠道 <Count value={channels?.length} />
            </TabsTrigger>
            <TabsTrigger value="routing" className="min-w-0 px-1 sm:px-3">
              路由矩阵
            </TabsTrigger>
            <TabsTrigger value="logs" className="min-w-0 gap-1 px-1 sm:px-3">
              推送记录
              {failed > 0 && (
                <span
                  aria-label={`${failed} 条失败记录`}
                  className="hidden text-xs tabular-nums text-destructive sm:inline"
                >
                  {failed} 失败
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="feeds">
            <FeedsPanel />
          </TabsContent>
          <TabsContent value="channels">
            <ChannelsPanel />
          </TabsContent>
          <TabsContent value="routing">
            <RoutingMatrix />
          </TabsContent>
          <TabsContent value="logs">
            <DeliveryLogPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
