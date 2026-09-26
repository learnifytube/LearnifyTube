# Browsing YouTube's recommendation feed inside the app

LearnifyTube does not show YouTube's recommendation feed, home page or autoplay "up next". It does not gate that feed behind time windows or daily phases either (for example "browse recommendations in the morning, then watch only a playlist of the day").

## Why this is out of scope

LearnifyTube is intentional watching by design. You pick Videos on purpose (by URL, or from a channel, subscription or playlist), the desktop app downloads them with yt-dlp, and you watch them offline on desktop, phone or TV, with transcripts, word lookup and flashcards. The app has no recommendation surface, and autoplay is a player setting that is off by default.

A recommendation-driven "browsing phase" would mean pulling YouTube's personalised feed into the app. That requires either embedding youtube.com with the user's signed-in session or scraping recommendations. Both work against the app's local-first, offline design. It would also bring back the exact distraction surface the product exists to avoid. The phase and lock-down part of the idea (feed by day, a locked playlist by night) is the product of a YouTube wrapper or browser extension. It is not a feature of a download-and-study app.

What already covers the underlying need, "watch only what I chose":

- Downloading chosen Videos and playing them offline, with no feed (desktop, phone, TV)
- Custom playlists (`apps/desktop/src/pages/my-playlists`) as a hand-picked list to watch
- Autoplay off by default (`apps/desktop/src/lib/types/user-preferences.ts`)

A narrower request that works with the existing library, such as a "today's playlist" that hides everything else, would be a separate idea and is not covered by this rejection.

## Prior requests

- #1 — "Learnify and get back agentivity"
