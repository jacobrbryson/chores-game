import { NotificationsPageClient } from "@/components/notifications-page-client";

type NotificationsPageProps = {
  searchParams?: Promise<{ unseen?: string }>;
};

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const params = (await searchParams) ?? {};
  return <NotificationsPageClient initialUnseenOnly={params.unseen === "true"} />;
}
