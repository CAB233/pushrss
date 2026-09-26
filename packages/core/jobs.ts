import type { Job } from "../shared/contracts.ts";
import { fetchFeed, type FetchOptions } from "./fetch-feed.ts";
import {
  dispatchItems,
  type NotificationServices,
  sendDelivery,
} from "./notifications.ts";
export async function handleJob(
  services: NotificationServices,
  job: Job,
  options: FetchOptions = {},
) {
  if (job.type === "send_notification") {
    await sendDelivery(services, job.deliveryId);
    return;
  }
  const result = await fetchFeed(services.repositories, job.feedId, options);
  if (result.status === "failed") throw new Error("Feed 任务执行失败");
  if (result.status === "updated") {
    await dispatchItems(services, result.notificationItems);
  }
}
