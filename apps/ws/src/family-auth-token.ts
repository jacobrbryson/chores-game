import { createHmac, timingSafeEqual } from "node:crypto";

type FamilySocketClaims = {
	uid: string;
	familyIds: string[];
	exp: number;
};

function sign(value: string, secret: string) {
	return createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifyFamilySocketAuthToken(
	token: string | undefined,
	secret: string,
): FamilySocketClaims | null {
	if (!token || !secret) {
		return null;
	}
	const [encodedClaims, providedSig] = token.split(".");
	if (!encodedClaims || !providedSig) {
		return null;
	}
	const expectedSig = sign(encodedClaims, secret);
	const expectedBuf = Buffer.from(expectedSig);
	const providedBuf = Buffer.from(providedSig);
	if (
		expectedBuf.length !== providedBuf.length ||
		!timingSafeEqual(expectedBuf, providedBuf)
	) {
		return null;
	}

	try {
		const claims = JSON.parse(
			Buffer.from(encodedClaims, "base64url").toString("utf8"),
		) as Partial<FamilySocketClaims>;
		if (!claims.uid || !Array.isArray(claims.familyIds) || !claims.exp) {
			return null;
		}
		if (claims.exp < Math.floor(Date.now() / 1000)) {
			return null;
		}
		const familyIds = Array.from(
			new Set(
				claims.familyIds
					.filter((entry): entry is string => typeof entry === "string")
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0),
			),
		);
		if (familyIds.length === 0) {
			return null;
		}
		return {
			uid: claims.uid,
			familyIds,
			exp: claims.exp,
		};
	} catch {
		return null;
	}
}

