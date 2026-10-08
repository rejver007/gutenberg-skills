# Going live

The stages before this one end when the theme validates and activates, which
is not the same as a site that is safe to leave running. Everything here
applies to every project, shop or not. `woocommerce-launch.md` adds the
shop's own items on top of this list.

## What WordPress leaves open to the public

Neither of these comes from a plugin or from anything the theme does, and
neither is touched by a rebuild. They are default WordPress behaviour, so the
same two findings return on every site that has not been hardened on purpose,
and both have an obvious fix that does not work. The numbers below are from
one batch of three live sites.

- **`/wp-json/wp/v2/users` lists the accounts to anyone.** The `slug` field is
  the author slug, which on most installs is derived from the login name, so
  the endpoint turns a password guess into a targeted one. It cannot simply be
  closed: the block editor calls it while logged in, and a blanket block breaks
  editing. Drop the `/wp/v2/users` routes in `rest_endpoints` when
  `is_user_logged_in()` is false, and leave `/users/me` alone, where an
  unauthenticated request already gets a 401.
- **That endpoint is one of four routes to the same slug.** Closing
  it alone clears the scan and leaves the leak. The next two on all three
  sites were `?author=1`, which `redirect_canonical` turns into
  `/author/<slug>/`, and the SEO plugin's `author-sitemap.xml`, which hands
  the slug to Google in a file built for crawling. The fourth is core's own
  users sitemap at `/wp-sitemap-users-1.xml`, which serves every author
  archive URL on any install where no SEO plugin has replaced it. Cancel the
  author redirect at priority 0, before `redirect_canonical` runs; set
  Yoast's `disable-author` and flush rewrites; drop `author_url` from the
  oEmbed response, which carries the slug as well; and remove the `users`
  provider through `wp_sitemaps_add_provider`. The `/author/<slug>/` archives
  themselves stay reachable by design, as ordinary public pages; where the
  SEO plugin is deployed, its `disable-author` setting is what closes them.
- **`xmlrpc_enabled` does not disable XML-RPC.** The filter only rejects the
  methods that require authentication. `pingback.ping` requires none, so the
  amplification vector stays open and the endpoint still answers.
- **Deny `/xmlrpc.php` before PHP runs, not from inside it.** A mu-plugin has
  already booted the whole of WordPress before it can refuse, and that boot is
  the resource the attack is spending: on the busiest of the three sites 131
  requests reached PHP and the slowest held a worker for 26 seconds. The same
  requests denied in `.htaccess` never start WordPress and answer in about a
  millisecond. Put the deny there, or in the CDN's WAF where it costs the
  server nothing, and keep a mu-plugin only as the layer that survives a
  replaced `.htaccess`.
- **Decide the dependency from the plugin list, never from the traffic.**
  Jetpack, the WordPress mobile app, trackbacks and some older order
  management integrations are real reasons to keep XML-RPC, and
  `wp plugin list --status=active` settles it in one line. The requests lie:
  the credential stuffing arrives with forged `Jetpack/13.0` user agents. Nor
  is any of this theoretical. August logs on the three sites held 107 269, 635
  and 69 xmlrpc requests, and the attack was still running while it was being
  investigated.
- **Expect the traffic to move to `wp-login.php`.** Closing XML-RPC removes
  the cheap door, not the attacker. Whatever rate limit or geo rule guards the
  account pages belongs on the login route too, and after this change it is
  the one that is left.

## The mu-plugin and the .htaccess block

`assets/webaula-endpoint-hardening.php` does all of the above and is the
deployment source of truth: what runs on a server is this file, byte for
byte. The current version is 1.4.0, and every version's delta is listed below,
so a diff that shows anything else is drift and a mu-plugin is a favourite
place to hide it. The three production sites are still on 1.1.0 and must
receive the updated file.

- **1.1.0** The XML-RPC hard block and the XML-RPC filters (methods,
  pingbacks and the hints that advertise them), the REST users routes, the
  author redirect block and oEmbed `author_url`.
- **1.2.0** Core's users sitemap removed, and 302 instead of 301 on the author
  redirect.
- **1.3.0** The generalised login error, application passwords off and
  `DISALLOW_FILE_EDIT`.
- **1.3.1** Coding style for WPCS, except that its `wp_unslash()` on
  `SCRIPT_FILENAME` stopped the XML-RPC hard block from matching on IIS.
- **1.4.0** The login error returns core's own code and message, so a
  brute-force counter still sees the attempt, and the two application
  password error codes are generalised too; the login form shakes again on a
  failed login; application passwords stay on only where
  `WEBAULA_ALLOW_APP_PASSWORDS` is defined in wp-config.php; the author block
  decides on the parsed query rather than on `$_GET`; the XML-RPC block reads
  `XMLRPC_REQUEST`.

It goes in `wp-content/mu-plugins/`, where it loads with
no activation step and cannot be switched off from wp-admin. On its own it is
the weaker half: pair it with the deny that runs before PHP, at the top of
`.htaccess`, inside its own markers so a plugin that rewrites the file leaves
it alone.

```apache
# BEGIN WebAula xmlrpc
<Files "xmlrpc.php">
  Deny from all
</Files>
# END WebAula xmlrpc
```

`Deny from all` is Apache 2.2 syntax, which LiteSpeed and any Apache still
loading `mod_access_compat` honour. On a plain 2.4 the equivalent is
`Require all denied`.

Verify from the access log, not from the status code, because a 403 looks the
same whichever layer produced it. The signal is the size and the time. The
mu-plugin answers with its own short body after booting WordPress; the server
answers with its own error page and never starts PHP. One host, one request,
three states: 405 in 154 ms with nothing in place, 403 in 20 ms and 17 bytes
out with the mu-plugin alone, then 403 in 1.1 ms once the deny was in
`.htaccess`. Some hosts also blank the `webroot` field when PHP never ran,
which is the clearest signal where you get it, but do not rely on it: on
another host the field stayed populated for a request the server had already
refused. The SEO plugin needs one setting of its own, which no filter
covers:

```sh
wp option patch update wpseo_titles disable-author true --format=json
wp rewrite flush
```

Rolling back is deleting the file, removing the marked block, and setting
`disable-author` to false.

## The login is what is left

Closing XML-RPC moves the traffic, it does not remove the attacker, and the
login is where it goes. Six things matter there. The asset above does three.

**The login form still answers the question the REST endpoint no longer
does.** WordPress says "Unknown username" for one case and "The password you
entered for X is incorrect" for the other, so the enumeration you closed comes
back through the form. Generalise it on `authenticate` rather than on
`login_errors`, because wp-login.php refills the username field only for
`incorrect_password` and the parsed chain is the same one WooCommerce's My
Account form goes through. Return core's own `authentication_failed` and core's
own message, not a code of your own: a security plugin counts failures by error
code, and Wordfence's list has no fallback, so an invented code silently turns
the lockout off.

**The lost-password form answers it too, and closing the login does not touch
it.** `retrieve_password()` returns `invalidcombo`, "There is no account with
that username or email address", where a real account gets a 302 to
`checkemail=confirm`; WooCommerce's own form says "Invalid username or email."
against `reset-link-sent=true`. Login timing, registration's "already
registered" and the default `display_name` in oEmbed answer it as well. Either
send unknown users to the same success URL on `lostpassword_post`, or say the
claim covers the login message only. What must not happen is a checklist item
ticked as closed while the route next to it is open.

**Application passwords bypass two-factor authentication.** They have been
available by default since 5.6 and no second-factor prompt can interrupt them,
because they are not a form login. Turning 2FA on while leaving them enabled
secures the front door and leaves the side one open. Disable them unless an
integration is using them, and check that before assuming: without Jetpack the
WooCommerce mobile app signs in by minting one, so turning them off logs shop
managers out of the app. `wp option get using_application_passwords` answers
it before the deploy, and `WEBAULA_ALLOW_APP_PASSWORDS` in wp-config.php is how
a site keeps them without editing the asset.

**WooCommerce REST keys are the third route around a second factor.** They
authenticate on `determine_current_user`, never through `authenticate`, and
they survive a password change. Anyone riding a stolen admin or shop-manager
session can mint a read/write key under Advanced, then keep reading orders and
customers, or add a webhook, while both "two-factor" and "application passwords
disabled" are ticked. Audit and revoke them as part of any incident, not just
at launch.

**The file editor lets a stolen admin session edit theme files in the browser.**
`DISALLOW_FILE_EDIT` costs one line and is worth setting, but it is not the end
of code execution: it removes `edit_files`, `edit_plugins` and `edit_themes`
only. Uploading a plugin zip still runs code, and that needs
`DISALLOW_FILE_MODS`, which also blocks updates from the dashboard. Decide
which of those two the site can live with rather than assuming the first covers
the second.

### Two-factor authentication

The sixth, and deliberately not in the asset: it needs a form, a mail
template and a flow of its own, which is more than a hardening file should
carry. One implementation worth copying lives in a WebAula theme as
`inc/two-factor.php`. A six digit code by email after the password, required
only of accounts holding `manage_options` or `manage_woocommerce` so customer
logins are untouched, a trusted device cookie bound to the password hash so
that changing the password invalidates every remembered device, and a kill
switch constant for the day mail stops flowing. That switch is not a weakness.
It is what keeps a mail outage from locking everyone out of the shop.

Two things to fix when copying it. It keys the device cookie on the first twelve
characters of the hash, which stopped working when core moved to bcrypt:
`wp_hash_password()` now returns `'$wp' . password_hash(...)`, so those twelve
characters are `$wp$2y$10$` plus two characters of salt and a password change
does not reliably revoke anything. Key on the end of the hash, as core does. And
it lives in a theme, which means this pipeline deletes it the moment it switches
the theme: a login control belongs in a mu-plugin or a site plugin.

Three things that implementation learned the hard way, and any other one will
have to learn too:

- **Hook `authenticate`, not the login form.** The first version guarded
  wp-login.php and left WooCommerce's My Account login entirely outside the
  second factor. On a shop that is not an edge case, it is how the shop
  manager signs in.
- **The field names differ.** wp-login.php posts `log` and `pwd`, Woo's form
  posts `username` and `password`, and the redirect is `redirect_to` in core
  against `redirect` in Woo. Miss the pair and you either skip the check or
  drop the destination.
- **A form cannot interrupt every login.** XML-RPC and application passwords
  authenticate without one, which is the other half of why both are closed
  above. A second factor is only as good as the routes that cannot go around
  it.

## When the front door fails

Everything above keeps someone out. These three keep the damage small once
something gets in, which is the half of hardening that a scanner report never
asks about. None of them belongs in the mu-plugin: they are server settings,
and a PHP file is the wrong place to hold them.

- **Deny PHP execution in the writable directories, and only those.**
  `wp-content/uploads` is where an upload bug lands a shell, and a cache
  directory is the other writable tree. The tempting rule is `*.php` under the
  whole of `wp-content`, and it breaks sites: some themes link PHP files from
  `/themes/` and address them directly. A block theme never does, which is why
  the theme line in the checklist is safe here and would not be on a classic
  theme. Verify the rule by making the request, not by reading it back.
  LiteSpeed does not treat `.htaccess` the way Apache does, and OpenLiteSpeed
  may ignore it entirely, so the rule that works on one host is not evidence
  about the next one. On hosts that run PHP as the site's own user, which is
  most shared hosting including cPanel, the whole account is writable and not
  just these two trees, so the rule narrows the easiest path rather than
  closing the class.
- **`disable_functions` is depth, not a sandbox, and it is not ours to set.**
  `exec`, `passthru`, `shell_exec`, `system`, `proc_open` and `popen` are what
  turns a dropped file into a running process, which is the gap that
  firewalling outbound traffic alone leaves open. All six matter, not just the
  last two: `exec( 'nohup ... &' )` keeps a process alive as well as
  `proc_open` does. But the directive is php.ini only. A `.user.ini` never
  applies it, cPanel's MultiPHP INI editor has no effect under PHP-FPM, which
  is cPanel's default, and under suPHP a docroot php.ini covers only scripts in
  that directory and not `wp-content/uploads`. None of that reports an error,
  which is how this gets ticked with nothing enforced. Ask the host to set it
  in php.ini or the FPM pool, then verify by running a script that calls
  `proc_open` and watching it fail. Check the backup plugin first, because
  several shell out to `mysqldump`. `open_basedir` is a separate control and is
  `INI_ALL`, so it can be set per site; leave `/tmp` in it unless the host has
  moved `upload_tmp_dir`, because PHP uploads go through it.
- **Close outbound traffic only after observing it.** This is the containment
  that actually defeats a command and control callback, and on a machine we do
  not own the proxy and firewall version of it is unavailable. WordPress has a
  narrower approximation in `WP_HTTP_BLOCK_EXTERNAL` with
  `WP_ACCESSIBLE_HOSTS`, which covers `wp_remote_*` and nothing else, so it
  sits next to `disable_functions` rather than instead of it. Do not switch it
  on from a guess. Log the destinations first, on `pre_http_request`, for long
  enough to cover a full cron and billing cycle, and expect the list to hold
  update servers, the payment gateway, transactional mail, webhooks, licence
  checks and scheduled jobs. On a shop that list is long, but it is
  measurable, and measuring it is the difference between containment and a
  checkout that silently stops working.

## Measures this list does not take

Each of these is common advice. They are recorded here as refused on purpose,
because the reason is not obvious and the next reader will otherwise add them.

- **Denying `/wp-json/` wholesale.** It appears in most hardening guides and
  it breaks exactly what this pipeline builds. A block theme's editing surface
  is REST: pages through `/wp/v2/pages`, templates and template parts through
  `/wp/v2/templates` and `/wp/v2/template-parts`, global styles through
  `/wp/v2/global-styles`, uploads through `/wp/v2/media`, and autosaves through
  each post type's own `autosave` route, which media does not have. Close the
  routes that leak by name, never the namespace.
- **User agent blocklists against the scraper swarm.** The bots worth stopping
  rotate agent and address per request, so there is no session to recognise
  and nothing the ban can attach to. The list costs maintenance and buys
  almost nothing.
- **fail2ban, systemd FPM sandboxing and firewall egress rules.** All three
  are sound and all three need root on a machine the client does not own.
  Where the signal is worth having anyway, the CDN is where it is reachable: a
  burst of 404s under `/wp-content/plugins/` is a vulnerability scan and not a
  visitor, and rate limiting it there costs the server nothing.

## Launch checklist

- [ ] Old→new URL parity measured on a sample of the old sitemap
- [ ] Direct HTTP access to theme `.php` denied (an ABSPATH guard returns an
      empty 200, enough to map the theme's structure; a block theme never
      needs its PHP served, so a one-line `.htaccess` closes it)
- [ ] Server and local theme trees diffed (`find | sort` both sides): a
      multi-file `scp a b host:dir/` lands every file in one directory, and
      the stray copies are what the next reader edits
- [ ] Author slug closed on all four routes: `/wp/v2/users`, `?author=1`, the
      SEO plugin's author sitemap and core's users sitemap (closing the REST
      endpoint alone clears the scan and leaves the leak; the
      `/author/<slug>/` archives themselves remain reachable by design, and
      the SEO plugin's `disable-author` covers them where it is deployed)
- [ ] `/xmlrpc.php` denied before PHP runs, in `.htaccess` or the WAF
      (`xmlrpc_enabled` leaves `pingback.ping`, and a mu-plugin has booted
      WordPress before it can refuse)
- [ ] Login errors generalised on `authenticate`, returning core's own
      `authentication_failed` so a security plugin still counts the failure
- [ ] Lost password decided: either unknown accounts sent to the same success
      URL, or the claim narrowed, because `retrieve_password()` and Woo's own
      form both still name a missing account
- [ ] Application passwords disabled, or `WEBAULA_ALLOW_APP_PASSWORDS` set with
      a note saying which integration needs them (`wp option get
      using_application_passwords` answers it, and the WooCommerce app is the
      one that breaks)
- [ ] `DISALLOW_FILE_EDIT` set, and a decision recorded on
      `DISALLOW_FILE_MODS`, which is what actually stops a plugin upload
- [ ] WooCommerce REST keys and webhooks listed, and anything unexplained
      revoked: they authenticate on `determine_current_user` and go around both
      the second factor and the application password switch
- [ ] Two-factor on every account that can manage the site or the shop, and the
      implementation outside the theme so switching the theme cannot remove it
- [ ] Rate limit at the CDN on login POSTs, not only on the `wp-login.php` path:
      Woo's handler runs on `wp_loaded` for every request, so `login`,
      `username`, `password` and `woocommerce-login-nonce` posted to any URL is
      a login attempt that never touches the login page
- [ ] Registration settings deliberate: `users_can_register`, Woo's My Account
      registration and its checkout registration each answer a different
      question, and open registration with the default role is how spam
      accounts arrive
- [ ] PHP execution denied in `wp-content/uploads` and in any cache directory,
      and the rule verified by making the request rather than by reading it
      back
- [ ] `disable_functions` requested from the host in php.ini or the FPM pool,
      then verified by a script that calls `proc_open` and fails (a `.user.ini`
      cannot set it, and nothing reports that it did not), or a note naming the
      plugin that needs one of them
- [ ] `open_basedir` confirmed to hold the account, with `/tmp` still in it
      unless the host has moved `upload_tmp_dir`
- [ ] Outbound HTTP either left open deliberately or closed after a logged
      inventory, never closed from a guess
- [ ] 404 bursts under `/wp-content/plugins/` rate limited at the CDN, in the
      same place as the login rule
- [ ] SEO plugin active, sitemap responding
- [ ] Analytics/tag manager container carried over, gated to the production host
      so staging never pollutes production data
- [ ] Consent banner present before any tracking fires
- [ ] Staging closed to the public if it holds real customer data
- [ ] Absolute staging URLs converted in post content
- [ ] Search engines unblocked
