---
name: gutenberg-design-migration
description: Turn an approved design into a working WordPress block theme, in six stages with a checkable artifact between each one. Use this skill when the user wants a design built in WordPress, migrated to Gutenberg, converted into a block theme, scaffolded from a design system, or when an existing design needs flattening before it can be built. Also use it whenever design-system.json, theme.json generation, theme scaffolding, or block markup validation comes up. It sequences the other two Gutenberg skills rather than repeating them.
---

# Gutenberg Design Migration

A design and a working block theme are separated by six steps. Doing them as one
large prompt works for an experienced operator and produces nothing anyone can
check. This skill splits them, and puts a named file between each pair, so a
stage can be rerun, diffed and reviewed on its own.

```
design + design system
  |
  1 audit          model      -> buildability-report.md
  2 extract        model      -> design-system.json
  3 scaffold       script     -> theme/ + theme.json
  4 map sections   model      -> section-map.md
  5 author markup  model      -> templates/, parts/, patterns/
  6 validate       script     -> pass, or a list of failures
```

Stages 3 and 6 are scripts because their inputs have a fixed shape. The rest is
judgement, but each one still lands in a file.

## Which skill does what

| Skill | Its job here |
|---|---|
| `gutenberg-native-blocks` | What maps to what. The section-to-block vocabulary, the anti-pattern list, the house rules. Consult it during stages 1, 2 and 4. |
| `gutenberg-block-authoring` | How markup serialises. Per-block attribute schemas, class order, style property order. **Consult it for anything containing `<!-- wp:`.** Getting these wrong triggers "Attempt Block Recovery" and the client sees a broken page. |
| This skill | The sequence, the gate, and the commands. |

Do not author serialized markup from this skill alone.

**If the target is a WooCommerce shop rather than a brochure site, read
`references/woocommerce-launch.md` before stage 3.** The six stages end when the
theme validates and activates; that file is what a real catalogue needs after
that: block behaviour that is invisible in the markup, the caching layers that
make correct code look broken, importing a real product feed, taking over a live
domain, and the verification discipline that keeps one round from becoming five.
Half of it changes decisions made in the scaffold.

**Whatever the target, read `references/launch.md` before the site goes
live.** A theme that validates and activates is not yet a site that is safe to
leave running, and the two findings every scanner reports are WordPress
defaults that no rebuild touches.

**If an existing site is being replaced rather than a new one built, read
`references/content-migration.md` after stage 5.** The six stages produce an
empty theme; that file is how the old site's pages get into it: reading a page
builder through the REST API, walking its widgets into core blocks, and the
four things that come out wrong by default. Hand rebuilding a few hundred pages
is where a migration loses a week.

## Stage 1: buildability audit

Walk the design against the anti-pattern list in `gutenberg-native-blocks`:
absolute positioning, overlapping elements, diagonal masks, heavy custom CSS
over blocks, `:has()` state styling, automatic word-break on Finnish and Swedish
compounds.

Write `buildability-report.md`. One row per finding:

| Section | Anti-pattern | Recommended flattening | Cost if kept |
|---|---|---|---|

**Hard gate: no markup is authored until every blocker is either flattened in
the design or explicitly accepted with a written cost.**

This is the highest value step in the pipeline and the easiest to skip. It moves
the discovery of an unbuildable design from halfway through the build, with the
client already expecting the mockup they signed off, to minute one. Skipping it
does not save the hour it appears to save.

A cost is written, not implied. "Accepted: one brand coloured band, and if a
second appears the restraint rule is broken" is a cost. "Client wants it" is not.

Worked examples: `examples/agency-site/input/buildability-report.md` for a
design that passes, `examples/legacy-redesign/buildability-report.md` for one
that does not.

### Flattening mode

For a design produced before the Gutenberg constraint was stated, the same stage
produces a rewritten section list with each unbuildable construct replaced by
its nearest buildable equivalent, plus a short note to send back to the designer.
The common cases and their flattened forms:

| Construct | Flatten to |
|---|---|
| Card overlapping a hero edge | Cover with the card as an inner Group, inside the Cover rather than across its boundary |
| Absolutely positioned badge | An inline element at the start of the heading, or its own line above it |
| Diagonal `clip-path` mask | A flat colour band, or a background SVG on a Cover |
| `:has()` selected state | A sibling selector (`input:checked ~ label`) or a JS toggled class |
| `overflow-wrap: anywhere` on headings | Remove it, and add manual `&shy;` at compound boundaries |

## Stage 2: design system extraction

Fill `design-system.json` against `schemas/design-system.schema.json`. Ask for
the design system alongside the design whenever a design is commissioned, rather
than reverse engineering it from a mockup afterwards.

Rules:

- Semantic palette slugs only: `primary`, `dark`, `surface`, `neutral`, `ink`,
  `muted`. Every extra colour is one more an editor can pick wrongly, and the
  linter warns about each one. Body text is `ink` and never `text`: a palette
  slug named `text` makes WordPress emit `.has-text-color` with `!important`,
  which collides with the marker class every coloured block already carries
  and overrides half the palette.
- Snap measured values to the nearest spacing preset. Do not add a preset to fit
  a measurement. If a value genuinely cannot snap, that is a design question.
- Brand colour is buttons, key accents, and at most one CTA band. Never a
  section surface. This is the single biggest modernisation lever on a dated
  site.
- Colour references outside `palette` are slugs. The schema rejects hex there,
  which is what turns the house rule into a failure rather than a memory.
- `layout.rootPadding` is optional and takes a CSS length. The generator turns
  it into root padding with root-padding-aware alignments, so `alignfull`
  sections still bleed to the viewport edge while their content keeps a gutter.

Check both the shape and the cross references. The schema cannot see that
`"primayr"` does not exist:

```bash
node tools/lint-design-system.mjs design-system.json
```

The linter exits 1 on errors such as a dangling reference and prints warnings,
palette drift among them, to stderr. A clean run means the document is
internally consistent.

## Stage 3: scaffold

```bash
node tools/scaffold-theme.mjs --input design-system.json --out theme/
```

Fifteen files: `theme.json`, `style.css`, `functions.php`, `inc/`, `parts/`,
`templates/`, `patterns/`, `assets/`, and a `CLAUDE.md` seeded with the actual
preset slugs.

Review the generated `theme.json` against the design system. **Do not hand edit
it.** Fix `design-system.json` and regenerate. A hand edit puts the theme and its
design system out of sync with no signal, which is the failure `--check` exists
to catch:

```bash
node tools/build-theme-json.mjs --input design-system.json --out theme/theme.json --check
```

An existing directory is refused unless `--force` is passed. `--force`
rewrites the generated files but preserves `templates/front-page.html` and
`CLAUDE.md`, the two authored seed files, so regenerating after a design
system change does not discard sections written in stage 5.

## Stage 4: section mapping

Write `section-map.md`. One row per design section:

| Design section | Core block | Target file | Repeats |
|---|---|---|---|

This table is the build plan. Nothing gets authored that is not on it.

Use the vocabulary from `gutenberg-native-blocks` verbatim: full-width section
with background is Cover or Group with `alignfull`, card grid is Columns, image
beside text is Media & Text, FAQ is Details, dynamic listings are Query Loop,
repeated cards are registered Patterns, header and footer are Template Parts.

Anything appearing more than once becomes a registered Pattern. A pattern costs
nothing extra to register and the second landing page always arrives, so the
threshold for registering one is low.

Worked example: `examples/agency-site/input/section-map.md`.

## Stage 5: markup authoring

Delegate serialization to `gutenberg-block-authoring`. Its per-block sections
carry the exact attribute schemas, required marker classes, class order and
style property order.

House rules on top of whatever that skill says:

- Colours, font sizes and spacing reference preset slugs, never hex.
- Class names are what WordPress generates plus registered `is-style-*`
  variations. A custom class needs a stylesheet rule that actually exists.
- Fewer attributes means fewer validation failure points.
- Long Finnish and Swedish compounds carry manual `&shy;` at the compound
  boundary. Never automatic word break.
- No em dashes or en dashes in copy. Time is 24-hour.
- Copy language is untouched. Finnish stays Finnish.
- Paste into the Code editor view and save without flipping to visual first.
  Visual editors reflow pasted markup.

## Stage 6: validation and delivery

```bash
node tools/validate-blocks.mjs --theme theme/
```

`--file page.html` validates a single file instead, and passing `--file`
together with `--theme` checks that one file against the theme's presets.

Structural checks come from the vendored WordPress parser: delimiter mismatches,
invalid attribute JSON, style attributes that do not exist, and the generated
`wp-block-*` class being present where it belongs and absent where
`supports.className` is false. That last check belongs to the parser, not to a
house rule. `supports.className` governs only the generated class, while a
custom class is governed by `supports.customClassName`, which core leaves true
on paragraph and list-item.

On top of those, five house rules, each with an id that `--skip-rule` accepts:

| Rule | Level | Fails on |
|---|---|---|
| `no-raw-hex` | error | a hex value in block attributes or an inline style |
| `preset-slugs-exist` | error | a preset slug theme.json does not define |
| `no-absolute-position` | error | `position: absolute` or `fixed` |
| `no-dashes` | error | an em dash or en dash in copy |
| `soft-hyphen-hint` | warn | a long compound in a heading or button with no `&shy;` |

One warning sits outside the table and takes `--skip-rule` the same way:
`buildability-report`, raised when no buildability report is found. With no
theme.json in scope, `preset-slugs-exist` degrades to a warning under its own
id rather than checking nothing silently.

`--json` emits the findings as structured data, which is the form to use when
fixing your own markup: read the failures, fix, rerun, without a human relaying
the output.

If the buildability report lives with the pipeline inputs rather than in the
theme directory, point at it so the stage 1 gate check passes:

```bash
node tools/validate-blocks.mjs --theme theme/ --report input/buildability-report.md
```

### Delivery checklist

The list from `gutenberg-native-blocks`, plus the two lines this pipeline adds:

- [ ] Every designed section names the core block it maps to
- [ ] No absolute positioning, overlaps, or diagonal masks anywhere
- [ ] `design-system.json` validates against the schema
- [ ] theme.json contains the full design system, and `--check` passes
- [ ] Repeated sections are registered Patterns
- [ ] Brand colour used as accent, not surface
- [ ] `validate-blocks.mjs --theme` exits 0
- [ ] Long compound words carry `&shy;` at sensible break points
- [ ] Copy language untouched, no em dashes, 24-hour time
- [ ] **Manual:** the theme activates in WordPress and every page opens in the
      editor with no block recovery prompt

That last line is not optional and no script covers it. The validator checks
serialization, not WordPress. Markup that validates can still belong to a theme
that does not activate.

## Stage 7: existing content

Only when an existing site is being replaced. See
`references/content-migration.md`: reading the old site through the REST API,
walking page builder widgets into core blocks, the four conversions that come
out wrong by default, and importing idempotently with a slug rename map.

Converted markup goes through stage 6 like anything else. Run the validator
again after the import, not only after authoring.

## Stage 8: shop, data and going live

Only when the target is a WooCommerce shop. See
`references/woocommerce-launch.md`: WooCommerce block behaviour, caching,
catalogue import, slug parity when replacing a live site, the design faults that
only appear in production, and the two launch items the shop adds to the
general list.

## Going live

Every project, shop or not. See `references/launch.md`: the checklist that
outlives the theme, and the two endpoints WordPress leaves open to anyone by
default, which are the findings a security scan returns the week after launch.
`assets/webaula-endpoint-hardening.php` is the mu-plugin that closes them,
and the file explains why it is only half of the fix. The same reference
covers what to do when the front door fails, which is server configuration
rather than anything a theme or a mu-plugin can carry.

This is not numbered as a stage because it produces no artifact the next stage
consumes. It is the last thing done, and skipping it is invisible until
somebody scans the site.

## What this pipeline does not do

- Parse design HTML into blocks automatically. Design output is not structurally
  stable, and the interesting decisions (Cover or Group, repeated enough to be a
  Pattern) are judgement calls, not parsing.
- Scaffold custom blocks. Each one means a build step, an edit.js, a save.js and
  a deprecation every time markup changes. Use a Pattern of core blocks first.
  A custom block is a last resort, and stage 1 is where its cost gets written
  down.
