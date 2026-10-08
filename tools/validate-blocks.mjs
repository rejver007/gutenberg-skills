#!/usr/bin/env node
/**
 * Block markup validation: the upstream structural checks plus the WebAula
 * house rules.
 *
 *   node tools/validate-blocks.mjs --file page.html
 *   node tools/validate-blocks.mjs --file page.html --theme theme/
 *   node tools/validate-blocks.mjs --theme theme/
 *   node tools/validate-blocks.mjs --theme theme/ --json
 *   node tools/validate-blocks.mjs --theme theme/ --skip-rule soft-hyphen-hint
 *
 * Structural validation is delegated to tools/vendor/validate-blocks.cjs, which
 * parses with the same parser WordPress core uses. Everything added here is a
 * project convention that the parser has no opinion about: a hex value is valid
 * markup, it just fragments the design system.
 *
 * Exit code is 1 when any error is reported. Warnings do not fail.
 *
 * The --json form exists so a model can read its own validation failures and
 * fix them without a human relaying the output.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const upstream = require("./vendor/validate-blocks.cjs");

const MARKUP_DIRS = ["templates", "parts", "patterns"];

/** Block delimiters carry a JSON payload. Hex belongs in theme.json, not here. */
const DELIMITER = /<!--\s*\/?wp:[^]*?-->/g;
const INLINE_STYLE = /style="([^"]*)"/g;
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;

export const RULES = [
  "no-raw-hex",
  "preset-slugs-exist",
  "no-absolute-position",
  "no-dashes",
  "soft-hyphen-hint"
];

function stripPhpHeader(source) {
  const end = source.indexOf("?>");
  return end === -1 ? source : source.slice(end + 2);
}

/**
 * Blocks the parser actually found, nested ones included.
 *
 * Matching an opening delimiter with a regex counted anything shaped like one,
 * a delimiter the parser rejects included, and the vendor's own blockCount
 * counts only the top level while its checks recurse past it. The number next
 * to "checked:" exists to prove a run looked at something, so it has to come
 * from the same tree the checks walked.
 */
function countParsedBlocks(blocks) {
  let total = 0;
  for (const block of blocks ?? []) {
    // The parser emits the whitespace between blocks as a nameless entry.
    if (!block.blockName) continue;
    total += 1 + countParsedBlocks(block.innerBlocks);
  }
  return total;
}

function ruleNoRawHex(markup) {
  const found = [];

  for (const delimiter of markup.match(DELIMITER) ?? []) {
    for (const hex of delimiter.match(HEX) ?? []) {
      found.push(`block attributes carry the raw value ${hex}`);
    }
  }

  let match;
  INLINE_STYLE.lastIndex = 0;
  while ((match = INLINE_STYLE.exec(markup)) !== null) {
    for (const hex of match[1].match(HEX) ?? []) {
      found.push(`an inline style carries the raw value ${hex}`);
    }
  }

  return found.map((message) => ({
    rule: "no-raw-hex",
    level: "error",
    message: `${message}. Reference a theme.json preset slug instead.`
  }));
}

function collectPresetReferences(markup) {
  const refs = [];
  const push = (kind, slug) => refs.push({ kind, slug });
  // style.typography.fontSize carries custom lengths like "13px" that the
  // fontSize pattern also matches, so digit-leading values are skipped for
  // font sizes only. Colour attributes never legally carry a length, so their
  // slugs are checked even when they start with a digit.
  const pushAttr = (kind, slug) => {
    if (kind === "font-size" && /^\d/.test(slug)) return;
    push(kind, slug);
  };

  for (const [, kind, slug] of markup.matchAll(
    /var:preset\|(color|spacing|font-size|font-family)\|([a-z0-9-]+)/g
  )) {
    push(kind, slug);
  }
  // gradient is left out: default WordPress gradients are active, so gradient
  // slugs cannot be checked against the palette.
  for (const [, slug] of markup.matchAll(
    /"(?:backgroundColor|textColor|overlayColor|borderColor|iconColor)":"([a-z0-9-]+)"/g
  )) {
    pushAttr("color", slug);
  }
  for (const [, slug] of markup.matchAll(/"fontSize":"([a-z0-9-]+)"/g)) {
    pushAttr("font-size", slug);
  }
  for (const [, slug] of markup.matchAll(/"fontFamily":"([a-z0-9-]+)"/g)) {
    pushAttr("font-family", slug);
  }
  return refs;
}

function themePresets(themeJson) {
  const settings = themeJson?.settings ?? {};
  return {
    color: new Set((settings.color?.palette ?? []).map((entry) => entry.slug)),
    spacing: new Set((settings.spacing?.spacingSizes ?? []).map((entry) => entry.slug)),
    "font-size": new Set((settings.typography?.fontSizes ?? []).map((entry) => entry.slug)),
    "font-family": new Set((settings.typography?.fontFamilies ?? []).map((entry) => entry.slug))
  };
}

function rulePresetSlugsExist(markup, themeJson) {
  if (!themeJson) {
    return [
      {
        rule: "preset-slugs-exist",
        level: "warn",
        message:
          "no theme.json in scope, so preset slugs could not be checked. Use --theme to enable this rule."
      }
    ];
  }

  const presets = themePresets(themeJson);
  const seen = new Set();
  const out = [];

  for (const { kind, slug } of collectPresetReferences(markup)) {
    const key = `${kind}|${slug}`;
    if (seen.has(key) || presets[kind].has(slug)) continue;
    seen.add(key);
    out.push({
      rule: "preset-slugs-exist",
      level: "error",
      message: `references the ${kind} preset "${slug}", which theme.json does not define. Known: ${[...presets[kind]].join(", ") || "none"}`
    });
  }
  return out;
}

function ruleNoAbsolutePosition(markup) {
  const out = [];
  for (const [, value] of markup.matchAll(/position"?\s*:\s*"?\s*(absolute|fixed)/gi)) {
    out.push({
      rule: "no-absolute-position",
      level: "error",
      message: `position: ${value.toLowerCase()} is not expressible in core blocks. Flatten the section instead.`
    });
  }
  return out;
}

// Escapes, not literals. A rule that detects a character should not be the
// reason a repo-wide check for that character fails, and an invisible
// character in source is unreadable in review either way.
const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);
const SOFT_HYPHEN_CHAR = String.fromCodePoint(0x00ad);

function ruleNoDashes(markup) {
  // Scans the raw markup, block delimiters included: a dash inside a block
  // attribute, a navigation label or an image alt, ships to the front end
  // all the same.
  const out = [];
  if (markup.includes(EM_DASH)) {
    out.push({
      rule: "no-dashes",
      level: "error",
      message: "the markup contains an em dash, block attributes included. House style is commas, periods, or a restructured sentence."
    });
  }
  if (markup.includes(EN_DASH)) {
    out.push({
      rule: "no-dashes",
      level: "error",
      message: "the markup contains an en dash, block attributes included. House style is commas, periods, or a restructured sentence."
    });
  }
  return out;
}

const PROMINENT_TEXT =
  /<h[1-6][^>]*>([^]*?)<\/h[1-6]>|<a[^>]*class="[^"]*wp-block-button__link[^"]*"[^>]*>([^]*?)<\/a>/g;

function ruleSoftHyphenHint(markup) {
  const out = [];
  const reported = new Set();

  for (const match of markup.matchAll(PROMINENT_TEXT)) {
    const inner = (match[1] ?? match[2] ?? "").replace(/<[^>]*>/g, " ");
    for (const token of inner.split(/\s+/)) {
      if (token.includes("&shy;") || token.includes(SOFT_HYPHEN_CHAR)) continue;
      // Entities are not letters a reader sees, so measure without them.
      const letters = token.replace(/&[a-z]+;/g, "x").replace(/[^A-Za-zÀ-ɏ]/g, "");
      if (letters.length < 15 || reported.has(letters)) continue;
      reported.add(letters);
      out.push({
        rule: "soft-hyphen-hint",
        level: "warn",
        message: `"${token}" is long enough to wrap badly in a heading or button. Finnish and Swedish compounds take a manual &shy; at the sensible break point.`
      });
    }
  }
  return out;
}

/**
 * @param {string} markup serialized block markup
 * @param {object} [options]
 * @param {string} [options.label] shown in messages
 * @param {object} [options.themeJson] parsed theme.json, enables preset-slugs-exist
 * @param {string[]} [options.skip] rule ids to leave out
 * @returns {{errors: object[], warnings: object[], hasSchemas: boolean}}
 */
export function validateMarkup(markup, options = {}) {
  const { label = "markup", themeJson = null, skip = [] } = options;
  const findings = [];

  const structural = upstream.validateMarkup(markup, label);
  for (const finding of structural.errors ?? []) {
    findings.push({
      rule: "upstream",
      level: finding.level === "warn" ? "warn" : "error",
      message: finding.msg
    });
  }

  const houseRules = {
    "no-raw-hex": () => ruleNoRawHex(markup),
    "preset-slugs-exist": () => rulePresetSlugsExist(markup, themeJson),
    "no-absolute-position": () => ruleNoAbsolutePosition(markup),
    "no-dashes": () => ruleNoDashes(markup),
    "soft-hyphen-hint": () => ruleSoftHyphenHint(markup)
  };

  for (const rule of RULES) {
    if (skip.includes(rule)) continue;
    findings.push(...houseRules[rule]());
  }

  for (const finding of findings) finding.file = label;

  return {
    errors: findings.filter((f) => f.level === "error"),
    warnings: findings.filter((f) => f.level === "warn"),
    blockCount: countParsedBlocks(structural.parsed),
    hasSchemas: upstream.loadBlockSchemas()
  };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (extname(entry.name) === ".html" || extname(entry.name) === ".php") out.push(full);
  }
  return out;
}

function markupFiles(themeDir) {
  const out = [];
  for (const dir of MARKUP_DIRS) {
    const full = join(themeDir, dir);
    if (existsSync(full)) walk(full, out);
  }
  return out.sort();
}

/**
 * @param {string} themeDir a scaffolded theme directory
 * @param {string[]} [skip]
 */
export function validateTheme(themeDir, skip = [], reportPath = null) {
  const themeJsonPath = join(themeDir, "theme.json");
  const themeJson = existsSync(themeJsonPath)
    ? JSON.parse(readFileSync(themeJsonPath, "utf8"))
    : null;

  const errors = [];
  const warnings = [];

  if (!themeJson && !skip.includes("preset-slugs-exist")) {
    warnings.push({
      rule: "preset-slugs-exist",
      level: "warn",
      file: themeDir,
      message: "theme.json is missing, so preset slugs could not be checked."
    });
  }

  // The stage 1 gate is the cheapest step in the pipeline and the easiest to
  // skip under deadline pressure, so its absence is worth saying out loud.
  const report = reportPath ?? join(themeDir, "buildability-report.md");
  if (!existsSync(report) && !skip.includes("buildability-report")) {
    warnings.push({
      rule: "buildability-report",
      level: "warn",
      file: themeDir,
      message: `no buildability report at ${report}. Stage 1 of the migration pipeline may have been skipped. Point --report at it if it lives elsewhere.`
    });
  }

  const files = markupFiles(themeDir);
  let blockCount = 0;

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const markup = extname(file) === ".php" ? stripPhpHeader(raw) : raw;
    const label = relative(themeDir, file).split(sep).join("/");
    const result = validateMarkup(markup, { label, themeJson, skip });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    blockCount += result.blockCount;
  }

  return {
    errors,
    warnings,
    fileCount: files.length,
    blockCount,
    hasSchemas: upstream.loadBlockSchemas()
  };
}

function parseArgs(argv) {
  const args = { json: false, skip: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--theme") args.theme = argv[++i];
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--skip-rule") args.skip.push(argv[++i]);
    else if (argv[i] === "--report") args.report = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.file && !args.theme) {
    throw new Error(
      "usage: validate-blocks.mjs (--file <file> [--theme <dir>] | --theme <dir> [--report <file>]) [--json] [--skip-rule <id>]"
    );
  }
  if (args.report && (!args.theme || args.file)) {
    throw new Error("--report is only read by a full --theme run. Drop --report or the --file argument.");
  }
  // buildability-report is not a markup rule, but its warning is skippable.
  const skippable = [...RULES, "buildability-report"];
  for (const rule of args.skip) {
    if (!skippable.includes(rule)) {
      throw new Error(`unknown rule: ${rule}. Known: ${skippable.join(", ")}`);
    }
  }
  return args;
}

function report(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.errors.length > 0 ? 1 : 0;
  }

  process.stdout.write(
    result.hasSchemas
      ? "block schemas: active\n"
      : "block schemas: not loaded (set GUTENBERG_DIR)\n"
  );

  for (const finding of result.errors) {
    process.stdout.write(`error  ${finding.file}  [${finding.rule}] ${finding.message}\n`);
  }
  for (const finding of result.warnings) {
    process.stdout.write(`warn   ${finding.file}  [${finding.rule}] ${finding.message}\n`);
  }

  // Printed before the verdict: a run that matched no files, or files with no
  // blocks in them, otherwise reports PASSED exactly like a real one.
  const scope =
    result.fileCount === undefined
      ? `${result.blockCount} blocks`
      : `${result.fileCount} files, ${result.blockCount} blocks`;
  process.stdout.write(`checked: ${scope}
`);

  const summary = `${result.errors.length} errors, ${result.warnings.length} warnings`;
  process.stdout.write(result.errors.length === 0 ? `PASSED: ${summary}\n` : `FAILED: ${summary}\n`);
  return result.errors.length > 0 ? 1 : 0;
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.file) {
    const raw = readFileSync(args.file, "utf8");
    const markup = extname(args.file) === ".php" ? stripPhpHeader(raw) : raw;
    // With --theme alongside, the file is checked against that theme.json and
    // preset-slugs-exist reports at error level instead of degrading to warn.
    let themeJson = null;
    if (args.theme) {
      const themeJsonPath = join(args.theme, "theme.json");
      themeJson = existsSync(themeJsonPath)
        ? JSON.parse(readFileSync(themeJsonPath, "utf8"))
        : null;
    }
    return report(
      validateMarkup(markup, { label: args.file, themeJson, skip: args.skip }),
      args.json
    );
  }

  return report(validateTheme(args.theme, args.skip, args.report ?? null), args.json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
