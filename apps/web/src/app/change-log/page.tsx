import type { Metadata } from "next";
import { ChangeLogPage } from "@/components/change-log-page";

export const metadata: Metadata = {
  title: "Change Log | Family Chores",
  description: "Read the latest Family Chores app updates and fixes.",
};

export default function ChangeLogRoute() {
  return <ChangeLogPage />;
}
