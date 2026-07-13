# Another Tab – Browser Extension

Browser extension that helps users find tickets for live events by matching
performers, cities, and dates and redirecting to available ticket sources.

The extension analyzes the current page, extracts event-related data
(performer, city, date when available), and queries a remote API
to find matching or upcoming events with ticket availability.

All matching logic and data processing are handled server-side.
The extension itself is lightweight and does not store or process user data locally.

---

## How it works

1. User opens an event page on Ticketmaster, SeatGeek, Vivid Seats, or StubHub
2. The extension extracts:
   - performer name
   - city
   - date (if available)
3. The extracted data is sent to a remote API
4. The API returns:
   - exact event matches (if found), or
   - upcoming events in the same city, or
   - performer links if no events are found
5. The extension displays available ticket options

---

## Supported browsers

- Google Chrome
- Microsoft Edge
- Mozilla Firefox

(Uses `webextension-polyfill` for cross-browser compatibility)

---

## Development & Testing

### Load locally (Chrome / Edge)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the root folder of this repository

### Load locally (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json`

## Production build

1. Update the version in `scripts/build-manifest.js`.
2. Run `node scripts/build-manifest.js prod`.
3. Load the generated `dist` directory as an unpacked extension for a final check.
4. Zip the contents of `dist` (with `manifest.json` at the archive root) and upload that archive to the browser extension store.

---

## Privacy

The extension does not collect or store personal data.
All requests are made only when the user interacts with the extension.

---

## API

The extension communicates with a remote API endpoint.
The API is responsible for all matching logic and data normalization.
