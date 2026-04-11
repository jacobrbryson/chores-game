"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
        <span className="brand-title">Family Chores</span>
        <span className="brand-tagline">Play. Help. Earn.</span>
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
