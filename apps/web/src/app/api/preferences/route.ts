import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  type FirestoreValue,
  boolField,
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  findColorThemeOptionById,
  normalizeThemePalette,
} from "@/lib/store/catalog";
import {
  isThemePreference,
  type ThemePreference,
} from "@/lib/theme/preferences";
import {
  COMPLETION_WINDOW_VALUES,
  parseCompletionWindow,
} from "@/lib/preferences/completion-window";

type UpdatePreferencesBody = {
  myChoresOnly?: unknown;
  completionWindow?: unknown;
  themeOptionId?: unknown;
  themePrimaryColor?: unknown;
  themeSecondaryColor?: unknown;
  themeTertiaryColor?: unknown;
  choreAdvancedOptionsOpenV2?: unknown;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

function defaultPreferences() {
  return {
    myChoresOnly: false,
    completionWindow: parseCompletionWindow(""),
    themeOptionId: "",
    themePrimaryColor: "",
    themeSecondaryColor: "",
    themeTertiaryColor: "",
    choreAdvancedOptionsOpenV2: false,
  };
}

function parseThemePreference(body: UpdatePreferencesBody) {
  const hasThemeField =
    body.themeOptionId !== undefined ||
    body.themePrimaryColor !== undefined ||
    body.themeSecondaryColor !== undefined ||
    body.themeTertiaryColor !== undefined;
  if (!hasThemeField) {
    return { hasThemeField, preference: null as ThemePreference | null, error: "" };
  }

  if (
    typeof body.themeOptionId !== "string" ||
    typeof body.themePrimaryColor !== "string" ||
    typeof body.themeSecondaryColor !== "string" ||
    typeof body.themeTertiaryColor !== "string"
  ) {
    return { hasThemeField, preference: null as ThemePreference | null, error: "invalid_theme_payload" };
  }

  const preference = {
    optionId: body.themeOptionId.trim(),
    primary: body.themePrimaryColor.trim().toLowerCase(),
    secondary: body.themeSecondaryColor.trim().toLowerCase(),
    tertiary: body.themeTertiaryColor.trim().toLowerCase(),
  };
  if (!isThemePreference(preference)) {
    return { hasThemeField, preference: null as ThemePreference | null, error: "invalid_theme_payload" };
  }

  const themeOption = findColorThemeOptionById(preference.optionId);
  if (!themeOption) {
    return { hasThemeField, preference: null as ThemePreference | null, error: "invalid_theme_option" };
  }
  const expected = normalizeThemePalette(themeOption.theme);
  if (
    preference.primary !== expected.primary ||
    preference.secondary !== expected.secondary ||
    preference.tertiary !== expected.tertiary
  ) {
    return { hasThemeField, preference: null as ThemePreference | null, error: "invalid_theme_payload" };
  }

  return { hasThemeField, preference, error: "" };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let userDoc: Awaited<ReturnType<typeof getDocument>>;
        try {
          userDoc = await getDocument(`users/${session.uid}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return defaultPreferences();
          }
          throw error;
        }
        return {
          myChoresOnly: readBoolean(userDoc.fields, "preferencesMyChoresOnly"),
          completionWindow: parseCompletionWindow(
            readString(userDoc.fields, "preferencesCompletionWindow"),
          ),
          themeOptionId: readString(userDoc.fields, "preferencesThemeOptionId"),
          themePrimaryColor: readString(userDoc.fields, "preferencesThemePrimaryColor"),
          themeSecondaryColor: readString(userDoc.fields, "preferencesThemeSecondaryColor"),
          themeTertiaryColor: readString(userDoc.fields, "preferencesThemeTertiaryColor"),
          choreAdvancedOptionsOpenV2: readBoolean(userDoc.fields, "preferencesChoreAdvancedOptionsOpenV2"),
        };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PREFERENCES_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "preferences_unavailable");
  }
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: UpdatePreferencesBody;
  try {
    body = (await request.json()) as UpdatePreferencesBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hasMyChoresOnly = body.myChoresOnly !== undefined;
  if (hasMyChoresOnly && typeof body.myChoresOnly !== "boolean") {
    return NextResponse.json({ error: "invalid_my_chores_only" }, { status: 400 });
  }
  const hasCompletionWindow = body.completionWindow !== undefined;
  const parsedCompletionWindow = parseCompletionWindow(body.completionWindow);
  if (hasCompletionWindow && !parsedCompletionWindow) {
    return NextResponse.json(
      {
        error: "invalid_completion_window",
        allowed: COMPLETION_WINDOW_VALUES,
      },
      { status: 400 },
    );
  }
  const hasChoreAdvancedOptionsOpenV2 = body.choreAdvancedOptionsOpenV2 !== undefined;
  if (hasChoreAdvancedOptionsOpenV2 && typeof body.choreAdvancedOptionsOpenV2 !== "boolean") {
    return NextResponse.json({ error: "invalid_chore_advanced_options_open" }, { status: 400 });
  }

  const themeParse = parseThemePreference(body);
  if (themeParse.error) {
    return NextResponse.json({ error: themeParse.error }, { status: 400 });
  }
  if (!hasMyChoresOnly && !hasCompletionWindow && !hasChoreAdvancedOptionsOpenV2 && !themeParse.hasThemeField) {
    return NextResponse.json({ error: "no_preference_updates" }, { status: 400 });
  }

  try {
    const { session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const fields: Record<string, FirestoreValue> = {
          preferencesUpdatedAt: timestampField(new Date().toISOString()),
        };
        const updateMask = ["preferencesUpdatedAt"];
        if (hasMyChoresOnly) {
          fields.preferencesMyChoresOnly = boolField(body.myChoresOnly as boolean);
          updateMask.push("preferencesMyChoresOnly");
        }
        if (hasCompletionWindow && parsedCompletionWindow) {
          fields.preferencesCompletionWindow = stringField(parsedCompletionWindow);
          updateMask.push("preferencesCompletionWindow");
        }
        if (hasChoreAdvancedOptionsOpenV2) {
          fields.preferencesChoreAdvancedOptionsOpenV2 = boolField(body.choreAdvancedOptionsOpenV2 as boolean);
          updateMask.push("preferencesChoreAdvancedOptionsOpenV2");
        }
        if (themeParse.preference) {
          fields.preferencesThemeOptionId = stringField(themeParse.preference.optionId);
          fields.preferencesThemePrimaryColor = stringField(themeParse.preference.primary);
          fields.preferencesThemeSecondaryColor = stringField(themeParse.preference.secondary);
          fields.preferencesThemeTertiaryColor = stringField(themeParse.preference.tertiary);
          updateMask.push(
            "preferencesThemeOptionId",
            "preferencesThemePrimaryColor",
            "preferencesThemeSecondaryColor",
            "preferencesThemeTertiaryColor",
          );
        }
        await patchDocument(
          `users/${session.uid}`,
          fields,
          idToken,
          updateMask,
        );
        return null;
      },
    );

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PREFERENCES_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "preferences_update_failed");
  }
}


