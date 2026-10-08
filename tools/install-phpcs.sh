#!/usr/bin/env bash
# Install PHP_CodeSniffer with the WordPress standard outside the repo, so npm
# stays the only dependency manager a contributor has to set up.
#
# CI and CONTRIBUTING.md both call this script rather than each carrying their
# own copy of the sequence. The copies had already drifted: the documented one
# started at `composer config`, which stops with "File ./composer.json cannot be
# found" on a clean machine, and `require` without the plugin allowance leaves
# the WordPress standard unregistered.
set -e

DIR="${1:-/tmp/phpcs}"
mkdir -p "$DIR"

# config and require both need a composer.json to already exist.
[ -f "$DIR/composer.json" ] || composer -d "$DIR" init \
  --no-interaction --name=webaula/phpcs

composer -d "$DIR" config --no-interaction \
  allow-plugins.dealerdirect/phpcodesniffer-composer-installer true

composer -d "$DIR" require --no-interaction --quiet --dev \
  "squizlabs/php_codesniffer:^3.9" "wp-coding-standards/wpcs:^3.1"

echo "phpcs installed: $DIR/vendor/bin/phpcs"
