#!/usr/bin/env node
/**
 * design-system.json  ->  a WordPress block theme skeleton
 *
 *   node tools/scaffold-theme.mjs --input design-system.json --out theme/ [--force]
 *
 * The structure is the one gutenberg-native-blocks prescribes. Retyping it per
 * project is where style.css headers, pattern registration and template part
 * wiring get re-derived, and re-derived boilerplate is where the bugs are.
 *
 * Block markup here is deliberately the minimum a theme needs to render:
 * a header part, a main region, a footer part. The designed sections are
 * authored later against gutenberg-block-authoring. Every construct used below
 * is taken from that skill's serialised examples.
 *
 * No runtime dependencies, same reason as build-theme-json.mjs.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildThemeJson, serialize } from "./build-theme-json.mjs";
import { lintDesignSystem } from "./lint-design-system.mjs";

// Seeded once, never overwritten, --force included. Stage 5 authors the front
// page and CLAUDE.md accumulates lessons by hand, so a rerun must not flatten
// either.
const SEED_FILES = new Set(["templates/front-page.html", "CLAUDE.md"]);

/** agency-site -> agency_site, for PHP function prefixes */
function phpPrefix(textDomain) {
  return textDomain.replace(/-/g, "_");
}

/** For a PHP single-quoted string literal. Backslash first, then the quote. */
function phpSingleQuote(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** For HTML text and attribute values. */
function htmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A star-slash pair in a name would close the style.css header and the PHP
// docblocks early, leaving the rest of the name as stray source text.
function commentSafe(value) {
  return value.replace(/\*\//g, "* /");
}

function styleCss(meta) {
  return `/*
Theme Name: ${commentSafe(meta.name)}
Text Domain: ${meta.textDomain}
Requires at least: ${meta.wpVersion}
Tested up to: ${meta.wpVersion}
Requires PHP: 8.0
Version: 0.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
*/

/*
 * Deliberately empty. The design system lives in theme.json.
 * Anything added here is a rule fighting block markup, which the house rules
 * treat as a maintenance liability. Reach for a theme.json preset or a block
 * style variation first.
 */
`;
}

function functionsPhp(meta) {
  const prefix = phpPrefix(meta.textDomain);
  return `<?php
/**
 * ${commentSafe(meta.name)} theme setup.
 *
 * @package ${meta.textDomain}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once get_template_directory() . '/inc/enqueue.php';
require_once get_template_directory() . '/inc/menus.php';
require_once get_template_directory() . '/inc/cpt.php';

/**
 * Theme supports. Most block theme features come from theme.json, so this
 * stays short on purpose.
 */
function ${prefix}_setup() {
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'editor-styles' );
	add_theme_support( 'post-thumbnails' );
	load_theme_textdomain( '${meta.textDomain}', get_template_directory() . '/languages' );
}
add_action( 'after_setup_theme', '${prefix}_setup' );

/**
 * Register the block pattern category patterns/ files are filed under.
 *
 * The pattern files themselves are discovered by WordPress automatically from
 * the patterns/ directory, so nothing here needs updating when one is added.
 */
function ${prefix}_pattern_category() {
	register_block_pattern_category(
		'${meta.textDomain}',
		array( 'label' => __( '${phpSingleQuote(meta.name)}', '${meta.textDomain}' ) )
	);
}
add_action( 'init', '${prefix}_pattern_category' );
`;
}

function enqueuePhp(meta) {
  const prefix = phpPrefix(meta.textDomain);
  return `<?php
/**
 * Asset loading.
 *
 * @package ${meta.textDomain}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The style.css file is registered so WordPress recognises the theme, not
 * because it carries styles. Add a versioned file here only when a rule
 * genuinely cannot be expressed in theme.json.
 */
function ${prefix}_enqueue_assets() {
	wp_enqueue_style(
		'${meta.textDomain}-style',
		get_stylesheet_uri(),
		array(),
		wp_get_theme()->get( 'Version' )
	);
}
add_action( 'wp_enqueue_scripts', '${prefix}_enqueue_assets' );
`;
}

function menusPhp(meta) {
  const prefix = phpPrefix(meta.textDomain);
  return `<?php
/**
 * Navigation menus.
 *
 * @package ${meta.textDomain}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Block themes use the Navigation block, which stores its own menu. This
 * registration exists for classic menu locations that plugins still expect.
 */
function ${prefix}_menus() {
	register_nav_menus(
		array(
			'primary' => __( 'Primary', '${meta.textDomain}' ),
			'footer'  => __( 'Footer', '${meta.textDomain}' ),
		)
	);
}
add_action( 'init', '${prefix}_menus' );
`;
}

function cptPhp(meta) {
  const prefix = phpPrefix(meta.textDomain);
  return `<?php
/**
 * Custom post types.
 *
 * @package ${meta.textDomain}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * No custom post types yet. Register them here rather than in a plugin only if
 * they are genuinely part of the theme. Content that must survive a theme
 * change belongs in a plugin.
 *
 * Example:
 *
 * register_post_type(
 *     'service',
 *     array(
 *         'label'        => __( 'Services', '${meta.textDomain}' ),
 *         'public'       => true,
 *         'has_archive'  => true,
 *         'show_in_rest' => true,
 *         'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt' ),
 *     )
 * );
 */
function ${prefix}_post_types() {
	// Intentionally empty.
}
add_action( 'init', '${prefix}_post_types' );
`;
}

// Parts render inside the element the template-part block's tagName declares,
// so the wrappers here stay divs. A header group in the part would nest
// <header> inside <header> on every page.
function headerPart() {
  return `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"}} -->
<div class="wp-block-group">
<!-- wp:site-title /-->

<!-- wp:navigation {"overlayMenu":"mobile"} /-->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
`;
}

/** The preset slugs the footer wants, checked against what the doc defines. */
function footerPresets(doc) {
  return {
    dark: doc.palette.some((entry) => entry.slug === "dark"),
    surface: doc.palette.some((entry) => entry.slug === "surface"),
    small: doc.typography.fontSizes.some((entry) => entry.slug === "small")
  };
}

// A schema-valid design system may lack the slugs the footer would reference,
// and a dangling slug fails the repo's own validator. Each reference degrades
// to plain markup when its preset is missing.
function footerPart(doc) {
  const presets = footerPresets(doc);

  const attrs = [];
  if (presets.dark) attrs.push('"backgroundColor":"dark"');
  if (presets.surface) attrs.push('"textColor":"surface"');
  attrs.push('"layout":{"type":"constrained"}');

  const classes = ["wp-block-group"];
  if (presets.surface) classes.push("has-surface-color");
  if (presets.dark) classes.push("has-dark-background-color");
  if (presets.surface) classes.push("has-text-color");
  if (presets.dark) classes.push("has-background");

  const sizeAttr = presets.small ? ',"fontSize":"small"' : "";
  const sizeClass = presets.small ? " has-small-font-size" : "";

  return `<!-- wp:group {${attrs.join(",")}} -->
<div class="${classes.join(" ")}">
<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}${sizeAttr}} -->
<p class="has-text-align-center${sizeClass}">${htmlEscape(doc.meta.name)}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
`;
}

// No "theme" attribute on purpose. WordPress resolves the part file only when
// that attribute equals the theme directory name, which nothing here controls,
// so theme files omit it and core injects the right value at template load.
function templatePart(slug, area) {
  const tag = area === "uncategorized" ? "div" : area;
  return `<!-- wp:template-part {"slug":"${slug}","tagName":"${tag}","area":"${area}"} /-->`;
}

function wrapTemplate(main) {
  return `${templatePart("header", "header")}

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
${main}
</main>
<!-- /wp:group -->

${templatePart("footer", "footer")}
`;
}

function indexTemplate() {
  return wrapTemplate(
    `<!-- wp:query {"queryId":1,"query":{"perPage":10,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":true}} -->
<div class="wp-block-query">
<!-- wp:post-template -->
<!-- wp:post-title {"isLink":true,"level":2} /-->

<!-- wp:post-excerpt /-->
<!-- /wp:post-template -->

<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->

<!-- wp:query-pagination-numbers /-->

<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination -->

<!-- wp:query-no-results -->
<!-- wp:paragraph -->
<p>No posts found.</p>
<!-- /wp:paragraph -->
<!-- /wp:query-no-results -->
</div>
<!-- /wp:query -->`
  );
}

function frontPageTemplate() {
  return wrapTemplate(
    `<!-- wp:paragraph -->
<p>Front page sections are authored as patterns and placed here. Keep every
section a core block, and register anything that repeats.</p>
<!-- /wp:paragraph -->`
  );
}

function pageTemplate() {
  return wrapTemplate(
    `<!-- wp:post-title {"level":1} /-->

<!-- wp:post-content {"layout":{"type":"constrained"}} /-->`
  );
}

function singleTemplate() {
  return wrapTemplate(
    `<!-- wp:post-title {"level":1} /-->

<!-- wp:post-date /-->

<!-- wp:post-content {"layout":{"type":"constrained"}} /-->`
  );
}

function patternsReadme(meta) {
  return `# Patterns

WordPress discovers every \`.php\` file in this directory automatically. A
pattern file needs this header and nothing else. The blank line between the
doc comment and the closing tag is not decoration: WPCS fails the file without
it.

\`\`\`php
<?php
/**
 * Title: Hero
 * Slug: ${meta.textDomain}/hero
 * Categories: ${meta.textDomain}
 *
 * @package ${meta.textDomain}
 */

?>
<!-- wp:cover ... -->
\`\`\`

House rules that apply to every file here:

- Core blocks only. A custom block is a last resort, and it costs a build step
  plus a deprecation every time the markup changes.
- Colours, font sizes and spacing reference theme.json preset slugs. No hex.
- Anything appearing on more than one page belongs here rather than being
  rebuilt per page.
`;
}

function claudeMd(doc, paths = {}) {
  const input = paths.input ?? "design-system.json";
  const themeJson = paths.themeJson ?? "theme.json";
  const colours = doc.palette.map((c) => `| \`${c.slug}\` | ${c.name} | ${c.color} |`);
  const sizes = doc.typography.fontSizes.map((s) => `| \`${s.slug}\` | ${s.size} |`);
  // The pipes are escaped because a bare | inside a GFM table cell splits the
  // cell, code span or not.
  const spacing = doc.spacing.spacingSizes.map(
    (s) => `| \`${s.slug}\` | ${s.size} | \`var:preset\\|spacing\\|${s.slug}\` |`
  );

  return `# ${doc.meta.name}

Conventions for this theme. Append every hard won lesson so the next session
starts smarter.

## Generated files, do not hand edit

\`theme.json\` is generated from \`design-system.json\`. Change the design system
and regenerate:

\`\`\`sh
node tools/build-theme-json.mjs --input "${input}" --out "${themeJson}"
\`\`\`

\`--check\` fails if the two have drifted apart.

## Colour presets

| Slug | Name | Value |
|---|---|---|
${colours.join("\n")}

Brand colour is for buttons, key accents and at most one CTA band. It is not a
section surface. Alternate \`surface\` and \`neutral\` for section backgrounds.

## Type scale

| Slug | Size |
|---|---|
${sizes.join("\n")}

## Spacing scale

| Slug | Size | Reference |
|---|---|---|
${spacing.join("\n")}

Section rhythm: default \`${doc.styles.sectionRhythm.default}\`, tight
\`${doc.styles.sectionRhythm.tight}\`, loose \`${doc.styles.sectionRhythm.loose}\`.

## Layout

Content ${doc.layout.contentSize}, wide ${doc.layout.wideSize}.

## Registered patterns

None yet. This file is maintained by hand from stage 5 onward, and each
registered pattern gets a row here.

## Lessons

- Long Finnish and Swedish compounds carry manual \`&shy;\` soft hyphens. Never
  automatic word break.
- Paste generated markup into the Code editor view and save without flipping to
  visual first.
`;
}

/**
 * @param {object} doc a design-system.json document
 * @param {{input?: string, themeJson?: string}} [paths] what CLAUDE.md's
 *   regeneration command names, generic defaults keep the output deterministic
 * @returns {Map<string, string>} relative path to file contents, insertion ordered
 */
export function scaffoldFiles(doc, paths = {}) {
  const meta = doc.meta;
  const files = new Map();

  files.set("style.css", styleCss(meta));
  files.set("theme.json", serialize(buildThemeJson(doc)));
  files.set("functions.php", functionsPhp(meta));
  files.set("inc/enqueue.php", enqueuePhp(meta));
  files.set("inc/menus.php", menusPhp(meta));
  files.set("inc/cpt.php", cptPhp(meta));
  files.set("parts/header.html", headerPart());
  files.set("parts/footer.html", footerPart(doc));
  files.set("templates/index.html", indexTemplate());
  files.set("templates/front-page.html", frontPageTemplate());
  files.set("templates/page.html", pageTemplate());
  files.set("templates/single.html", singleTemplate());
  files.set("patterns/README.md", patternsReadme(meta));
  files.set("assets/.gitkeep", "");
  files.set("CLAUDE.md", claudeMd(doc, paths));

  return files;
}

function isNonEmptyDir(path) {
  return existsSync(path) && readdirSync(path).length > 0;
}

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") args.input = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--force") args.force = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.input || !args.out) {
    throw new Error("usage: scaffold-theme.mjs --input <file> --out <dir> [--force]");
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);

  if (isNonEmptyDir(args.out) && !args.force) {
    process.stderr.write(
      `${args.out} is not empty. Pass --force to overwrite, after checking what is there.\n`
    );
    return 1;
  }

  const doc = JSON.parse(readFileSync(args.input, "utf8"));

  for (const warning of lintDesignSystem(doc).warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  const presets = footerPresets(doc);
  if (!presets.dark) {
    process.stderr.write('warning: palette has no "dark", the footer part omits its background\n');
  }
  if (!presets.surface) {
    process.stderr.write('warning: palette has no "surface", the footer part omits its text colour\n');
  }
  if (!presets.small) {
    process.stderr.write('warning: font sizes have no "small", the footer part omits its font size\n');
  }

  const files = scaffoldFiles(doc, {
    input: args.input,
    themeJson: `${args.out.replace(/[\\/]+$/, "")}/theme.json`
  });

  let written = 0;
  for (const [name, contents] of files) {
    const target = join(args.out, name);
    if (SEED_FILES.has(name) && existsSync(target)) {
      process.stdout.write(`kept ${name} (authored content)\n`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    written += 1;
  }

  process.stdout.write(`wrote ${written} files to ${args.out}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
