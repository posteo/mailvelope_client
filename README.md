# Roundcube plugin to use Mailvelope's OpenPGP-support

This plugin makes Roundcube webmail <http://roundcube.net/> use the client-API
of Mailvelope <https://www.mailvelope.com/> in order to create handle OpenPGP
emails. It's useful only for users that have Mailvelope
installed in their browser. Users without Mailvelope won't note any difference.


## Requirements

Confirmed to be working with Roundcube v1.0.x.


## Install

To use the plugin drop the code into Roundcube's plugins-folder and enable it
in Roundcube's config. E.g.:

    cd $roundcube/plugins
    git clone git://github.com/posteo/mailvelope_client
    vim ../config/config.inc.php


## Contribution

Any contribution is welcome! Feel free to open an issue or do a pull request at
github.com.

