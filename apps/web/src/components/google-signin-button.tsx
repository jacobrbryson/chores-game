"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { GoogleGIcon } from "@/components/google-g-icon";

type GoogleSignInButtonProps =
  | {
      mode: "gsi";
      clientId: string;
      loginUri: string;
      width?: number;
      includeScript?: boolean;
      includeOnload?: boolean;
      wrapperClassName?: string;
    }
  | {
      mode: "action";
      onClick: () => void;
      disabled?: boolean;
      className?: string;
      iconClassName?: string;
      label?: string;
    };

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function GoogleSignInButton(props: GoogleSignInButtonProps) {
  const gsiWrapperRef = useRef<HTMLDivElement>(null);
  const [isGsiRendered, setIsGsiRendered] = useState(false);

  useEffect(() => {
    if (props.mode !== "gsi") {
      return;
    }

    function updateRenderedState() {
      setIsGsiRendered(Boolean(gsiWrapperRef.current?.querySelector("iframe")));
    }

    updateRenderedState();
    const observer = new MutationObserver(updateRenderedState);
    const wrapper = gsiWrapperRef.current;
    if (wrapper) {
      observer.observe(wrapper, { childList: true, subtree: true });
    }

    const timeoutId = window.setTimeout(updateRenderedState, 2500);
    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [props.mode]);

  if (props.mode === "gsi") {
    const width = props.width ?? 248;
    return (
      <>
        {props.includeScript !== false ? (
          <Script src="https://accounts.google.com/gsi/client" async defer />
        ) : null}
        {props.includeOnload !== false ? (
          <div
            id="g_id_onload"
            data-client_id={props.clientId}
            data-context="signin"
            data-auto_prompt="false"
            data-ux_mode="redirect"
            data-login_uri={props.loginUri}
            data-auto_select="false"
            data-itp_support="true"
            data-use_fedcm_for_prompt="false"
            data-use_fedcm_for_button="false"
          />
        ) : null}
        <div
          ref={gsiWrapperRef}
          className={joinClasses(
            props.wrapperClassName ?? "google-signin-wrap",
            isGsiRendered ? "google-signin-wrap-ready" : "google-signin-wrap-loading",
          )}
          aria-busy={!isGsiRendered}>
          <div className="google-signin-placeholder" aria-hidden="true">
            <GoogleGIcon className="google-signin-placeholder-icon" />
            <span className="google-signin-placeholder-text">Sign in with Google</span>
          </div>
          <div
            className="g_id_signin"
            data-type="standard"
            data-shape="pill"
            data-theme="outline"
            data-text="signin_with"
            data-size="large"
            data-logo_alignment="left"
            data-width={String(width)}
          />
        </div>
      </>
    );
  }

  return (
    <Button
      type="button"
      className={joinClasses("google-brand-action-btn", props.className)}
      onClick={props.onClick}
      disabled={props.disabled}>
      <GoogleGIcon className={joinClasses("google-brand-action-btn-icon", props.iconClassName)} />
      <span>{props.label ?? "Continue with Google"}</span>
    </Button>
  );
}

