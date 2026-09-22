# CloudPort Design Specification

This document serves as the source of truth for the CloudPort frontend design system.

## Typography

* NEVER use Inter.
* NEVER use Roboto.
* NEVER use Arial.
* NEVER use Open Sans.
* STRICTLY use Geist or Manrope.
* Maintain a consistent typography hierarchy.
* Avoid excessive bold text.

## Colors

Use a restrained professional palette.

Primary colors:

* Alabaster: `#FAF9F6`
* Slate: `#1A1A1A`
* Muted Slate: `#666666`
* Border: `#D9D6D0`

Rules:

* NEVER use purple gradients.
* NEVER use indigo gradients.
* NEVER use blue gradients.
* NEVER use rainbow gradients.
* NEVER use gradient backgrounds.
* Prefer flat, solid colors.
* Accent colors must have a functional purpose.

## Backgrounds

* Prefer solid backgrounds.
* Subtle SVG grain/noise is allowed.
* NEVER use gradients to create depth.
* NEVER use animated backgrounds.
* Avoid unnecessary decorative effects.

## Shadows

STRICTLY FORBIDDEN:

* box-shadow
* drop-shadow
* Tailwind shadow utilities

Do not use:

* `shadow-sm`
* `shadow`
* `shadow-md`
* `shadow-lg`
* `shadow-xl`
* `drop-shadow`

Use hierarchy through:

* whitespace
* typography
* borders
* contrast
* positioning

## Border Radius

Maximum radius: 4px.

Allowed:

* `rounded-sm`

Forbidden:

* `rounded-lg`
* `rounded-xl`
* `rounded-2xl`
* `rounded-3xl`

Avoid pill-shaped containers unless they represent a meaningful status/tag.

## Cards

Do not place every piece of content inside a card.

Avoid:

Card
Card
Card
Card

Use:

* whitespace
* typography
* dividers
* grids
* sections
* contextual grouping

Cards should only be used when they provide meaningful grouping.

## Layout

Avoid generic AI-generated landing-page structures.

Do not automatically use:

Hero
↓
3 Feature Cards
↓
Statistics
↓
Testimonials
↓
CTA

Design each page according to CloudPort's actual purpose.

Use:

* strong information hierarchy
* meaningful whitespace
* asymmetric layouts where appropriate
* contextual navigation
* responsive composition
* functional visual hierarchy

## Animations

Animations should improve usability.

Avoid:

* excessive fade-ins
* floating elements
* animated gradients
* constant motion
* unnecessary parallax

Prefer subtle transitions.

## Content

Remove generic AI-generated marketing language.

Avoid phrases such as:

* "Revolutionize your workflow"
* "Unlock your potential"
* "Powerful solution for modern teams"

Use copy that specifically describes CloudPort's actual functionality.

## Components

Before creating a component:

1. Search the repository.
2. Reuse an existing component where appropriate.
3. Avoid duplicate components.
4. Avoid unnecessary abstraction.
5. Keep components focused.

## Code Quality

* Follow existing project conventions.
* Do not rewrite working code unnecessarily.
* Do not introduce unnecessary dependencies.
* Remove dead code.
* Remove unused imports.
* Remove duplicated logic.
* Keep TypeScript types meaningful.
* Preserve functionality.

## Responsive Design

Every page must work properly on:

* mobile
* tablet
* desktop

Do not simply shrink desktop layouts.

## Accessibility

* Use semantic HTML.
* Provide accessible labels.
* Make interactive elements keyboard accessible.
* Provide meaningful alt text.
* Maintain readable contrast.
* Do not rely only on color to communicate state.
