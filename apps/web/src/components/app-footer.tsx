import Link from "next/link";
import { createTranslator, type AppLocale } from "@packages/locales";
import { AppBrand } from "@/components/app-brand";

type FooterIconName = "copyright" | "privacy" | "terms" | "changeLog" | "orcwood";

function FooterItemIcon({ name }: { name: FooterIconName }) {
  if (name === "copyright") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="app-footer-icon">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M14.7 9.4A3.7 3.7 0 1 0 14.7 14.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "privacy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="app-footer-icon">
        <path
          d="M12 3 5.6 5.8v5.6c0 4.8 3 7.6 6.4 9.6 3.4-2 6.4-4.8 6.4-9.6V5.8L12 3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m9.5 12.2 1.7 1.8 3.4-3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "terms") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="app-footer-icon">
        <path
          d="M7.5 3.5h6.7l3.8 3.8v13.2H7.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.2 3.6V7.4H18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.8 11.2h5.8M9.8 14.1h5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "changeLog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="app-footer-icon">
        <path
          d="M7 4.5h6.8l3.7 3.7v10.3H7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13.8 4.7v3.7h3.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.7 11.2h5.6M9.7 14.2h3.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="app-footer-icon">
      <path
        d="M12 4.2 13.6 8l4 .6-2.9 2.7.7 3.9-3.4-1.8-3.4 1.8.7-3.9-2.9-2.7 4-.6L12 4.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 5.7h.01M19 18.3h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AppFooter({ locale }: { locale: AppLocale }) {
  const t = createTranslator({ locale });
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer panel" aria-label={t("footer.ariaLabel")}>
      <div className="app-footer-brand">
        <AppBrand />
      </div>
      <div className="app-footer-content">
        <p className="app-footer-item">
          <FooterItemIcon name="copyright" />
          <span>Family Chores {currentYear}</span>
        </p>
        <Link href="/privacy-policy" className="app-footer-link app-footer-item">
          <FooterItemIcon name="privacy" />
          <span>{t("footer.privacyPolicy")}</span>
        </Link>
        <Link href="/terms-of-service" className="app-footer-link app-footer-item">
          <FooterItemIcon name="terms" />
          <span>{t("footer.termsOfService")}</span>
        </Link>
        <Link href="/change-log" className="app-footer-link app-footer-item">
          <FooterItemIcon name="changeLog" />
          <span>{t("footer.changeLog")}</span>
        </Link>
        <a
          href="https://orcwood.com"
          target="_blank"
          rel="noreferrer"
          className="app-footer-link app-footer-item">
          <FooterItemIcon name="orcwood" />
          <span>{t("footer.broughtBy")}</span>
        </a>
      </div>
    </footer>
  );
}
