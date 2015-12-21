<?php

/**
 * A client for mailvelopes client-API.
 *
 * @copyright  Copyright (c) 2015 Posteo e.K <https://posteo.de>
 * @license    GNU GPLv3+
 */
class mailvelope_client extends rcube_plugin {
  public function init() {
    $rcmail = rcmail::get_instance();
    $this->load_config();
    $rcmail->output->set_env('mailvelope_client_pubkeyapi_url', $rcmail->config->get('mailvelope_client_pubkeyapi_url', 'https://api.posteo.de/v1/public_keys?type=open_pgp'));
    $this->include_script('mailvelope_client.js');
    $this->add_texts('localization', true);
    $this->add_hook('message_before_send', array($this, 'mailvelope'));
  }

  public function mailvelope($args) {
    if ($_POST['mailvelope_pgp_mime'] == '1') {
      $ciphertext = $args['message']->getMessageBody();
      // Delete body, else the lib won't add our attachments.
      $args['message']->setTXTBody('');
      // Make the message pgp/mime.
      $res = $args['message']->addAttachment(
          'Version: 1',
          'application/pgp-encrypted',
          'OpenPGP-version-information.txt',
          false,
          '7bit'
        );
      $this->log_result('Adding version-information failed', $res);
      $res = $args['message']->addAttachment(
          $ciphertext,
          'application/octet-stream',
          'encrypted.asc',
          false,
          '7bit',
          'inline'
        );
      $this->log_result('Adding ciphertext failed', $res);
      $res = $args['message']->setContentType(
          'multipart/encrypted',
          array(
              'protocol' => 'application/pgp-encrypted'
            )
          );
      $this->log_result('Changing content-type failed', $res);
      $res = null;
    }
    return $args;
  }

  private function log_result($text, $res) {
    if ($res != true) {
      write_log('errors', "$text:");
      write_log('errors', $res);
    }
  }

}
