"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { RESPONSIBILITY_PILLARS, RESPONSIBILITY_PILLAR_EMOJI } from "@/lib/responsibility/types";
import { AthenaAvatar } from "@/components/athena/athena-avatar";
import { AthenaThoughtCarousel } from "@/components/athena/athena-thought-carousel";

type GhostViewerRole = "admin" | "player";

// Time thresholds (ms) for the escalating "Athena is thinking" micro-interactions.
const STAGE_CYCLE_MS = 1000; // begin cycling thoughts
const STAGE_PILLARS_MS = 3000; // float responsibility pillars by
const STAGE_PERSONAL_MS = 5000; // reference (safe) family context

const BASE_THOUGHT_KEYS: Record<GhostViewerRole, string[]> = {
  player: [
    "ghost.thinking.child1",
    "ghost.thinking.child2",
    "ghost.thinking.child3",
    "ghost.thinking.child4",
    "ghost.thinking.child5",
    "ghost.thinking.child6",
  ],
  admin: [
    "ghost.thinking.parent1",
    "ghost.thinking.parent2",
    "ghost.thinking.parent3",
    "ghost.thinking.parent4",
    "ghost.thinking.parent5",
    "ghost.thinking.parent6",
  ],
};

/** Decorative floating tokens drawn from the Family Chores visual language. */
const FLOATERS = ["🪙", "⭐", "🏅", ...RESPONSIBILITY_PILLARS.map((p) => RESPONSIBILITY_PILLAR_EMOJI[p])];

/**
 * AthenaThinkingPanel — the magical replacement for a loading spinner. Shows
 * Athena's avatar breathing/glowing while she "reviews" the family's progress,
 * with thoughts that rotate and escalate the longer the wait goes (cycling →
 * floating pillars → a safe, personal reference). Time-independent: no progress
 * bars, no percentages.
 */
export function AthenaThinkingPanel({
  role,
  subjectName,
  reducedMotion = false,
}: {
  role: GhostViewerRole;
  subjectName?: string;
  reducedMotion?: boolean;
}) {
  const { t } = useLocale();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      // Still advance enough to show the first couple of thoughts statically.
      setElapsedMs(STAGE_PILLARS_MS);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 300);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const showPillars = elapsedMs >= STAGE_PILLARS_MS;
  const showPersonal = elapsedMs >= STAGE_PERSONAL_MS;

  const messages = useMemo(() => {
    const list = BASE_THOUGHT_KEYS[role].map((key) => t(key));
    if (showPillars) {
      for (const pillar of RESPONSIBILITY_PILLARS) {
        list.push(t("ghost.thinking.pillarHighlight", { pillar: t(`responsibility.pillars.${pillar}`) }));
      }
    }
    if (showPersonal) {
      list.push(t("ghost.thinking.recentActivity"));
      const name = (subjectName ?? "").trim();
      if (name) {
        list.push(t("ghost.thinking.personalName", { name }));
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, subjectName, showPillars, showPersonal, t]);

  // Once cycling begins we rotate; before that, hold the first thought.
  const carouselMessages = elapsedMs >= STAGE_CYCLE_MS || reducedMotion ? messages : messages.slice(0, 1);

  return (
    <div className="athena-thinking-panel" role="status" aria-live="polite">
      <div className="athena-thinking-stage">
        {!reducedMotion && showPillars ? (
          <div className="athena-floaters" aria-hidden="true">
            {FLOATERS.map((glyph, i) => (
              <span
                key={`${glyph}-${i}`}
                className="athena-floater"
                style={{ "--i": i, "--n": FLOATERS.length } as CSSProperties}
              >
                {glyph}
              </span>
            ))}
          </div>
        ) : null}
        <AthenaAvatar size={92} thinking={!reducedMotion} />
      </div>
      <AthenaThoughtCarousel messages={carouselMessages} reducedMotion={reducedMotion} />
    </div>
  );
}
