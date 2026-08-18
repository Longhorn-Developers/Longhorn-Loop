# site/

The public pages for `longhorndevelopers.org`. Two files, no build step, no
dependencies — deliberately. This exists to satisfy two hard requirements and
one soft one, and adding a framework would make it worse at all three.

## Why this exists

**The App Store and Play Store both require a public privacy policy URL.** Not
having one blocks submission entirely. `privacy.html` is that URL.

**The domain had nothing behind it.** The apex A record pointed at `192.0.2.1`,
a reserved documentation address, so `longhorndevelopers.org` resolved to
nothing. That matters more than it looks: we send every verification code from
this domain, and a sending domain with no website is a spam signal. UT's
Proofpoint gateway already rejected our previous domain — see
`server/src/email/send.ts` — so we are not spending reputation carelessly.

**And it is the first thing a curious tester types in.** Worth not being blank.

## Deploying

Cloudflare Pages, from this directory:

    npx wrangler pages deploy site --project-name=longhorn-loop-site

Then in the Cloudflare dashboard, Workers & Pages → the project → Custom
domains → add `longhorndevelopers.org`. That replaces the placeholder A record
with the Pages route.

`/privacy.html` is served at both `/privacy.html` and `/privacy` — Pages
resolves extensionless paths — so either URL is safe to submit to the stores.

## Before you submit to the stores

The policy describes what the app does **today**. If any of these change, the
policy is wrong and must be updated first:

- adding analytics or crash reporting that transmits user data
- collecting location, contacts, or anything not in the table
- sharing data with any party other than Cloudflare and Resend
- adding advertising of any kind

Apple's App Privacy questionnaire has to match this page. A mismatch is a
rejection, and a rejection costs a review cycle.

`privacy@longhorndevelopers.org` needs to be a real mailbox someone reads
before you submit. Both stores will use it, and so will anyone exercising a
data request.
