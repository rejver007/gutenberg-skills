import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateMarkup, validateTheme, RULES } from "../tools/validate-blocks.mjs";

const themeDir = fileURLToPath(
  new URL("../examples/agency-site/expected/theme", import.meta.url)
);
const cliPath = fileURLToPath(new URL("../tools/validate-blocks.mjs", import.meta.url));
const themeJson = JSON.parse(readFileSync(new URL(`file://${themeDir}/theme.json`)));

function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function rulesIn(findings) {
  return [...new Set(findings.map((f) => f.rule))];
}

// Each rule gets a fixture that must fail and one that must pass. The passing
// fixture has to clear every other rule too, which is the point: a rule that
// only works in isolation is not a rule.
for (const rule of RULES) {
  test(`${rule}: the failing fixture reports it`, () => {
    const result = validateMarkup(fixture(`${rule}-fail`), { themeJson, label: rule });
    const reported = rulesIn([...result.errors, ...result.warnings]);
    assert.equal(reported.includes(rule), true, `expected ${rule}, got ${reported.join(", ")}`);
  });

  test(`${rule}: the passing fixture is clean`, () => {
    const result = validateMarkup(fixture(`${rule}-pass`), { themeJson, label: rule });
    assert.deepEqual(result.errors, [], `errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.warnings, [], `warnings: ${JSON.stringify(result.warnings)}`);
  });
}

test("a raw hex is caught in both the delimiter and the inline style", () => {
  const { errors } = validateMarkup(fixture("no-raw-hex-fail"), { themeJson });
  assert.equal(errors.filter((e) => e.rule === "no-raw-hex").length, 2);
});

test("soft-hyphen-hint warns rather than blocks", () => {
  const result = validateMarkup(fixture("soft-hyphen-hint-fail"), { themeJson });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings[0].rule, "soft-hyphen-hint");
});

test("a rule can be skipped per project", () => {
  const result = validateMarkup(fixture("soft-hyphen-hint-fail"), {
    themeJson,
    skip: ["soft-hyphen-hint"]
  });
  assert.deepEqual(result.warnings, []);
});

test("preset-slugs-exist degrades to a warning without a theme.json", () => {
  const result = validateMarkup(fixture("preset-slugs-exist-fail"), { themeJson: null });
  assert.deepEqual(
    result.errors.filter((e) => e.rule === "preset-slugs-exist"),
    []
  );
  assert.equal(rulesIn(result.warnings).includes("preset-slugs-exist"), true);
});

test("structural failures from the vendored parser are reported", () => {
  // style.typography.color does not exist in Gutenberg. The parser knows that,
  // and no house rule would: it is valid markup carrying a nonexistent
  // attribute, which is exactly the split between the two layers.
  const result = validateMarkup(
    '<!-- wp:paragraph {"style":{"typography":{"color":"red"}}} -->\n<p>Hei</p>\n<!-- /wp:paragraph -->',
    { themeJson }
  );
  assert.equal(rulesIn(result.errors).includes("upstream"), true);
  assert.match(result.errors[0].message, /style\.typography\.color/);
});

test("the scaffolded example theme validates", () => {
  const result = validateTheme(themeDir);
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors, null, 2));
  assert.equal(result.fileCount > 0, true);
});

test("a theme without a buildability report warns that stage 1 may be skipped", () => {
  const { warnings } = validateTheme(themeDir);
  assert.equal(rulesIn(warnings).includes("buildability-report"), true);
});

test("--report points the gate check at a report that lives elsewhere", () => {
  const report = fileURLToPath(
    new URL("../examples/agency-site/input/buildability-report.md", import.meta.url)
  );
  const { warnings } = validateTheme(themeDir, [], report);
  assert.equal(rulesIn(warnings).includes("buildability-report"), false);
});

test("the authored patterns validate, not just the scaffold", () => {
  const { errors, fileCount } = validateTheme(themeDir);
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(fileCount >= 11, true, `only ${fileCount} markup files found`);
});

test("--theme exits 0 on the example and prints a summary", () => {
  const result = runCli(["--theme", themeDir]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
});

test("--file exits 1 on a failing fixture", () => {
  const path = fileURLToPath(new URL("./fixtures/no-raw-hex-fail.html", import.meta.url));
  const result = runCli(["--file", path]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no-raw-hex/);
});

test("--json emits machine readable findings a model can act on", () => {
  const path = fileURLToPath(new URL("./fixtures/no-raw-hex-fail.html", import.meta.url));
  const result = runCli(["--file", path, "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.errors.length > 0, true);
  assert.equal(typeof parsed.errors[0].message, "string");
  assert.equal(typeof parsed.errors[0].rule, "string");
});

test("an unknown rule id is refused rather than silently ignored", () => {
  const result = runCli(["--theme", themeDir, "--skip-rule", "no-such-rule"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown rule/);
});

test("a bogus overlayColor is reported against the palette", () => {
  const markup =
    '<!-- wp:cover {"overlayColor":"drak","isUserOverlayColor":true} -->\n' +
    '<div class="wp-block-cover"><div class="wp-block-cover__inner-container"></div></div>\n' +
    "<!-- /wp:cover -->";
  const { errors } = validateMarkup(markup, { themeJson });
  const preset = errors.filter((e) => e.rule === "preset-slugs-exist");
  assert.equal(preset.length, 1, JSON.stringify(errors));
  assert.match(preset[0].message, /color preset "drak"/);
});

test("a custom fontSize length is not mistaken for a preset slug", () => {
  const markup =
    '<!-- wp:paragraph {"style":{"typography":{"fontSize":"13px"}}} -->\n' +
    '<p style="font-size:13px">Pieni teksti</p>\n' +
    "<!-- /wp:paragraph -->";
  const result = validateMarkup(markup, { themeJson });
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, []);
});

test("no-dashes catches an em dash inside a block attribute", () => {
  // The escape keeps the character itself out of this repo's own source.
  const markup =
    '<!-- wp:navigation-link {"label":"Palvelut \u2014 hinnat","url":"/palvelut"} /-->';
  const { errors } = validateMarkup(markup, { themeJson });
  assert.equal(rulesIn(errors).includes("no-dashes"), true, JSON.stringify(errors));
});

test("--file with --theme runs the preset check at error level", () => {
  const path = fileURLToPath(new URL("./fixtures/preset-slugs-exist-fail.html", import.meta.url));
  const result = runCli(["--file", path, "--theme", themeDir]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^error.*\[preset-slugs-exist\]/m);
});

test("--file alone degrades the preset check to a warning", () => {
  const path = fileURLToPath(new URL("./fixtures/preset-slugs-exist-fail.html", import.meta.url));
  const result = runCli(["--file", path]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^warn.*\[preset-slugs-exist\]/m);
});

test("--report without --theme is refused as a parse error", () => {
  const path = fileURLToPath(new URL("./fixtures/no-raw-hex-pass.html", import.meta.url));
  const result = runCli(["--file", path, "--report", "somewhere.md"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--report/);
});

test("--report alongside --file is refused, single-file runs never read it", () => {
  const path = fileURLToPath(new URL("./fixtures/no-raw-hex-pass.html", import.meta.url));
  const result = runCli(["--file", path, "--theme", themeDir, "--report", "somewhere.md"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--report/);
});

test("the missing theme.json warning honours the skip list", () => {
  const bareThemeDir = fileURLToPath(new URL("./fixtures/bare-theme", import.meta.url));

  const unskipped = validateTheme(bareThemeDir);
  assert.equal(rulesIn(unskipped.warnings).includes("preset-slugs-exist"), true);

  const skipped = validateTheme(bareThemeDir, ["preset-slugs-exist"]);
  assert.equal(rulesIn(skipped.warnings).includes("preset-slugs-exist"), false);
});

test("the buildability report warning honours the skip list", () => {
  const skipped = validateTheme(themeDir, ["buildability-report"]);
  assert.equal(rulesIn(skipped.warnings).includes("buildability-report"), false);
});

test("--skip-rule buildability-report is a known rule id", () => {
  const result = runCli(["--theme", themeDir, "--skip-rule", "buildability-report"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.includes("buildability-report"), false);
});

test("validateMarkup reports whether block schemas are active", () => {
  const result = validateMarkup(fixture("no-raw-hex-pass"), { themeJson });
  assert.equal(typeof result.hasSchemas, "boolean");
});

test("the report says when block schemas are not loaded", () => {
  // A GUTENBERG_DIR that cannot exist makes the outcome machine independent.
  const env = { GUTENBERG_DIR: fileURLToPath(new URL("./fixtures/no-such-dir", import.meta.url)) };

  const human = runCli(["--theme", themeDir], env);
  assert.match(human.stdout, /block schemas: not loaded \(set GUTENBERG_DIR\)/);

  const machine = runCli(["--theme", themeDir, "--json"], env);
  assert.equal(JSON.parse(machine.stdout).hasSchemas, false);
});

test("the block count comes from the parse tree, not from a delimiter regex", () => {
  // Three real blocks: a Group holding two Paragraphs. The vendor's own count
  // stops at the top level and would say one.
  const markup = [
    '<!-- wp:group -->',
    '<div class="wp-block-group">',
    '<!-- wp:paragraph --><p>yksi</p><!-- /wp:paragraph -->',
    '<!-- wp:paragraph --><p>kaksi</p><!-- /wp:paragraph -->',
    '</div>',
    '<!-- /wp:group -->'
  ].join("\n");

  assert.equal(validateMarkup(markup, { themeJson }).blockCount, 3);
});

test("a delimiter the parser rejects is not counted as a block", () => {
  // No space between the block name and its attributes. A regex looking for
  // "<!-- wp:" counts two blocks here; the parser finds one, and so does the
  // editor, which shows the rest as classic content.
  const markup = [
    '<!-- wp:paragraph --><p>yksi</p><!-- /wp:paragraph -->',
    '<!-- wp:paragraph{"fontSize":"small"} --><p>kaksi</p><!-- /wp:paragraph -->'
  ].join("\n");

  assert.equal(validateMarkup(markup, { themeJson }).blockCount, 1);
});

test("the checked line reports the files and the blocks behind it", () => {
  const result = runCli(["--theme", themeDir]);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const line = result.stdout.split("\n").find((l) => l.startsWith("checked:"));
  assert.ok(line, "no checked: line in the output");

  const [, files, blocks] = line.match(/checked: (\d+) files, (\d+) blocks/) ?? [];
  assert.equal(Number(files), validateTheme(themeDir).fileCount);
  assert.equal(Number(blocks), validateTheme(themeDir).blockCount);
  assert.ok(Number(blocks) > Number(files), "a theme has more blocks than files");
});
