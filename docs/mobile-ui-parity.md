# Mobile UI Parity (Expo)

## Web patterns copied
- Shared brand palette: soft blue background, white cards, sky/brand accents.
- Rounded card language with subtle borders and shadows.
- Coin chip treatment inspired by web store/header coin visuals.
- Status badge style for chore and achievement states.
- Dark quest card treatment matching web quest surfaces.
- Consistent section headers, empty/loading/error states.

## Mobile design tokens created
- `apps/mobile/src/theme/colors.ts`
- `apps/mobile/src/theme/spacing.ts`
- `apps/mobile/src/theme/radius.ts`
- `apps/mobile/src/theme/typography.ts`
- `apps/mobile/src/theme/shadows.ts`

## Shared UI components added
- `apps/mobile/src/components/ui/AppScreen.tsx`
- `apps/mobile/src/components/ui/AppHeader.tsx`
- `apps/mobile/src/components/ui/Card.tsx`
- `apps/mobile/src/components/ui/Button.tsx`
- `apps/mobile/src/components/ui/Badge.tsx`
- `apps/mobile/src/components/ui/CoinPill.tsx`
- `apps/mobile/src/components/ui/ProgressBar.tsx`
- `apps/mobile/src/components/ui/EmptyState.tsx`
- `apps/mobile/src/components/ui/LoadingState.tsx`
- `apps/mobile/src/components/ui/ErrorState.tsx`
- `apps/mobile/src/components/ui/SectionHeader.tsx`
- `apps/mobile/src/components/ui/AvatarBadge.tsx`

## Screens updated
- Home: dashboard-style summary, quick actions, chore teaser, quest/achievement cards.
- Chores: card list with badges, coin value, approval cues, complete CTA pattern.
- Rewards: store-like reward cards with coin costs and redeem button state.
- Quests: dark-themed quest list cards with action CTA and progress state badge.
- Achievements: progress cards with lock/unlock status and progress bars.
- Profile: avatar/name/email/role summary with achievement count.
- Login placeholder: branded auth placeholder card.

## Asset mapping notes
- Web image-heavy surfaces were mapped to lightweight native placeholders where direct Next.js asset behavior does not apply yet.
- Coin, badge, and card styling were matched with native primitives to preserve product identity.

## Remaining visual gaps
- Exact iconography parity with web SVG/icon components.
- Full store option previews and richer quest media assets.
- Web-level confetti/achievement popup motion parity.
- Profile family-member and owned-item richness pending mobile endpoint expansion.

## Future polish ideas
- Add shared mobile icon mapping for web parity (coins, chores, quests, achievements).
- Add subtle entrance and press animations on cards/buttons.
- Add optional full-screen quest reader shell once quest playback requirements are finalized.
