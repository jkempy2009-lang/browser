# Futsal score sheet viewer

A single static page (`index.html`). Paste a link in the top bar and the site opens underneath, without leaving the page.

## Sharing

After pressing Go, the address becomes `https://<this-site>/?url=<the link>`. Share that address (or use the "Copy share link" button) and it opens the same page for everyone.

## Adding the scoreboard

Put the scoreboard controls inside `<div id="scoreboard-slot">` in `index.html`. The page exposes what is loaded:

- `window.currentUrl`: the loaded link, or `""` when nothing is loaded
- a `pagechange` event on `document`, with the link in `event.detail.url`

## How sites are loaded

- **On Cloudflare** the site runs with a relay (`src/worker.js`). The relay fetches the website itself and removes its "do not embed me" instructions, so most simple sites show inside the page. Address format: `https://<this-site>/https://example.com/page`.
- **On plain static hosting** (Vercel, GitHub Pages) there is no relay. Sites are loaded directly, and ones that forbid embedding show blank.

The page detects which mode it is in by asking for `/__relay`.

## Limits

- Sites that need a sign-in will not work through the relay: cookies are removed on purpose.
- Heavily scripted sites (video, maps, web apps) often break. The "Open in new tab" button is the fallback.
- The relay only fetches public websites, and relayed pages can only be displayed inside this site.

## Hosting

- **Cloudflare Workers**: connect the repo; it deploys with `npx wrangler deploy` using `wrangler.jsonc`. The `name` in that file must match the Worker's name in the Cloudflare dashboard.
- **Static hosts**: serve the `public/` folder. No build step.
