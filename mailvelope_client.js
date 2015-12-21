function MailvelopeClient(debug) {

  //
  // "Classes"
  //

  this.Display = function(ciphertext) {
    var ciphertext = ciphertext;
    var ciphertextelem = '#messagebody > .message-part';
    var plaintext_id = 'mailvelopecontainer';
    var plaintextelem = '#' + plaintext_id;
    setupPlaintextElem();

    function getSender() {
      return $('.header.from .rcmContactAddress').first().text();
    }

    function setupPlaintextElem() {
      $(ciphertextelem).before('<div id="' + plaintext_id + '" style="display: none"></div>');
      // Hooks for styling the height of the mailvelope display-container
      $('html').addClass('mailvelopecontainerframe');
      $('#messagepreview, #messagecontent').addClass('mailvelope');
    }

    function showPlaintext() {
      $(ciphertextelem).hide();
      $(plaintextelem).show();
      setupReplyAndForwardButtons();
      debug('displayed plaintext');
    }

    function cloneButton(type, $button, withtext) {
      var encbutton = $button.clone();
      encbutton.addClass('mailvelope');
      encbutton.attr('title', rcmail.gettext('mailvelope_client.' + type + '_encrypted_title'));
      // Only set text for main toolbar, that is: outside of an iframe.
      if (withtext) {
        encbutton.text(rcmail.gettext('mailvelope_client.' + type + '_encrypted'));
      }
      // Use addEventListener here to bind the event-handler to the capturing
      // phase, else it doesn't work in Firefox.
      encbutton[0].addEventListener('click', function() {
        localStorage.enc_editor = 'true';
        localStorage.orig_ciphertext = ciphertext;
        localStorage.orig_sender = getSender();
      }, true);
      return encbutton;
    }

    function cloneReplyButton($elem, withtext) {
      $elem.after(cloneButton('reply', $elem, withtext));
    }

    function cloneForwardButton($elem, withtext) {
      var encbtn = cloneButton('forward', $elem, withtext);
      if ($elem.parent().attr('class') == 'dropbutton') {
        $elem.parent().after(encbtn);
      } else {
        $elem.after(encbtn);
      }
      // Use addEventListener here to bind the event-handler to the capturing
      // phase, else it doesn't work in Firefox.
      encbtn[0].addEventListener('click', function() {
        localStorage.is_forward = 'true';
      }, true);
    }

    function setupReplyAndForwardButtons() {
      if (window.frameElement != null) {
        // Inside iFrame
        cloneReplyButton($('.button.reply'));
        cloneForwardButton($('.button.forward'));
        // Also clone buttons on main toolbar.
        // TODO: Fix main toolbar buttons for firefox: currently those buttons don't get the click-event-handler attached.
        cloneReplyButton($(parent.document).find('.button.reply'), true);
        cloneForwardButton($(parent.document).find('.button.forward'), true);
      } else {
        // TODO: Fix main toolbar buttons for firefox: currently those buttons don't get the click-event-handler attached.
        cloneReplyButton($('.button.reply'), true);
        cloneForwardButton($('.button.forward'), true);
      }

      // Delete buttons when page changes, else we'd still see them e.g. when changing folders.
      window.onbeforeunload = function() {
        $(parent.document).find('.button.reply.mailvelope, .button.forward.mailvelope').remove();
      }

    }

    this.show = function() {
      debug('decrypting');
      var options = { senderAddress: getSender() };
      keyring.getMvlpkeyring()
        .then(
          function(mvlpkeyring) {
            mailvelope.createDisplayContainer(plaintextelem, ciphertext, mvlpkeyring, options)
              .then(showPlaintext, error);
          },
          error
        );
    }
  }


  this.Editor = function() {
    var mvlpeditor = null;
    var encrypt_to_self = null;
    var all_recipients_have_keys = null;
    var keycache = new mc.Keycache;
    var keynotes = new mc.KeyNotes;
    var ajaxloader = new mc.AjaxLoader;

    setupButtons();
    setupRecipientFields();
    setupSenderField();
    disableDraftAutosave();

    this.show = function() {
      var options = {
        quota: 10240,
        signMsg: false
      }
      if (localStorage.orig_ciphertext != 'false') {
        options.quotedMail = localStorage.orig_ciphertext;
        localStorage.orig_ciphertext = '';
        if (localStorage.is_forward == 'true') {
          localStorage.is_forward = false;
          options.keepAttachments = true;
          options.quotedMailHeader = rcmail.gettext('mailvelope_client.quote_header_forward').replace('%s', localStorage.orig_sender);
        } else {
          options.quotedMailHeader = rcmail.gettext('mailvelope_client.quote_header_reply').replace('%s', localStorage.orig_sender);
        }
      } else {
        options.predefinedText = getPlainEditorContent();
      }
      debug("editor options", options);

      $('#composebody').after('<div id="mailvelopecontainer" style="height: 100%"></div>');
      var $editorCont = $('#mailvelopecontainer');
      $armored_msg = $('#composebody');
      // Don't hide(), that breaks some standard-functionality of Roundcube.
      $armored_msg.attr("style", "z-index: -1");
      $editorCont.empty();
      $armored_msg.val('');

      keyring.getMvlpkeyring()
        .then(
          function(mvlpkeyring) {
            mailvelope.createEditorContainer('#mailvelopecontainer', mvlpkeyring, options)
              .then(
                function(ed) {
                  debug("setting mvlpeditor to", ed);
                  mvlpeditor = ed;
                }
              );
          },
          error
        );
    }

    function encryptAndSend() {
      if (!sendingAllowed()) {
        disableEncryptAndSend();
        return false;
      }
      recipients = getRecipients();
      debug("recipients", recipients);
      if (encrypt_to_self) {
        recipients.push(encrypt_to_self);
      }
      debug("encryption addresses:", recipients);
      debug("mvlpeditor:", mvlpeditor);
      mvlpeditor.encrypt(recipients)
        .then(
          function encryptionSuccess(armored) {
            debug("encryption successful");
            setCiphertext(armored);
            sendForm();
          },
          function encryptionError(err) {
            if (err.code == 'NO_KEY_FOR_RECIPIENT') {
              alert(err);
              $('#_to').focus();
            } else {
              error(err);
            }
          }
        );
    }

    function getSender() {
      return cleanAddress($('#_from :selected').text());
    }

    function getRecipients() {
      var addresses = [];
      $recipients_fields.each(function(i) {
        field = $recipients_fields[i];
        addresses = addresses.concat(collectAddresses(field));
      });
      return addresses;
    }

    function cleanAddress(email) {
      // We want an error message for invalid addresses, too, therefore we don't
      // rely on the @-sign being present.
      if (email.indexOf('<') > 0) {
        // Strip brackets and names.
        match = email.match("<([^ <>]+)")[1];
      } else {
        match = email;
      }
      // Strip whitespace.
      return match.trim();
    }

    function collectAddresses(field) {
      var raw = $(field).val().split(',');
      var addresses = [];
      for (var i in raw) {
        addr = cleanAddress(raw[i]);
        if (addr) {
          addresses = addresses.concat(addr);
        }
      }
      return addresses;
    }

    function getPlainEditorContent() {
      return $('#composebody').val();
    }

    function setupSenderField() {
      // Re-check sender-keys if identity is changed.
      $('#_from').change(checkKeysForSender);
      checkKeysForSender();
    }

    function setupRecipientFields() {
      // No support for Bcc in encrypted messages. We'd have to hide the Key-ID
      // in the ciphertext, which mailvelope doesn't let us do.
      $('#bcc-link, #compose-bcc').hide();
      $('#_bcc').change(function() {
        // This triggers the check if bcc is empty.
        enableEncryptAndSend();
      });
      // Hook callbacks
      $recipients_fields = $('#_to, #_cc');
      $recipients_fields.change(function() {
        // Slight delay to wait for auto-completion of addresses.
        setTimeout(checkKeysForRecipients, 200);
      });
    }

    function setupButtons() {
      // compose view in fullwidth (no spaces for attachements needed)
      $('#composebodycontainer').addClass('mailvelope-compose');
      // No plain attachments
      $('#compose-attachments').hide();
      // No plain sending button
      $plainSendButton = $('.button.send').first();
      $plainSendButton.hide();
      // No savedraft button
      $('.button.savedraft').hide();
      // No attachment button
      $('.button.attach').hide();
      // No insert-signature button
      $('.button.insertsig').hide();
      // No editor-type selection
      $('#composeoptions select[name=editorSelector]').parent().parent().hide();
      // Add custom encrypt+send-button
      $plainSendButton.after('<a id="encryptBtn" class="button send mailvelope">' + rcmail.gettext('mailvelope_client.encrypt_and_send') + '</a>');
      $encryptBtn = $('#encryptBtn');
      $encryptBtn.click(function(event) {
        event.preventDefault();
        encryptAndSend();
      });
      disableEncryptAndSend();
    }

    function disableDraftAutosave() {
      rcmail.env.draft_autosave = 0;
      clearTimeout(rcmail.save_timer);
    }

    function bccEmpty() {
      if ($('#_bcc').val() != '') {
        $('#bcc-error').show();
        return false;
      } else {
        $('#bcc-error').hide();
        return true;
      }
    }

    function sendingAllowed() {
      return (encrypt_to_self && all_recipients_have_keys && bccEmpty());
    }

    function enableEncryptAndSend() {
      if (sendingAllowed()) {
        $encryptBtn.removeClass('disabled');
        $encryptBtn.attr('title', '');
        $encryptBtn.attr('href', '');
      }
    }

    function disableEncryptAndSend() {
      $encryptBtn.addClass('disabled');
      $encryptBtn.attr('title', rcmail.gettext("mailvelope_client.sending_only_after_recipient_check"));
    }

    this.checkKeys = function() {
      checkKeysForSender();
      checkKeysForRecipients();
    }


    function checkKeysForRecipients() {
      debug("Checking keys for recipients");
      keynotes.clear('recipient');
      disableEncryptAndSend();
      all_recipients_have_keys = false;
      var addresses = getRecipients();
      if (addresses.length == 0) {
        debug("no recipients found");
        return false
      }
      debug("recipients found:", addresses);
      keyring.find(addresses)
        .then(
          function(result) {
            debug('result', result);
            var allvalid = true;
            for (var email in result) {
              if (result[email] == false) {
                allvalid = false;
                debug("No key present in keyring for", email);
                debug("Looking for key in other sources");
                checkImportableKey(email, 'recipient');
              }
            }
            if (allvalid) {
              all_recipients_have_keys = true;
              enableEncryptAndSend();
            }
          },
          error
        );
    }

    function checkKeysForSender() {
      keynotes.clear('sender');
      disableEncryptAndSend();
      encrypt_to_self = null;
      sender = getSender();
      debug("Checking for keys for", sender);
      keyring.find(sender)
        .then(
          function(result) {
            debug("result", result);
            if (result[sender]) {
              debug("Found key(s):", result[sender]);
              encrypt_to_self = sender;
              enableEncryptAndSend();
            } else {
              debug("No key found");
              checkImportableKey(sender, 'sender');
            }
          },
          error
        );
    }

    function setCiphertext(armored) {
      $armored_msg.val(armored);
      $armored_msg.show();
    }

    function sendForm() {
      // A hidden parameter required to tell our server-side code to
      // change this message's headers into pgp/mime.
      $('#composebody').before('<input type="hidden" name="mailvelope_pgp_mime" value="1"></input>');
      // Send it
      $plainSendButton.click();
    }

    function checkImportableKey(address, type) {
      // TODO: Store also negative lookup-results for a short amount of time and
      // only repeat the remote-lookup if that amount of time has passed.
      var stored_key = keycache.find(address);
      if (stored_key) {
        debug("Found already stored key, not looking up remotely");
        keynotes.importable(stored_key, type);
        return true;
      }

      ajaxloader.show(address, type);
      debug("Asynchronously looking up importable key for", address);
      var baseurl = rcmail.env.mailvelope_client_pubkeyapi_url;
      var url = baseurl + '&email=' + encodeURI(address);
      $.ajax({ url: url,
               dataType: 'json',
               timeout: 8000,
               // Catch errors from the API. Through the promise-interface the
               // error already was logged which causes jQuery to display an ugly
               // popup in Firefox.
               error: function ajaxError(err) {
                 error("Error", err.status, "from public_keys API for", address, ":", err.statusText);
                 ajaxerror = err;
               }
            })
        .then(function(data) {
          if (data.results) {
            if (data.results.length == 1) {
              debug("Found key for " + address);
              key = new mc.Key(data.results[0], address);
              keycache.store(key);
              keynotes.importable(key, type);
            } else {
              console.warn("Found multiple keys for", address, "— skipping");
              keynotes.missing(address, type);
            }
          } else {
            console.warn("Found no key for", address);
            keynotes.missing(address, type);
          }
          ajaxloader.hide(address);
        },
        function(data) {
          ajaxloader.hide(address);
          // TODO: Different user-facing message in case of timeouts or network errors?
          keynotes.missing(address, type);
        });
    }
  }


  this.AjaxLoader = function() {
    this.show = function(address, type) {
      debug("Showing Ajax-loader for", address);
      var $elem = imgElement(address);
      if ($elem.length > 0) {
        $elem.show();
      } else {
        // Show before the first key-notes-element, which is the one for verified keys.
        $('#' + type + 'verifiedkeys').before(img(address));
      }
    }

    this.hide = function(address) {
      debug("Hiding Ajax-loader for", address);
      imgElement(address).hide();
    }

    function imgElement(email) {
      return $('.ajaxloader[data-address="' + email + '"]');
    }

    function img(email) {
      return '<img class="ajaxloader" style="float: left" src="https://staging.posteo.de/webmail/skins/posteo_green/images/ajaxloader.gif" title="Looking up encryption keys for recipients" alt="loading..." data-address="' + email + '"/>';
    }
  }


  this.KeyNotes = function() {
    setup();

    this.importable = function(key, type) {
      if (key.verified) {
        kind = "verified";
      } else {
        // For senders only show verified keys.
        if (type == 'sender') {
          return false;
        }
        kind = "importable";
      }
      show(key.importLink(type), type, kind);
      key.importLinkElement().click(
        function(e) {
          debug("import-link clicked");
          e.preventDefault();
          keyring.importKey(key)
            .then(
              editor.checkKeys,
              error
            );
        });
    }

    this.missing = function(address, type) {
      if (type == 'sender') {
        msg = '';
      } else {
        msg = address;
      }
      show(msg, type, 'no');
    }

    this.clear = function(type) {
      debug("clearing keynotes for", type);
      debug($('#' + type + ' .keyslist'));
      $('#' + type + ' .keyslist').empty();
      $('#' + type + ' .keynotes').hide();
      fixComposeviewHeight();
    }

    function setup() {
      // Insert table-row to show problems with missing sender key
      $('#_from').parent().parent().after('\
          <tr id="sender"> \
            <td class="title top"></td> \
            <td class="editfield"> \
              <div id="senderverifiedkeys" class="keynotes senderverifiedkeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.found_verified_sender_key") + ' \
                <span class="keyslist verifiedkeyslist"></span>. \
              </div> \
              <div id="senderimportablekeys" class="keynotes senderimportablekeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.found_importable_sender_key") + ' \
                <span class="keyslist importablekeyslist"></span> \
                ' + rcmail.gettext("mailvelope_client.found_importable_sender_key_suffix") + '. \
              </div> \
              <div id="sendernokeys" class="keynotes sendernokeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.no_sender_keys_found") + '. \
              </div> \
            </td> \
          </tr> \
          ');
      // Insert table-row to show problems with missing recipients keys
      $('#_to').parent().parent().after('\
          <tr id="recipient"> \
            <td class="title top"></td> \
            <td class="editfield"> \
              <div id="recipientverifiedkeys" class="keynotes verifiedkeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.found_verified_keys") + ' \
                <span class="keyslist verifiedkeyslist"></span>. \
              </div> \
              <div id="recipientimportablekeys" class="keynotes importablekeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.found_importable_keys") + ' \
                <span class="keyslist importablekeyslist"></span>. \
              </div> \
              <div id="recipientnokeys" class="keynotes nokeys" style="display: none"> \
                ' + rcmail.gettext("mailvelope_client.no_keys_found") + ' \
                <span class="keyslist nokeyslist"></span>. \
              </div> \
            </td> \
          </tr> \
          ');
      $('#_bcc').parent().parent().after('\
          <tr id="bcc-error" style="display: none"> \
            <td class="title top"></td> \
            <td class="editfield"> \
              <div class="keynotes nokeys"> \
                ' + rcmail.gettext("mailvelope_client.bcc_not_empty_error") + ' \
              </div> \
            </td> \
          </tr> \
          ');
    }

    function show(msg, type, kind) {
      $id = $('#' + type + kind + 'keys');

      if ($id.children('.keyslist').text().length == 0) {
        var pretext = '';
      } else {
        var pretext = ', ';
      }
      $id.children('.keyslist').append(pretext + msg);
      $id.show();
      fixComposeviewHeight();
    }

    function fixComposeviewHeight() {
      // Shrink editor-area a little whenever the composeheaders change, else the
      // attachment-buttons partly becomes obscured.
      $('#composeview-bottom').height($('#compose-content').height() - $('#composeheaders').height());
    }
  }


  this.Keyring = function() {
    var mvlpkeyring = null;
    var loadingkeyringpromise = null;

    // Delayed setup, we might not need it.
    function init() {
      if (loadingkeyringpromise) {
        // Load the keyring only once, it takes a (short) while.
        return loadingkeyringpromise;
      }

      if (mvlpkeyring) {
        return Promise.resolve();
      }

      // Find or create the keyring.
      var p = mailvelope.getKeyring('Posteo')
        .then(
          setKeyring,
          function(err) {
            if (err.code == 'NO_KEYRING_FOR_ID') {
              createKeyring();
            } else {
              error(err);
            }
          });
      loadingkeyringpromise = p;
      return p;
    }

    function setKeyring(keyring) {
      mvlpkeyring = keyring;
    }

    function createKeyring(err) {
      var p = mailvelope.createKeyring('Posteo')
        .then(setKeyring, error);
      return p;
    }

    this.getMvlpkeyring = function() {
      var p = init()
        .then(
          function() {
            return mvlpkeyring;
          }
        );
      return p;
    }

    this.find = function(addresses) {
      debug("Looking up key in keyring for", addresses);
      var p = init()
        .then(
          function() {
            // Ensure we have an array.
            var addr = [].concat(addresses);
            return mvlpkeyring.validKeyForAddress(addr);
          },
          error
        );
      return p;
    }

    this.importKey = function(key) {
      var p = init()
        .then(
          function() {
            return mvlpkeyring.importPublicKey(key.content);
          },
          error
        );
      return p;
    }
  }


  this.Key = function(apiresult, address) {
    this.verified = apiresult.verified;
    this.address = address;
    this.content = apiresult.content;

    var datastring = "data-import-address='" + this.address + "'";

    this.importLinkElement = function() {
      return $('a[' + datastring + ']');
    }

    this.importLink = function(type) {
      if (type == 'sender') {
        return '<a href="" ' + datastring + '>' + rcmail.gettext('mailvelope_client.import') + '</a>';
      } else {
        return this.address + ' <a href="" ' + datastring + '>(' + rcmail.gettext('mailvelope_client.import') + ')</a>';
      }
      return string;
    }
  }


  this.Keycache = function() {
    store = new Object;

    this.find = function(email) {
      return store[email];
    }

    this.store = function(key) {
      store[key.address] = key;
    }
  }


  //
  // Main code
  //

  var debug = debug;
  var mc = this;
  var editor = null;
  var display = null;
  var keyring = new this.Keyring;


  this.run = function() {
    if (typeof mailvelope !== 'undefined') {
      init();
    } else {
      window.addEventListener('mailvelope', init, false);
      // Set a delay before detecting old-style-Mailvelope as it takes a short
      // while to setup itself.
      setTimeout(detectOldStyleMailvelope, 2000);
    }
  }

  function init() {
    // No MailvelopeClient in classic. Only show a hint on the more modern
    // skins.
    if (rcmail.env.skin == 'classic') {
      pointToModernSkins();
      return true;
    }

    // Determine whether to show Editor or Display or nothing.
    if ($('#_to').length > 0 && localStorage.enc_editor == 'true') {
      editor = new mc.Editor();
      editor.show();
      // Initially check keys, in case recipients are being inserted automatically.
      editor.checkKeys();
    } else {

      // Encrypted composing button
      if ($('.button.compose').size() > 0) {
        insertEncryptedComposingButton();
      }

      // Showing a message?
      var ciphertext = $('#messagebody > .message-part > pre').text();
      if (/-----BEGIN PGP MESSAGE-----/.test(ciphertext)) {
        // Display mode
        debug("Found ciphertext");
        display = new mc.Display(ciphertext);
        display.show();
      }
    }
  }

  function detectOldStyleMailvelope() {
    //debug("Looking for old-style mailvelope");
    if ($('.m-encrypt-frame #editorBtn, .m-decrypt').length > 0) {
      // No MailvelopeClient in classic. Only show a hint on the more modern
      // skins.
      if (rcmail.env.skin == 'classic') {
        pointToModernSkins();
        return true;
      }

      debug("api hint");
      mailvelope_api_hint = '<p class="browsehappy  p_browsehappy--oneline">' + rcmail.gettext('mailvelope_client.switch_on_api') + '</p>';
      showHint(mailvelope_api_hint);
    }
  }

  function showHint(msg) {
    if (window.frameElement == null) {
      // Editor or full-view display mode
      var elem = $('#header');
    } else {
      // Display mode, preview (from an iframe)
      var elem = $(parent.document).find('#header');
    }
    elem.before(msg);
  }

  function pointToModernSkins() {
    debug("pointing to modern skins");
    skin_pointer = '<p class="browsehappy  p_browsehappy--oneline">' + rcmail.gettext('mailvelope_client.point_to_modern_skins') + '</p>';
    showHint(skin_pointer);
  }

  function insertEncryptedComposingButton() {
    localStorage.orig_ciphertext = false;
    localStorage.orig_sender = false;
    localStorage.is_forward = false;
    localStorage.enc_editor = false;
    $('.button.compose').click(function() {
      localStorage.enc_editor = false;
    });
    $enccomposebtn = $('.button.compose').clone();
    $enccomposebtn.attr('id', 'mailvelope_compose');
    $enccomposebtn.addClass('mailvelope');
    $enccomposebtn.text(rcmail.gettext('mailvelope_client.compose_encrypted'));
    $enccomposebtn.attr('title', rcmail.gettext('mailvelope_client.compose_encrypted_title'));
    // In the addressbook the compose-buttons are disabled at first.
    // rcmail enables our button, but it doesn't strip the 'disabled'-class.
    rcmail.addEventListener('enable-command', function(obj) {
      if (obj.command == 'compose' && obj.status == true) {
        $enccomposebtn.removeClass('disabled');
      }
    });
    $enccomposebtn.click(function() {
      localStorage.enc_editor = true;
      localStorage.orig_ciphertext = false;
    });
    $('.button.compose').after($enccomposebtn);
    $('.button.forward').click(function() {
      localStorage.is_forward = 'true';
    });
  }

  function error(foo) {
    console.error.apply(console, arguments);
  }

  function debug(foo) {
    if (debug) {
      console.debug.apply(console, arguments);
    }
  }

}


// TODO: rather hook into init-event of rcmail?
$(document).ready(function() {
  if (rcmail.env.mailvelope_client_pubkeyapi_url) {
    var mailvelope_client = new MailvelopeClient();
    mailvelope_client.run(false);
  }
});

