import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/rebuild-wallet-balances.mjs [--apply] [--uid=<uid>] [--json]",
      "",
      "Environment:",
      "  FIREBASE_PROJECT_ID                 Required",
      "  GOOGLE_APPLICATION_CREDENTIALS      Path to a service account JSON file",
      "  or GOOGLE_SERVICE_ACCOUNT_JSON      Raw service account JSON",
      "  or FIREBASE_SERVICE_ACCOUNT_JSON    Raw service account JSON",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {
    apply: false,
    json: false,
    uid: "",
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg.startsWith("--uid=")) {
      args.uid = arg.slice("--uid=".length).trim();
      continue;
    }
    throw new Error(`UNKNOWN_ARGUMENT_${arg}`);
  }

  return args;
}

function getProjectId() {
  const value = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!value) {
    throw new Error("FIREBASE_PROJECT_ID_MISSING");
  }
  return value;
}

async function loadServiceAccount() {
  const inlineJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    const json = await readFile(path, "utf8");
    return JSON.parse(json);
  }

  throw new Error("SERVICE_ACCOUNT_MISSING");
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken(serviceAccount) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const privateKey = createPrivateKey(serviceAccount.private_key);
  const signature = signer.sign(privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ACCESS_TOKEN_FAILED_${response.status}_${detail}`);
  }

  const json = await response.json();
  if (!json.access_token || typeof json.access_token !== "string") {
    throw new Error("ACCESS_TOKEN_MISSING");
  }
  return json.access_token;
}

function getDocumentsBasePath(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function requestFirestore(url, accessToken, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`FIRESTORE_HTTP_${response.status}_${detail}`);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function listDocumentsPage(projectId, path, accessToken, pageSize = 100, pageToken = "") {
  const url = new URL(`${getDocumentsBasePath(projectId)}/${path}`);
  url.searchParams.set("pageSize", String(pageSize));
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }
  const json = await requestFirestore(url.toString(), accessToken);
  return {
    documents: Array.isArray(json?.documents) ? json.documents : [],
    nextPageToken: typeof json?.nextPageToken === "string" ? json.nextPageToken : "",
  };
}

async function* iterateDocuments(projectId, path, accessToken, pageSize = 100) {
  let nextPageToken = "";
  do {
    const page = await listDocumentsPage(projectId, path, accessToken, pageSize, nextPageToken);
    for (const document of page.documents) {
      yield document;
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
}

async function patchDocument(projectId, path, fields, accessToken, updateMask = []) {
  const url = new URL(`${getDocumentsBasePath(projectId)}/${path}`);
  for (const field of updateMask) {
    url.searchParams.append("updateMask.fieldPaths", field);
  }
  return requestFirestore(url.toString(), accessToken, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

async function createOrReplaceDocument(projectId, path, fields, accessToken) {
  return requestFirestore(`${getDocumentsBasePath(projectId)}/${path}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

function documentIdFromName(name) {
  return String(name || "").split("/").pop() || "";
}

function readString(fields, key) {
  const value = fields?.[key];
  if (!value) {
    return "";
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("integerValue" in value) {
    return value.integerValue;
  }
  return "";
}

function readBoolean(fields, key) {
  const value = fields?.[key];
  if (!value) {
    return false;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("stringValue" in value) {
    return value.stringValue === "true";
  }
  return false;
}

function readInteger(fields, key) {
  const value = fields?.[key];
  if (!value) {
    return 0;
  }
  const raw =
    "integerValue" in value
      ? value.integerValue
      : "stringValue" in value
        ? value.stringValue
        : "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function readSignedLedgerDelta(fields) {
  if (fields?.delta) {
    return readInteger(fields, "delta");
  }
  const creditAmount = readInteger(fields, "creditAmount");
  const debitAmount = readInteger(fields, "debitAmount");
  return creditAmount - debitAmount;
}

function stringField(value) {
  return { stringValue: value };
}

function integerField(value) {
  return { integerValue: String(Math.max(0, Math.trunc(value))) };
}

function signedIntegerField(value) {
  return { integerValue: String(Math.trunc(value)) };
}

function boolField(value) {
  return { booleanValue: Boolean(value) };
}

function timestampField(value) {
  return { timestampValue: value };
}

async function collectUserBalanceState(projectId, userDoc, accessToken) {
  const uid = documentIdFromName(userDoc.name);
  const storedBalance = readInteger(userDoc.fields, "walletBalance");
  let projectedBalance = 0;
  let ledgerEntryCount = 0;
  let firstEntryAt = "";
  let lastEntryAt = "";

  for await (const ledgerDoc of iterateDocuments(projectId, `users/${uid}/walletLedger`, accessToken, 500)) {
    if (readBoolean(ledgerDoc.fields, "countsTowardBalance") === false) {
      continue;
    }
    projectedBalance += readSignedLedgerDelta(ledgerDoc.fields);
    ledgerEntryCount += 1;
    const createdAt = readString(ledgerDoc.fields, "createdAt");
    if (createdAt && (!firstEntryAt || createdAt < firstEntryAt)) {
      firstEntryAt = createdAt;
    }
    if (createdAt && (!lastEntryAt || createdAt > lastEntryAt)) {
      lastEntryAt = createdAt;
    }
  }

  return {
    uid,
    storedBalance,
    projectedBalance,
    deltaNeeded: projectedBalance - storedBalance,
    ledgerEntryCount,
    firstEntryAt,
    lastEntryAt,
    negativeProjectedBalance: projectedBalance < 0,
    mismatch: storedBalance !== projectedBalance,
  };
}

async function writeRepairAudit(projectId, result, accessToken, actorEmail) {
  const now = new Date().toISOString();
  await createOrReplaceDocument(
    projectId,
    `users/${result.uid}/walletBalanceAudit/${randomUUID()}`,
    {
      uid: stringField(result.uid),
      kind: stringField("rebuild_from_ledger"),
      storedBalanceBefore: integerField(result.storedBalance),
      projectedBalance: signedIntegerField(result.projectedBalance),
      repairDelta: signedIntegerField(result.deltaNeeded),
      ledgerEntryCount: integerField(result.ledgerEntryCount),
      firstLedgerEntryAt: stringField(result.firstEntryAt),
      lastLedgerEntryAt: stringField(result.lastEntryAt),
      applied: boolField(true),
      actor: stringField(actorEmail),
      createdAt: timestampField(now),
    },
    accessToken,
  );
}

async function applyRepair(projectId, result, accessToken, actorEmail) {
  const now = new Date().toISOString();
  await patchDocument(
    projectId,
    `users/${result.uid}`,
    {
      walletBalance: integerField(result.projectedBalance),
      walletUpdatedAt: timestampField(now),
    },
    accessToken,
    ["walletBalance", "walletUpdatedAt"],
  );
  await writeRepairAudit(projectId, result, accessToken, actorEmail);
}

function printTextReport(summary, results) {
  console.log(`Mode: ${summary.apply ? "apply" : "dry-run"}`);
  console.log(`Users scanned: ${summary.usersScanned}`);
  console.log(`Mismatches: ${summary.mismatches}`);
  console.log(`Repairs applied: ${summary.repairsApplied}`);
  console.log(`Negative ledger totals: ${summary.negativeProjectedBalances}`);

  const interesting = results.filter((result) => result.mismatch || result.negativeProjectedBalance);
  if (interesting.length === 0) {
    console.log("No wallet mismatches found.");
    return;
  }

  console.log("");
  for (const result of interesting) {
    console.log(
      [
        result.uid,
        `stored=${result.storedBalance}`,
        `projected=${result.projectedBalance}`,
        `repairDelta=${result.deltaNeeded}`,
        `entries=${result.ledgerEntryCount}`,
        result.negativeProjectedBalance ? "NEGATIVE_LEDGER_TOTAL" : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = getProjectId();
  const serviceAccount = await loadServiceAccount();
  const accessToken = await getAccessToken(serviceAccount);
  const actorEmail = String(serviceAccount.client_email || "").trim() || "service-account";

  const results = [];
  let usersScanned = 0;
  let mismatches = 0;
  let repairsApplied = 0;
  let negativeProjectedBalances = 0;

  if (args.uid) {
    const doc = await requestFirestore(
      `${getDocumentsBasePath(projectId)}/users/${args.uid}`,
      accessToken,
    );
    const result = await collectUserBalanceState(projectId, doc, accessToken);
    usersScanned = 1;
    results.push(result);
  } else {
    for await (const userDoc of iterateDocuments(projectId, "users", accessToken, 200)) {
      const result = await collectUserBalanceState(projectId, userDoc, accessToken);
      results.push(result);
      usersScanned += 1;
    }
  }

  for (const result of results) {
    if (result.mismatch) {
      mismatches += 1;
    }
    if (result.negativeProjectedBalance) {
      negativeProjectedBalances += 1;
    }
    if (!args.apply || !result.mismatch || result.negativeProjectedBalance) {
      continue;
    }
    await applyRepair(projectId, result, accessToken, actorEmail);
    repairsApplied += 1;
  }

  const summary = {
    apply: args.apply,
    usersScanned,
    mismatches,
    repairsApplied,
    negativeProjectedBalances,
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
    return;
  }

  printTextReport(summary, results);
  if (negativeProjectedBalances > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
