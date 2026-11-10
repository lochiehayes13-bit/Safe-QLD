/*
 * The photo relay: forty lines that take the mail app out of the photo button.
 *
 * The app cannot send an email. Nothing on a phone can — sending mail needs a
 * server that speaks SMTP or a provider's API, and neither of those can live
 * in a build that anybody can download. So every route the app has on its own
 * ends in somebody's mail client, which is exactly the thing that was asked to
 * go away.
 *
 * This is the missing half, and it is deliberately the smallest thing that
 * could work: one POST, a multipart body, and a message out through a provider
 * the office already pays for. Deploy it anywhere that runs Node, put the URL
 * in Settings under "Photo address", and the app posts straight to it. No mail
 * app opens on the phone at all.
 *
 * DEPLOY
 *   Anywhere with a Node runtime and two environment variables set. It has no
 *   database, no state and no session: a request comes in, a message goes out.
 *
 *     RELAY_TOKEN     A long random string. The app does not send it — see the
 *                     note under SECURITY — so set it only if you put the
 *                     relay behind something that can.
 *     RESEND_API_KEY  A key from resend.com, or swap sendMail() below for
 *                     whatever the office already uses.
 *     PHOTO_INBOX     Where the photos land. Defaults to lachlan@safeqld.com.au.
 *     PHOTO_FROM      A verified sending address at a domain you control.
 *
 *   npm install && node index.js
 *
 * SECURITY, said plainly rather than left for somebody to find out
 *   This endpoint is open by default. An app that ships to phones cannot hold
 *   a secret — anything compiled into it can be read out of the bundle — so
 *   there is no token the app could send that an attacker could not also send.
 *   What protects it instead is that it does exactly one thing: it emails
 *   photographs to one fixed address that is set here on the server and not in
 *   the request. The worst somebody can do with the URL is send Lachlan
 *   pictures. If that is not good enough for the office, put it behind Cloud-
 *   flare Access or an IP allowlist; do not try to fix it with a token in the
 *   app.
 *
 *   The size cap below is the other half of that: without it, an open endpoint
 *   is a way to make the office's provider bill go up.
 */

const express = require('express');
const multer = require('multer');
const { Resend } = require('resend');

const MAX_PHOTOS = 10;
const MAX_BYTES_EACH = 25 * 1024 * 1024;

const PHOTO_INBOX = process.env.PHOTO_INBOX || 'lachlan@safeqld.com.au';
const PHOTO_FROM = process.env.PHOTO_FROM || 'app@safeqld.com.au';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_PHOTOS, fileSize: MAX_BYTES_EACH },
});

/*
 * The app posts from a browser as well as from a phone, and a browser will not
 * send the request at all without this. `*` is right here: the endpoint holds
 * nothing to steal and reads no cookie, so there is no cross-origin request it
 * could be tricked into making on somebody's behalf.
 */
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const photos = req.files || [];
  if (!photos.length) return res.status(400).send('No photos were on that.');

  try {
    await sendMail({
      subject: String(req.body.subject || 'Photos for the website'),
      text: String(req.body.body || ''),
      photos,
    });
    // The app shows this sentence on success, so it says what happened rather
    // than "OK".
    res.status(200).send(`${photos.length} with the office.`);
  } catch (e) {
    /*
     * The app prints the first 200 characters of this back to the technician,
     * so it has to be a sentence and not a stack trace. The person holding the
     * phone did not set this server up and cannot act on a provider's error
     * code; the sentence tells them who can.
     */
    console.error('photo-relay send failed', e);
    res.status(502).send('The photos reached the office server but it could not send them on. Tell Lachlan.');
  }
});

async function sendMail({ subject, text, photos }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: PHOTO_FROM,
    to: PHOTO_INBOX,
    subject,
    text,
    attachments: photos.map((p) => ({ filename: p.originalname || 'photo.jpg', content: p.buffer })),
  });
  if (error) throw new Error(error.message || 'the mail provider refused it');
}

/*
 * Multer rejects an oversized or over-count upload by throwing, and without
 * this express answers with an HTML error page that the app would show a
 * technician verbatim.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('One of those photos is too big to email. Send it on its own.');
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).send(`${MAX_PHOTOS} is as many as go at once.`);
  }
  console.error('photo-relay', err);
  return res.status(500).send('The office server could not take that. Tell Lachlan.');
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`photo-relay listening, sending to ${PHOTO_INBOX}`);
});
