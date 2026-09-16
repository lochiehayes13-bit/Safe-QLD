# Photo relay

The one piece of Safe QLD that does not run on a phone, and the only reason
the photo button can send without opening a mail app.

## Why it exists

An application cannot send an email. Sending mail needs a server that speaks
SMTP or a provider's API, and a build that anybody can download cannot hold the
credential for one — it would be readable in the bundle within a minute. So
every route the app has on its own ends in somebody's mail client: the share
sheet, or the composer.

Both of those work, and the app falls back to them automatically. But "the
photos load in the app then bang send, without them opening their emails" is
only true with something on the other end to post to. This is that something.

## What it is

One POST endpoint. It takes a multipart body — `photos` (up to ten files),
`subject`, `body`, `technician` — and emails them to one fixed address that is
set on the server, not in the request.

That last part is the security model, and it is worth saying out loud: the
endpoint is open. There is no token the app could hold that an attacker could
not read out of the bundle and send too. What makes it safe enough is that it
does exactly one thing and the destination is not something a caller can
choose. The worst anybody can do with the URL is send Lachlan photographs. If
the office wants more than that, put it behind Cloudflare Access or an IP
allowlist — not behind a secret in a mobile app.

## Running it

```
npm install
RESEND_API_KEY=… PHOTO_FROM=app@safeqld.com.au node index.js
```

| Variable | What it is |
| --- | --- |
| `RESEND_API_KEY` | A key from resend.com. Swap `sendMail()` in `index.js` for SendGrid, Postmark, SES or the office's own SMTP if that suits better — it is six lines. |
| `PHOTO_FROM` | A verified sending address at a domain the office controls. |
| `PHOTO_INBOX` | Where they land. Defaults to `lachlan@safeqld.com.au`. |
| `PORT` | Defaults to 8080. |

It holds no state and no database, so it deploys to anything: Cloud Run, Fly,
Render, Railway, a Lambda behind a function URL, or a spare box.

## Pointing the app at it

Settings → Where things go → **Photo address**. Paste the https URL and that is
the whole setup. From then on the photo button posts straight here and no mail
app opens on any phone.

Leave it empty and nothing breaks: the app keeps using the share sheet, which
is one tap and carries the photographs with it. The address is the upgrade, not
the requirement.

It has to be https. The app refuses plain http and says so on the settings
screen — these are photographs of customers' buildings.
