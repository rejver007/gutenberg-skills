# Contributing

## House rules

These apply to everything in the repo, including its own prose and code
comments. `tests/skills.test.mjs` enforces the dash rule on authored text and
code files by extension (md, mjs, cjs, json, sh, html, php, yml, yaml, css,
txt), with the generated zip packages in `dist/`, the vendored upstream
sources and the deliberately failing fixtures in `tests/fixtures/` excluded.

- No em dashes or en dashes. Use commas, periods, or restructure.
- 24-hour time. 14:00, not 2 PM.
- Client copy is never translated. Finnish stays Finnish.
- Long Finnish and Swedish compounds take a manual `&shy;`, never automatic
  word break.
- Generated files are not hand edited. Change the input and regenerate.

## Running things

```sh
npm install
npm test
```

108 tests, no WordPress installation needed. The one check no script covers is
activating a generated theme in a real WordPress 7.0 install, which stays
manual and belongs in the pull request description.

## Coding standards for the PHP

`npm test` does not cover the PHP. The repo ships one asset that runs on
client servers and generates four files into every scaffolded theme, and both
are held to the WordPress Coding Standards. `phpcs.xml.dist` carries the
configuration, including what is excluded and why.

CI installs the standard outside the repo so that npm stays the only
dependency manager to set up. One script does it, and CI calls the same one, so
these instructions cannot drift from what CI actually runs. Locally, once:

```sh
./tools/install-phpcs.sh /tmp/phpcs
```

Then from the repo root:

```sh
/tmp/phpcs/vendor/bin/phpcs
```

It reads `phpcs.xml.dist` with no arguments. `phpcbf` fixes the mechanical
findings, but read its diff: it reformats, it does not judge.

An exclusion goes in `phpcs.xml.dist` with a reason beside it, never as a flag
in the CI command where the next reader cannot see it.

## Adding a validator rule

1. Add the id to `RULES` in `tools/validate-blocks.mjs`. The order of that array
   is the order findings are reported in.
2. Write the rule function next to the others. Return an array of
   `{ rule, level, message }`. `level` is `"error"` or `"warn"`. Warn is the
   right level for anything that guesses.
3. Register it in the `houseRules` map inside `validateMarkup`.
4. Add two fixtures: `tests/fixtures/<id>-fail.html` and `<id>-pass.html`. The
   loop in `tests/validate-blocks.test.mjs` picks them up automatically.
5. The passing fixture has to clear every other rule too. A rule that only works
   in isolation is not a rule.
6. Document it in the README table and in the stage 6 table of
   `skills/gutenberg-design-migration/SKILL.md`.

Rules that detect a character should reference it by code point rather than
embedding it. `String.fromCodePoint(0x2014)` reads in review, an invisible
character does not, and it keeps the rule from tripping the repo-wide check for
its own target.

## Changing the design system schema

`schemas/design-system.schema.json` is a contract other things read. Bump
`meta.schemaVersion` on any breaking change, so a stale `design-system.json`
fails loudly instead of generating a subtly wrong theme.

JSON Schema cannot see cross references. Anything of the form "this slug must
exist in that list" belongs in `tools/lint-design-system.mjs`.

After changing the schema or either generator, regenerate the example and commit
the result:

```sh
node tools/scaffold-theme.mjs --input examples/agency-site/input/design-system.json --out examples/agency-site/expected/theme --force
```

The scaffold treats `templates/front-page.html` and `CLAUDE.md` as seed files
and keeps the existing ones even with `--force`, so authored content in them
survives regeneration.

## Regenerating dist

```sh
./make-dist.sh
```

Needs `zip`. CI fails if `dist/` is out of date with `skills/`.

## Vendored code

Do not patch house rules into `tools/vendor/`. That directory is upstream's
code, and keeping it pristine is what makes the next update a copy rather than a
merge. Modifications that are genuinely unavoidable go in `tools/UPSTREAM.md`
with a `VENDOR PATCH` comment at the site.

## Line endings

`.gitattributes` pins `eol=lf`. The generators compare files byte for byte, and
without this a fresh clone on Windows fails `--check` on a file nobody touched.
