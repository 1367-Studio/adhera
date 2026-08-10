# Formwise — UI/UX Design System Rules

These instructions are mandatory for all frontend work in Formwise.

Formwise is professional management software.

The interface must feel:

- professional
- mature
- calm
- structured
- consistent
- efficient
- trustworthy

The interface must NOT feel:

- AI-generated
- like a generic SaaS template
- card-heavy
- overly rounded
- playful
- decorative
- visually noisy

The primary goal is usability and consistency, not decoration.

# 1. CORE PRINCIPLE

Do not solve hierarchy by adding containers.

Before adding:

- a Card
- a Badge
- a border
- a background
- a shadow
- a rounded rectangle
- an icon container
- a hover effect

first ask whether the same hierarchy can be achieved with:

- typography
- spacing
- alignment
- whitespace
- a subtle separator

Prefer the simpler solution.

# 2. DESIGN SYSTEM FIRST

Never invent component styling locally when an equivalent shared component already exists.

Buttons, inputs, selects, dropdowns, badges, tables, cards and filters must use shared design-system components.

Avoid arbitrary values such as:

h-[38px]
h-[42px]
rounded-[11px]
rounded-[14px]
shadow-[...]
px-[13px]

unless there is a genuine layout requirement.

Prefer shared tokens and standardized variants.

If the same type of component appears differently across pages, fix the shared component or create a shared variant instead of patching individual pages.

# 3. CONTROL HEIGHTS

Interactive controls appearing together must have the same height.

This especially applies to:

- search inputs
- selects
- filters
- dropdown triggers
- buttons
- date pickers

Define and reuse standard control sizes.

Recommended:

sm: h-8
default: h-9
lg: h-10

For standard desktop management screens, prefer h-9.

Example:

[ Search................ ] [ Exercice 2026 ▾ ] [ Tous ▾ ] [ Action ]

These controls must align perfectly vertically.

Never place a 36px select beside a 40px search input unless intentionally required by the design.

# 4. BORDER RADIUS

Formwise should use restrained border radius.

Avoid excessive pill-shaped UI.

Use a small standardized radius scale.

Recommended direction:

- buttons: rounded-md
- inputs: rounded-md
- selects: rounded-md
- dropdowns: rounded-md / rounded-lg where appropriate
- table containers: rounded-lg
- cards: rounded-lg maximum in most situations
- badges: rounded-md or subtle rounded-full only when semantically appropriate

Do not randomly mix:
rounded-md
rounded-lg
rounded-xl
rounded-2xl
rounded-full

on equivalent components.

Large rounded rectangles should be rare.

# 5. BUTTONS

Use a clear hierarchy.

PRIMARY
Only for the main action of a page.

Examples:

- Ajouter
  Créer
  Enregistrer

SECONDARY
For normal secondary actions.

Examples:
Exporter
Envoyer
Télécharger

GHOST
For low-priority actions.

Examples:
row actions
navigation controls
utility actions

DESTRUCTIVE
Only for destructive operations.

Avoid having several buttons visually competing as primary actions.

Buttons of the same size must share:

- height
- radius
- horizontal padding
- icon size
- typography
- icon/text spacing

# 6. FILTER TOOLBARS

Search and filters should visually belong to the same toolbar.

They must share:

- height
- radius
- border treatment
- typography
- vertical alignment

Search can be wider but not taller.

Keep filter toolbars compact.

Avoid wrapping each filter in additional containers.

Avoid card backgrounds around filter bars unless there is a strong UX reason.

# 7. BADGES

Badges are semantic elements, not decoration.

Use badges for:

- status
- exceptional state
- role when necessary
- information requiring fast visual recognition

Do NOT turn every metadata value into a badge.

Prefer plain muted text for secondary metadata.

Keep badge sizes consistent.

Status colors must have consistent meanings throughout the application.

For example:

positive / completed → success treatment
active / primary state → primary treatment
pending → neutral/warning treatment
error / overdue → destructive treatment
inactive / exempt → neutral treatment

Do not invent new badge styles on individual pages.

# 8. CARDS

Cards must be used sparingly.

Do NOT automatically put every group of information inside a Card.

Avoid:
Card inside Card
Card for every statistic
Card for filters
Card for simple labels
Card for information that can be represented by text

Prefer flat sections with whitespace.

A page containing many cards should be considered a warning sign.

Statistics should often be presented as simple typography:

5 adhérents 14 bénévoles | 8 adultes 2 enfants

instead of four separate cards.

# 9. SHADOWS

Avoid shadows by default.

Professional management software should rely primarily on:

- spacing
- borders
- background hierarchy

not floating surfaces.

Use shadows only when elevation has semantic meaning:

- dropdown
- popover
- modal
- command palette
- floating overlay

Normal:

- tables
- cards
- toolbars
- filters
- page sections

should generally NOT have visible shadows.

# 10. HOVER STATES

Hover states should communicate interactivity, not decorate the interface.

Avoid strong hover animations.

Avoid:

- unnecessary scaling
- translate effects
- large background changes
- animated shadows
- decorative transitions

Prefer subtle:
hover:bg-muted/...
hover:text-foreground

Transitions should be short and restrained.

Do not add hover effects to non-interactive content.

# 11. ICONS

Icons should improve comprehension.

Do not add icons simply to make the UI look richer.

Avoid icons inside circles unless the circular container has a functional reason.

Standardize icon sizes.

Recommended:

- normal controls: size-4
- compact controls: size-3.5
- larger standalone actions: size-4 or size-5

Equivalent actions must use equivalent icon sizes.

# 12. TABLES

Tables are a core component of Formwise.

They should feel dense, readable and professional.

Prioritize:

- alignment
- readable typography
- consistent row height
- useful information density
- scanning speed

Avoid:

- excessive row height
- excessive badges
- card-like rows
- strong hover effects
- unnecessary icons

Use subtle separators.

Table headers should be visually distinct but restrained.

Actions should normally appear at the end of the row.

Do not visually emphasize every column equally.

# 13. PAGE STRUCTURE

Management pages should generally follow:

Page header
→ title + short contextual information
→ primary/secondary actions

Optional compact summary
→ only important metrics

Toolbar
→ search + filters

Main content
→ usually table/list

Avoid stacking multiple decorative sections before the main content.

The user's primary task should appear quickly.

# 14. SPACING

Use a consistent spacing system.

Prefer Tailwind spacing tokens.

Avoid arbitrary spacing.

Equivalent pages should use equivalent:

- page padding
- section gaps
- header spacing
- table spacing
- toolbar spacing

Do not make pages unnecessarily tall.

Formwise is an operational tool: information density is desirable when readability remains good.

# 15. TYPOGRAPHY

Use typography to create hierarchy before using containers.

Page title
→ strong

Context / count
→ muted

Section title
→ medium emphasis

Primary data
→ normal/medium

Secondary metadata
→ muted and smaller

Do not use bold text everywhere.

Do not create hierarchy primarily through colored backgrounds.

# 16. COLORS

Use existing semantic design tokens.

Do not hardcode colors when theme tokens exist.

Primary brand color should be used intentionally.

Do not make every interactive or informational element blue.

Neutral UI should remain neutral.

Color should communicate:

- action
- state
- hierarchy

not decoration.

# 17. RESPONSIVE BEHAVIOR

Consistency must remain across breakpoints.

Do not fix desktop UI by breaking tablet/mobile behavior.

Toolbars may wrap or collapse intelligently.

Tables may use existing responsive patterns.

Preserve accessibility and keyboard navigation.

# 18. DARK MODE

All shared styles must remain compatible with dark mode if dark mode is supported.

Never fix visual issues with hardcoded light-mode colors.

# 19. COMPONENT CREATION

Before creating a new component:

1. Search for an existing equivalent.
2. Check shared UI components.
3. Check existing variants.
4. Extend the shared component when appropriate.

Do not create:
MemberBadge
PaymentBadge
SubscriptionBadge
UserBadge

if they are simply variations of the same Badge component.

Prefer semantic variants in shared primitives.

# 20. CONSISTENCY RULE

Consistency is more important than making an individual screen "interesting".

If two elements have the same purpose, they should look the same throughout the application.

Same action → same component.
Same status → same badge treatment.
Same filter → same height.
Same table → same visual language.
Same page hierarchy → same spacing.

# 21. WHEN MODIFYING AN EXISTING PAGE

Before writing code:

1. Inspect the page.
2. Inspect similar pages.
3. Inspect shared UI components.
4. Identify inconsistencies.
5. Reuse the design system.
6. Then implement.

Do not blindly preserve inconsistent legacy styling.

If an inconsistency can safely be solved at the shared component level, prefer that solution.

# 22. FINAL UI REVIEW

Before considering frontend work complete, check:

- Are equivalent controls the same height?
- Are border radii consistent?
- Are button variants semantically correct?
- Are icon sizes consistent?
- Are badges actually necessary?
- Are there unnecessary Cards?
- Are there unnecessary borders?
- Are there unnecessary shadows?
- Are there unnecessary hover effects?
- Are there arbitrary Tailwind values?
- Is spacing consistent?
- Does the page feel calm?
- Is the primary user task obvious?
- Does this screen look like the same product as the other Formwise screens?

If not, simplify before finishing.

# FORM WISE VISUAL RULE

When in doubt:

REMOVE rather than ADD.

Prefer:
structure over decoration
spacing over containers
typography over badges
alignment over cards
consistency over novelty
function over visual effects
