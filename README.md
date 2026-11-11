# Futsal score sheet viewer

A single static page (`index.html`). Paste a link in the top bar and the site opens underneath, without leaving the page.

## Sharing

After pressing Go, the address becomes `https://<this-site>/?url=<the link>`. Share that address (or use the "Copy share link" button) and it opens the same page for everyone.

## Adding the scoreboard

Put the scoreboard controls inside `<div id="scoreboard-slot">` in `index.html`. The page exposes what is loaded:

- `window.currentUrl`: the loaded link, or `""` when nothing is loaded
- a `pagechange` event on `document`, with the link in `event.detail.url`

## Limits

The site is shown in an iframe. Websites that forbid being embedded will show blank or "refused to connect"; the "Open in new tab" button is the fallback. Only `https` links can be shown when this page is itself served over `https`.

## Hosting

No build step. Any static host works (Vercel, GitHub Pages, Netlify): serve the repo root.
