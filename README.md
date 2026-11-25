# BAG
A personal collection for links and pages, with a web dashboard, account-scoped HTTP API and Chrome Manifest V3 extension.

## Deploy from a browser with Cloudflare Workers and Neon

1. Create a free Neon Postgres project for BAG. In its SQL Editor run the entire schema.sql file once. Copy the database connection string from Connect.
2. Upload the contents of this BAG directory to your own GitHub repository. In Cloudflare Workers & Pages create a **Worker** and connect the repository. Use the directory containing wrangler.jsonc as the root, use bag-kakeru as the Worker name, leave the build command blank, and use npx wrangler deploy as the deploy command. Wrangler builds the dashboard and attaches the AI binding automatically.
3. In the Worker's Settings → Variables and Secrets, add DATABASE_URL as a **Secret** containing the Neon connection string, then deploy the new version. Keep both accounts on their free plans.
4. Open the Worker's HTTPS URL. Create an account, save a link with automatic detection, refresh, and open the saved item. Detect again on the card exercises the classifier. If the model times out or its daily allowance is used up, BAG can still save with URL rules while the Worker and database have quota.
5. Select **Add to Chrome** on the website. Download and extract the extension, then follow the installation page. The Worker configures the download for its own HTTPS address.

The cloud deployment starts with an empty Neon database. Existing local SQLite accounts and items stay in the original database. Automatic classification sends the hostname, path, short title and suggested category to Cloudflare. Manual categories and explicit image or text captures skip the model. No OpenAI key or Ollama installation is needed for this deployment.

## Run locally
Use Node.js 24 or later. From this directory run `node server.mjs` and open http://127.0.0.1:8787. Choose **Create an account**. Paste a URL to save a first item. Search by title or domain, rename or delete a card, or open the original in a new tab.

In Chrome open chrome://extensions, turn on Developer mode, select **Load unpacked**, and choose the **extension** directory. Open its toolbar popup and sign in with the same BAG account. Right-click a link or the page background and choose **To my BAG**. A toolbar badge confirms the result. The popup also saves the current tab and shows the five latest items. A network failure requires another save after reconnecting.

## Hosting and data
This implementation uses Node.js, browser JavaScript and SQLite. The server stores accounts, salted scrypt password hashes, hashed BAG sessions and saved records in bag.sqlite. Keep its directory private. Choose a persistent path with BAG_DB. For shared access run one server behind an HTTPS reverse proxy with BAG_HTTPS=1. Preserve the public Host header. HOST and PORT control the listening address. Change the origin in extension/client.js and the host permission in extension/manifest.json to the same HTTPS deployment before loading or distributing that build. All clients signed into the same BAG account use that database. Sessions last 30 days. Sign out separately on each client.

## Capture and privacy
BAG stores the target URL, hostname, title, capture type and timestamps. Link captures use the destination hostname when the destination title is unavailable. Duplicate detection uses the normalized full URL per account, including fragments. Saved URLs can reveal interests and may contain sensitive information. Remove private parameters before saving. Embedded URL credentials and common authentication parameter names are rejected. Domain initials supply previews locally. BAG does not visit saved sites, inspect their cookies, collect form contents or send browsing analytics. Opening a link uses the current browser profile. The destination controls login expiry and page state.

## Verification
Run `node --test test.mjs` from this folder. Tests use a temporary database.

## 1.1 update
Preserve your working directory and database when upgrading. Stop the old server, copy the new application files over the old ones, and restart using the same database path. Existing items receive an initial type on startup. Reload the unpacked extension from the original directory and accept Chrome's updated permission prompt if shown.

The native context menu position is assigned by Chrome. BAG contributes one direct entry. You can pin BAG to Chrome's toolbar for a fixed location.

BAG suggests one of eleven types using the destination hostname and URL path, with media hints from a right-click. A general website is the fallback. Change the type on the card or choose it when adding a URL manually. Person / Contact saves a profile link. BAG does not import an address book.

Extension saves can include a small JPEG from an already-loaded image associated with the clicked link, the clicked image itself, or a page's indicated preview or main content. Some websites block reading images or have no suitable picture. BAG then uses a domain initial. With a pasted URL, choose a local reference picture; saving a duplicate can supply a previously missing picture. Only the item's owner can retrieve the stored JPEG. Website authentication remains managed by the current browser profile.

Software covers app listings, browser extensions, package registry pages and installer links. Choose Software manually for a software homepage or an existing save.

## Selected text and images
Highlight a passage on a web page, right-click the highlight and choose **To my BAG**. The Text card contains the selected passage and opens its source. Different passages on the same page are separate saves. Selections can contain up to 24,000 characters.

Right-click a standalone image and choose **To my BAG** to save its HTTP or HTTPS image URL. When a thumbnail links to an item, BAG saves the destination and attaches the thumbnail. Title links can reuse a thumbnail from the same card when its association is clear. The card opens the original image and includes a separate source-page link. A local preview is included when the site permits it. Inline data images and temporary blob URLs are unsupported.

## Reference pictures in 1.2.2
Cards prefer a stored thumbnail. When a page supplies a preview URL but the extension cannot copy its pixels, BAG can display that URL directly. Viewing such a card requests the image from its host without a referrer. Previously saved image cards can also display the original image URL. To fill a missing preview on an older page card, revisit that page and save it again. Some sites block embedding or require a currently valid image address.

## AI type detection (1.3)
To enable OpenAI classification, create a private file named .env beside server.mjs containing OPENAI_API_KEY=your-key-here. Replace the placeholder with your own API key. Start from the BAG directory using `node --env-file=.env server.mjs`. Alternatively set OPENAI_API_KEY in the server environment and run the usual start command. BAG_AI_MODEL optionally selects a Chat Completions model supporting strict structured output; the default is gpt-4o-mini.

The dashboard shows whether AI is configured. As you paste, the preview uses local URL rules. On an automatic save or Detect again, the server sends the hostname, URL path, short title and rule suggestion to OpenAI. Paths and titles may contain personal information. Query parameters, fragments, selected passages and pictures are excluded from the classifier request. Manual choices and explicit text/image captures skip AI. Missing credentials, provider errors and timeouts fall back to local classification. API usage is associated with the configured OpenAI account.

## Free local AI with Ollama
Install and start Ollama on the computer running BAG. Run `ollama pull qwen2.5:3b` once. In the BAG folder, set `BAG_AI_PROVIDER=ollama` in .env. Remove any old BAG_AI_MODEL override or set it to qwen2.5:3b. Start BAG with `node --env-file=.env server.mjs`. Local classification uses Ollama on 127.0.0.1:11434 and requires no OpenAI key. Leave Ollama running while you save. If it cannot respond within 45 seconds, BAG falls back to URL rules.

## Cloud signup verification and administration

Before switching production traffic, run the updated schema.sql in the Neon SQL Editor. It can be rerun on the existing database. Existing accounts keep their collections and verify on their next website sign-in. Old website and extension sessions expire on upgrade. These features apply to the Cloudflare/Neon entry point. server.mjs is the older local SQLite demo.

1. Sign in to script.google.com as romanlotsman22@gmail.com, create a new Apps Script project, and paste mail/Code.gs into its script editor.
2. Generate a long random secret with a password manager (at least 32 random bytes). In Apps Script Project Settings → Script properties create MAIL_SECRET with that value.
3. Select Deploy → New deployment → Web app. Set Execute as to Me and access to Anyone so the Worker can reach the endpoint. Authorize sending mail from the owner account and copy the deployed URL ending in /exec. The endpoint accepts only requests carrying the matching secret.
4. Under Cloudflare Worker Settings → Variables and Secrets, create MAIL_SCRIPT_URL with the /exec URL and MAIL_SECRET with the same random value. Keep DATABASE_URL configured. Keep all secret values out of GitHub. Deploy the updated Worker.
5. Sign up as romanlotsman22@gmail.com (or sign in if already registered) and enter the six-digit code from that mailbox. The verified owner sees Manage users in the dashboard. The owner can promote verified active users, demote admins, and suspend or restore other accounts. Admins can suspend or restore ordinary users. All role or suspension changes invalidate the affected user's existing sessions. Suspended collections are preserved.
6. Test with a second mailbox. An incorrect code should fail, the correct code should open the collection, and reusing it should fail. Test promotion, suspension and restoration from the owner dashboard. Restored users sign in again. Google Apps Script mail quotas apply; mail delivery failures block verification.

## Enable Chrome Web Store installation

From the production BAG website download /download-extension. This ZIP has the production API origin and host permission embedded. Upload this extension-only ZIP to the Chrome Web Store developer dashboard. Complete the listing, privacy disclosures and review. After publication, copy the 32-letter extension ID from the listing. In Cloudflare Workers Builds add CHROME_WEB_STORE_ID as a build environment variable and trigger a new build. The homepage button will open the store listing, where Chrome handles user confirmation. Without the build variable the existing manual installation guide is available.
