import Link from "next/link";
import { SetNotFound } from "@/lib/not-found-context";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <SetNotFound />
      <h1 className="text-6xl font-bold opacity-20">404</h1>
      <p className="text-lg text-muted-foreground">Page not found</p>
      <Link href="/" className="btn btn-primary">
        Go home
      </Link>
    </div>
  );
}
