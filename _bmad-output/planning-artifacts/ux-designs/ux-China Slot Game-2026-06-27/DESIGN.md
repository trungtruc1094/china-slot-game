---
name: Hi-Lo Tevi Wallet UX
description: Ornate in-game Stars wallet surfaces for deposit and manual cashout inside the Hi-Lo Telegram Mini App.
status: final
sources:
  - _bmad-output/planning-artifacts/prds/prd-china-slot-game-2026-06-01/tevi-integration-addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
  - imports/README.md
updated: 2026-06-27
colors:
  modal-velvet: '#0E1728'
  modal-velvet-deep: '#08101F'
  modal-border-gold: '#B88632'
  modal-gold: '#D8A84C'
  modal-gold-bright: '#F2D37A'
  modal-gold-dark: '#7C4C17'
  modal-cream: '#F5E3B2'
  text-primary: '#F8E7B8'
  text-secondary: '#C8B78A'
  text-muted: '#8D8067'
  field-surface: '#121A2A'
  field-border: '#9A6A2B'
  field-focus: '#F2D37A'
  success: '#4BE33D'
  warning: '#F2D37A'
  error: '#D95C4A'
  scrim: '#000000'
  hud-teal: '#0C7D70'
  hud-teal-dark: '#083E3A'
typography:
  modal-title:
    fontFamily: 'Vollkorn'
    fontSize: 44px
    fontWeight: '700'
    lineHeight: '1.05'
    letterSpacing: '0'
  modal-title-compact:
    fontFamily: 'Vollkorn'
    fontSize: 34px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: '0'
  modal-subtitle:
    fontFamily: 'Vollkorn'
    fontSize: 26px
    fontWeight: '500'
    lineHeight: '1.25'
    letterSpacing: '0'
  label:
    fontFamily: 'Vollkorn'
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.3'
    letterSpacing: '0.04em'
  body:
    fontFamily: 'Vollkorn'
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.35'
    letterSpacing: '0'
  numeric:
    fontFamily: 'Vollkorn'
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: '0'
  cta:
    fontFamily: 'Vollkorn'
    fontSize: 27px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: '0'
  footnote:
    fontFamily: 'Vollkorn'
    fontSize: 15px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: '0'
rounded:
  sm: 6px
  md: 10px
  lg: 18px
  ornament: 24px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '7': 32px
  '8': 40px
  modal-gutter: 20px
  modal-section-gap: 28px
  preset-gap: 10px
components:
  wallet-modal:
    background: '{colors.modal-velvet}'
    border: '{colors.modal-border-gold}'
    title: '{typography.modal-title}'
    subtitle: '{typography.modal-subtitle}'
    radius: '{rounded.ornament}'
  amount-preset:
    background: '{colors.field-surface}'
    border: '{colors.field-border}'
    selected-background: '{colors.modal-gold-dark}'
    selected-border: '{colors.modal-gold-bright}'
    text: '{colors.modal-gold-bright}'
    typography: '{typography.numeric}'
    radius: '{rounded.sm}'
  amount-input:
    background: '{colors.field-surface}'
    border: '{colors.field-border}'
    focus-border: '{colors.field-focus}'
    text: '{colors.text-primary}'
    placeholder: '{colors.text-muted}'
    typography: '{typography.body}'
    radius: '{rounded.sm}'
  primary-cta:
    background: '{colors.modal-gold}'
    foreground: '#111111'
    border: '{colors.modal-gold-dark}'
    typography: '{typography.cta}'
    radius: '{rounded.md}'
  status-note:
    success: '{colors.success}'
    warning: '{colors.warning}'
    error: '{colors.error}'
    typography: '{typography.footnote}'
---

## Brand & Style

The Tevi wallet UX belongs inside the existing Hi-Lo game fantasy, not on top of it as a generic payment form. The screenshots establish the visual contract: dark navy ornamental panels, gold serif display type, bevelled gold action buttons, hard-edged amount presets, and the dimmed game surface behind the modal.

Deposit and Cash Out should feel like serious value-bearing game actions. The surfaces can be ornate, but the information must stay exact: selected amount, custom amount, received amount, fee, pending state, success/failure, and blocked reasons need to be readable immediately. The product should feel like a game modal with banking-grade clarity, not a banking page pasted into a game.

## Colors

- **Modal Velvet (`#0E1728`)** is the main panel body. It carries the same dark blue/black fantasy tone visible in the screenshots and keeps payment actions visually grounded.
- **Modal Gold (`#D8A84C`)** is the primary action and border language. Use it for active affordances, frames, and CTA surfaces.
- **Bright Gold (`#F2D37A`)** is reserved for selected presets, focus rings, and high-attention numeric values. It should not be used as a broad background.
- **Modal Cream (`#F5E3B2`)** supports subtitles and readable body text when gold would be too loud.
- **Success Green (`#4BE33D`)** is allowed for short status notes like `1% withdrawal fee applies` or success confirmation. Use sparingly; it should never become the dominant palette.
- **Error Red (`#D95C4A`)** appears only for blocked/failed states and must be paired with text.
- **HUD Teal (`#0C7D70`)** remains a background game-token color, not a payment modal accent.

Avoid adding new bright colors to payment states. The modal already has high visual richness; state color should clarify, not decorate.

## Typography

Use the existing game serif direction. `Vollkorn` is the repository-backed typeface and should be the default for payment modal headings, numeric amounts, and CTAs.

- Modal titles use `{typography.modal-title}` on standard mobile height and `{typography.modal-title-compact}` when the Telegram Mini App chrome leaves less vertical space.
- Labels such as `SELECT AMOUNT` use `{typography.label}` with modest tracking. Keep letter spacing positive but not wide enough to harm legibility.
- Amounts use `{typography.numeric}`. Numeric text must align visually across preset buttons and custom amount fields.
- Body and validation copy use `{typography.body}` or `{typography.footnote}`. Do not set small legal/fee text below 15px on mobile.

## Layout & Spacing

Payment modals are centered over the dimmed game surface and must fit inside the Telegram Mini App viewport without hiding the primary CTA below the fold.

- Use `{spacing.modal-gutter}` as the minimum side margin inside the modal.
- Amount presets are a single row when width allows; if localization or viewport width breaks fit, wrap to two rows rather than shrink text below legibility.
- Keep sections in this order: title, instruction, preset group, custom amount row, primary CTA, trust/fee note, status message when present.
- Cash Out adds a receive calculation row. Deposit does not need a receive row unless Tevi returns a non-1:1 conversion later.
- Modal content should never obscure the Telegram top chrome or the bottom HUD permanently. Dimming the background is acceptable; hiding affordances behind the modal is not.

## Elevation & Depth

Depth is theatrical but controlled:

- Use a high-opacity scrim over the game surface for focus.
- Use bevelled gold borders and ornamental corners for the modal shell.
- Primary CTA may have a bevel/depth treatment; secondary controls should stay flat or outlined.
- Avoid stacked modals. Tevi SDK confirmation is external and should be represented as a pending state when control returns.

## Shapes

Payment controls use the current game shape language: squared fantasy panels with softened corners, not pill buttons.

- Presets use `{rounded.sm}`.
- Inputs use `{rounded.sm}`.
- CTA uses `{rounded.md}` with bevelled ends if the existing art supports it.
- Modal container uses `{rounded.ornament}` plus corner ornamentation where available.
- Close button remains circular because the current screenshot establishes that control.

## Components

- **Wallet modal shell**: `wallet-modal` component. Title, subtitle, ornamental divider, body sections, close control. Same shell for Deposit and Cash Out.
- **Amount preset**: `amount-preset` component. Tap selects amount and populates custom amount field. Selected state must be visible beyond color where possible: stronger border, filled background, or pressed bevel.
- **Amount input**: `amount-input` component. Numeric-only entry. Prefix icon may use the Star coin symbol from the screenshots. Placeholder is descriptive: `Enter amount`.
- **Receive field**: Cash Out only. Read-only calculated field. Shows amount after fee, e.g. selected amount minus 1% withdrawal fee. Empty until the input is valid.
- **Primary CTA**: `primary-cta`. `DEPOSIT NOW` or `CASH OUT NOW`. Disabled state must look unavailable, not just dimmed text.
- **Status note**: `status-note`. Deposit uses trust copy such as `Secure & Encrypted`; Cash Out uses fee copy such as `1% withdrawal fee applies`. Blocked states use explicit error text.
- **HUD deposit entry**: bottom HUD button using the existing game button treatment. It opens Deposit modal, not a browser page.
- **Cash Out entry**: should be available from wallet/menu context and any wallet detail surface. If added to the HUD, it must not crowd Deposit or Menu.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep Deposit and Cash Out visually sibling surfaces | Make Cash Out look like an unrelated bank form |
| Use Stars terminology everywhere | Mix coins, points, fiat, and Stars labels |
| Show exact fee and receive amount before cashout submit | Hide fee until after submit |
| Disable CTA with a clear reason when blocked | Let users tap a disabled-looking CTA with no feedback |
| Preserve the game background under a dim scrim | Navigate away to a plain payment page for game-owned steps |
| Treat Tevi SDK confirmation as external/pending | Credit wallet or mark cashout succeeded from client callback alone |
| Use screenshots as visual references | Treat screenshots as the source of truth for backend behavior |
