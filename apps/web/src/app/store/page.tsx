import { StorePageClient } from "@/components/store-page-client";
import { DiscoverySeenOnMount } from "@/components/discovery-seen-on-mount";

export default function StorePage() {
  return (
    <>
      {/* Opening the store page = the user has seen the category list; clears
          the top-level store badge. Per-category badges clear when a category
          options modal opens (see StorePageClient). */}
      <DiscoverySeenOnMount sections={["store"]} />
      <StorePageClient />
    </>
  );
}
