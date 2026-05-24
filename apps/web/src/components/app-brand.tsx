"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { familyChoresBrand } from "@/lib/brand";

function BrandContent() {
  return (
    <>
      <Image
        src="/icons/web-app-manifest-192x192.png"
        alt=""
        width={36}
        height={36}
        className="brand-icon"
        priority
      />
      <span className="brand-copy">
        <span className="brand-title">{familyChoresBrand.title}</span>
        <span className="brand-tagline">{familyChoresBrand.tagline}</span>
      </span>
    </>
  );
}

export function AppBrand() {
  const pathname = usePathname();

  if (pathname === "/") {
    return (
      <div className="brand" aria-current="page">
        <BrandContent />
      </div>
    );
  }

  return (
    <Link href="/" className="brand brand-link">
      <BrandContent />
    </Link>
  );
}
