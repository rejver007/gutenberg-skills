<?php
/**
 * Plugin Name: WebAula - REST- ja XML-RPC-suojaus
 * Description: Estaa kayttajatunnusten listaamisen REST API:n users-paatepisteesta, ?author=N-kyselysta ja oEmbed-vastauksesta kirjautumattomilta seka poistaa ytimen users-sivukartan. Sulkee lisaksi XML-RPC:n kokonaan, yleistaa kirjautumisen virheilmoituksen ja poistaa sovellussalasanat seka tiedostoeditorin. Lohkoeditori ja WooCommerce-nakymat toimivat kirjautuneille ennallaan, mutta sovellussalasanoja kayttavat REST-integraatiot, kuten WooCommercen mobiilisovellus, lakkaavat toimimasta ellei wp-config.phpssa maaritella WEBAULA_ALLOW_APP_PASSWORDS.
 * Version: 1.4.0
 * Author: WebAula
 *
 * @package webaula-endpoint-hardening
 */

defined( 'ABSPATH' ) || exit;

/**
 * 0) XML-RPC: kova esto heti mu-plugin-vaiheessa.
 *
 * Ensisijainen esto on .htaccessissa (Files xmlrpc.php), jolloin PHP:ta ei ajeta
 * lainkaan. Tama on varmistus sen varalle etta .htaccess korvautuu.
 *
 * Ehto luetaan XMLRPC_REQUEST-vakiosta, jonka xmlrpc.php maarittelee ennen
 * wp-load.phpta. Aiempi versio paatteli saman SCRIPT_FILENAMEsta, joka luettiin
 * ennen wp_magic_quotesia: wp_unslash poisti silloin todelliset kenoviivat, eli
 * IIS:n polku C:\inetpub\wwwroot\xmlrpc.php ei enaa tasmannyt eika esto
 * lauennut. IIS:lla ei myoskaan ole .htaccess-kerrosta johon varmistus nojaa.
 */
if ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) {
	header( 'HTTP/1.1 403 Forbidden' );
	header( 'Content-Type: text/plain; charset=utf-8' );
	exit( 'XML-RPC disabled.' );
}

/**
 * 1) /wp-json/wp/v2/users ja /wp-json/wp/v2/users/<id> vain kirjautuneille.
 *
 * /wp/v2/users/me jatetaan koskematta - se palauttaa ilman kirjautumista 401:n
 * eika listaa mitaan. Lohkoeditori ja WooCommerce toimivat normaalisti, koska
 * ne kutsuvat paatepistetta kirjautuneena.
 */
add_filter(
	'rest_endpoints',
	function ( $endpoints ) {
		if ( is_user_logged_in() ) {
			return $endpoints;
		}

		unset( $endpoints['/wp/v2/users'] );
		unset( $endpoints['/wp/v2/users/(?P<id>[\d]+)'] );

		return $endpoints;
	}
);

/**
 * 2) Estetaan ?author=N -uudelleenohjaus, joka paljastaa tunnuksen author-slugina.
 *
 * Prioriteetti 0, jotta tama ajetaan ennen WordPressin omaa redirect_canonicalia.
 * Ohjaus on 302 (wp_safe_redirectin oletus) eika 301: ehto riippuu
 * kirjautumistilasta, ja selain tallentaisi 301:n pysyvasti valimuistiin,
 * jolloin ohjaus jaisi voimaan myos kirjautuneelle.
 *
 * Ehto luetaan jasennetysta kyselysta eika $_GETista. WP_Query riisuu author-
 * arvosta kaiken paitsi [0-9,-], joten ?author=1a ja ?author=1,2 tarkoittavat
 * silti tunnusta 1, mutta numeroehto paasti ne lapi eika redirect_canonical
 * tunnista niita, koska se vaatii ^[0-9]+$. Sama koski POST-pyyntoa: WordPress
 * lukee julkiset kyselymuuttujat myos $_POSTista, ja redirect_canonical ohittaa
 * muut kuin GET-pyynnot. is_author() ilman author_nameta kattaa kaikki nama
 * muodot yhdella ehdolla, ja /author/<slug>/ -arkistot jaavat koskematta.
 */
add_action(
	'template_redirect',
	function () {
		if ( is_user_logged_in() ) {
			return;
		}

		if ( ! is_author() || '' !== get_query_var( 'author_name' ) ) {
			return;
		}

		wp_safe_redirect( home_url( '/' ) );
		exit;
	},
	0
);

/**
 * 3) Poistetaan tunnuksen paljastava author_url oEmbed-vastauksesta.
 */
add_filter(
	'oembed_response_data',
	function ( $data ) {
		unset( $data['author_url'] );

		return $data;
	}
);

/**
 * 4) Poistetaan ytimen users-sivukartta, joka listaa author-arkistojen osoitteet.
 *
 * WordPressin oma /wp-sitemap-users-1.xml tarjoaa jokaisen kirjoittajan
 * arkisto-osoitteen eli saman slugin, jonka reitit 1-3 sulkevat. SEO-lisaosa
 * korvaa ytimen sivukartan siella missa se on kaytossa; tama kattaa
 * asennukset ilman sita.
 */
add_filter(
	'wp_sitemaps_add_provider',
	function ( $provider, $name ) {
		if ( 'users' === $name ) {
			return false;
		}

		return $provider;
	},
	10,
	2
);

/**
 * 5) XML-RPC:n rajapinta, pingbackit ja niihin viittaavat vihjeet pois.
 *
 * Nama vaikuttavat myos silloin, jos xmlrpc.php ajettaisiin jotain muuta reittia:
 * yhtaan metodia ei ole tarjolla eika sivusto mainosta rajapintaa.
 */
add_filter( 'xmlrpc_enabled', '__return_false' );
add_filter( 'xmlrpc_methods', '__return_empty_array' );
add_filter( 'pings_open', '__return_false', 20 );

add_filter(
	'wp_headers',
	function ( $headers ) {
		unset( $headers['X-Pingback'] );

		return $headers;
	}
);

remove_action( 'wp_head', 'rsd_link' );

/**
 * 6) Kirjautumisen virheilmoitus ei kerro onko tunnus olemassa.
 *
 * WordPress sanoo "Tuntematon kayttajatunnus" vs "Salasana kayttajalle X on
 * vaara", eli lomake vuotaa saman tiedon jonka kohdat 1-3 sulkivat. Suodatin on
 * authenticate eika login_errors, koska wp-login.php tayttaa kayttajanimen
 * takaisin lomakkeeseen vain incorrect_passwordilla, ja koska sama ketju kattaa
 * myos WooCommercen Oma tili -lomakkeen.
 *
 * Palautettava koodi on coren oma authentication_failed ja viesti coren oma, jo
 * kaannetty merkkijono. Kaksi syyta. Oma koodi (invalid_login) jai pois
 * Wordfencen laskurista, joka laskee vain tuntemansa koodit eika sisalla
 * wp_login_failed-varalaskuria: oletusasetuksilla yksikaan IP ei siis olisi
 * koskaan lukkiutunut, ja juuri sille reitille liikenne siirtyy kun XML-RPC
 * suljetaan. Toiseksi omaan viestiin kirjoitettu suomi nakyi kaikenkielisille
 * asiakkaille, koska ilman tekstidomainia __() hakee kaannosta coren
 * katalogista eika loyda sielta omaa merkkijonoa.
 *
 * Prioriteetti on PHP_INT_MAX, jotta yritys ehtii kaikkien laskurien lapi ennen
 * kuin virhe yleistetaan. Wordfence on prioriteetilla 99, core 20 ja 99.
 */
add_filter(
	'authenticate',
	function ( $user ) {
		if ( ! is_wp_error( $user ) ) {
			return $user;
		}

		/*
		 * application_passwords_disabled* tulevat coren
		 * wp_authenticate_application_password()ista kun kohta 7 on paalla: se
		 * korvaa olemassa olevan kayttajan incorrect_passwordin, jolloin
		 * REST-kirjautuminen erottaisi olevan tunnuksen olemattomasta.
		 */
		$leaky = array(
			'invalid_username',
			'invalid_email',
			'incorrect_password',
			'application_passwords_disabled',
			'application_passwords_disabled_for_user',
		);

		if ( ! array_intersect( $leaky, $user->get_error_codes() ) ) {
			return $user;
		}

		/*
		 * Tekstidomain on default eli coren oma, mika on sama kuin domainin
		 * jattaminen pois: nain viesti tulee coren katalogista kaannettyna
		 * jokaisella kielella, ja domainin tarkistava sniff pysyy voimassa.
		 */
		return new WP_Error( 'authentication_failed', __( '<strong>Error:</strong> Invalid username, email address or incorrect password.', 'default' ) );
	},
	PHP_INT_MAX
);

/**
 * 6 b) Lomakkeen ravistus takaisin yleistetylle virheelle.
 *
 * Coren shake_error_codes ei sisalla authentication_failedia, koska core itse
 * palauttaa sen vain siina tapauksessa jossa yksikaan kasittelija ei vastannut.
 */
add_filter(
	'shake_error_codes',
	function ( $codes ) {
		$codes[] = 'authentication_failed';

		return $codes;
	}
);

/**
 * 7) Sovellussalasanat pois, jos niita ei erikseen sallita.
 *
 * Paalla oletuksena WP 5.6:sta lahtien ja ne OHITTAVAT kaksivaiheisen
 * tunnistuksen, joten 2FA:n kayttoonotto ei kata kaikkea niin kauan kuin nama
 * ovat kaytettavissa.
 *
 * Esto ei ole varaukseton. WooCommercen mobiilisovellus kirjautuu ilman
 * Jetpackia kaupan tunnuksilla luomalla sovellussalasanan, joten tama rivi
 * kirjaa kaupan yllapitajat ulos sovelluksesta, ja sama koskee muita
 * sovellussalasanoja kayttavia REST-integraatioita. Rivin poistaminen
 * tiedostosta ei ole oikea opt-out, koska seuraava asennus vie saman tiedoston
 * sellaisenaan: salliminen tehdaan wp-config.phpssa, kuten kohdassa 8.
 *
 * Tarkista ennen asennusta onko niita kaytossa:
 * wp option get using_application_passwords
 */
if ( ! defined( 'WEBAULA_ALLOW_APP_PASSWORDS' ) || ! WEBAULA_ALLOW_APP_PASSWORDS ) {
	add_filter( 'wp_is_application_passwords_available', '__return_false' );
}

/**
 * 8) Tiedostoeditori pois wp-administa.
 *
 * Ilman tata kaapattu yllapitajaistunto muokkaa teematiedostoja suoraan
 * selaimessa. Vakiopaikka on wp-config.php, mutta vakio tarkistetaan vasta
 * map_meta_cap()issa eli hyvin mu-plugin-vaiheen jalkeen, joten se toimii myos
 * taalta ja koko kovennus pysyy yhdessa tiedostossa.
 *
 * Tama ei kuitenkaan ole koodin suorituksen esto. Vakio kattaa vain edit_files,
 * edit_plugins ja edit_themes. Liitannaisen tai teeman lataaminen zippina on
 * yha auki (install_plugins, upload_plugins, install_themes), ja ne sulkee vain
 * DISALLOW_FILE_MODS, joka samalla estaa paivitykset hallintanaytolta.
 */
if ( ! defined( 'DISALLOW_FILE_EDIT' ) ) {
	// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- coren oma vakio, ei taman liitannaisen.
	define( 'DISALLOW_FILE_EDIT', true );
}
