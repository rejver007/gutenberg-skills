<?php
/**
 * Asset loading.
 *
 * @package agency-site
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The style.css file is registered so WordPress recognises the theme, not
 * because it carries styles. Add a versioned file here only when a rule
 * genuinely cannot be expressed in theme.json.
 */
function agency_site_enqueue_assets() {
	wp_enqueue_style(
		'agency-site-style',
		get_stylesheet_uri(),
		array(),
		wp_get_theme()->get( 'Version' )
	);
}
add_action( 'wp_enqueue_scripts', 'agency_site_enqueue_assets' );
