# Elevation Ad Generator

A small Next.js app that generates on-brand vacancy ads (1080×1350).
It has two faces:

- **A form** (the home page) for making ads by hand.
- **An API** (`/api/og`) that returns the finished PNG from a URL — this is
  what Zapier calls for the automated "new job → ad" pipeline.

Both use the **same renderer**, so a hand-made ad and an automated one look
identical. Because it's real code (not a fixed-canvas tool), the green sector
label sits above the title and moves up with it, and the green full stop is
built in — no workarounds needed.

---

## 1. Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## 2. Add your assets

Because all the branding (tint, "New Vacancy" pill, rings, logo, web address and
the (i) icon) is baked into your **finished background photos**, the app only
draws three things on top: the green sector line, the title (with green dot),
and the location | salary line. So there's just one asset to add:

1. **Background photos** — put your finished, branded, tinted `DSC*.jpg` images
   in `public/backgrounds/`. Every image must use the **same layout** (same tint,
   same logo/pill/(i) positions, 1080×1350) — only the photo behind changes — or
   the wording won't line up across all of them. The filenames are listed in
   `lib/config.js` (`BACKGROUNDS`); edit that list to match what you upload. To
   host them on a CDN instead, set `PHOTO_BASE_URL` in `lib/config.js`.
2. **Font** — the Area brand font is already included in `app/fonts/` (ExtraBold
   for the title, SemiBold for the sector and location lines) and wired into the
   renderer. Nothing to do.

### Lining the wording up

The wording positions are set by constants at the top of
`app/api/og/route.js` (`TEXT_LEFT`, `TITLE_BLOCK_BOTTOM`, `LOCATION_LEFT`,
`LOCATION_BOTTOM`, etc.), all measured in pixels from the bottom of the canvas.
They're pre-set to match your layout; if the text sits a few pixels off against
your real photos, nudge these numbers and redeploy.

## 3. Deploy to Vercel

1. Push this folder to a GitHub repo on your **company** account.
2. In Vercel (company account), **New Project → Import** that repo → **Deploy**.
3. That's it. Your API is live at:
   `https://YOUR-APP.vercel.app/api/og`

---

## The API (what Zapier calls)

`GET /api/og` returns a PNG. Parameters:

| Param             | Example                     | Notes                                                        |
|-------------------|-----------------------------|--------------------------------------------------------------|
| `division`        | `Accountancy & Finance`     | Green line. If `Engineering & Manufacturing`, split by consultant. |
| `consultant`      | `Chris Ridgway`             | Only used to split the combined division. Also name the email. |
| `title`           | `Group Financial Accountant`| Green full stop added automatically.                         |
| `location`        | `West Yorkshire`            | First segment of the info line.                              |
| `salary_from`     | `90000`                     | Formatted to `£90k`.                                          |
| `salary_to`       | `110000`                    | Range becomes `£90k - £110k`.                                 |
| `hide_salary`     | `yes` / `no`                | `yes` shows `£Competitive`.                                   |
| `employment_type` | `Contract` / `Permanent` / `Temporary` | Adds a 3rd segment for Contract/Temporary.        |
| `working_pattern` | `Full-time` / `Part-time`   | Adds a 3rd segment for Part-time.                            |
| `image`           | `auto`                      | `auto` picks a random background.                            |
| `token`           | secret                      | If `SHARE_TOKEN` is set in Vercel.                          |

**Example:**

```
https://YOUR-APP.vercel.app/api/og?sector=PROCUREMENT%20%26%20SUPPLY%20CHAIN&title=Assistant%20Quantity%20Surveyor&location=Leeds&salary=45000&image=auto
```

Everything in the URL must be **URL-encoded** (spaces become `%20`, `&` becomes
`%26`, and so on). In Zapier this happens for you when you map fields into the
URL builder.

---

## Wiring it into Zapier

Your Zap:

1. **Trigger** — new job from your LogicMelon → website feed (RSS by Zapier, or
   Webhooks polling the feed URL).
2. **(Optional) Formatter/Code** — tidy the fields if needed.
3. **Webhooks by Zapier → GET** — the URL is
   `https://YOUR-APP.vercel.app/api/og`, and you add the query parameters
   (`sector`, `title`, `location`, `salary`, `image`) mapping each to the feed
   field. Zapier encodes them for you. The response is the finished PNG.
4. **Destination** — save the image or pass it to your posting step.

Because `image=auto` re-rolls on every call, each ad gets a random background
with no extra steps. Want random-within-sector instead? Split `BACKGROUNDS`
into per-sector lists in `lib/config.js` and pick from the one matching
`sector`.

### Locking the API down (recommended)

As written, anyone who knows the URL can generate an image. If you'd rather it
be private, add a secret: in `app/api/og/route.js` read a `token` query param
and reject the request unless it matches an env var you set in Vercel. Then add
that same `token` to the Zapier call.
