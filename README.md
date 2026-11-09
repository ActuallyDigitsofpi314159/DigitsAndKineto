# Digits & Kineto

The website for Digits & Kineto (DK Studios), live at **digitsandkineto.com**. It hosts our games, our story, dev updates, and **DK Converter**, an image/GIF encoder, video converter, and audio converter for Khan Academy.

The site is plain HTML, CSS and JavaScript with no build step: every page is a static file, so edit it and push.

## Pages

| Address | What it is | File to edit |
| --- | --- | --- |
| `/` | Homepage: studio banner, featured game, searchable game list | `index.html`, `games/games.js` |
| `/games/<folder>/` | Game page (banner, description, play button, share menu, play count) | `games/<folder>/game.js` |
| `/dash-parkour/` | DASH Parkour 1.1, the playable game | `dash-parkour/index.html` |
| `/dashparkour/` | Old address; forwards to `/dash-parkour/` | (leave as-is) |
| `/about/` | About Us: logo, intro, and our story as a timeline | `about/index.html` |
| `/updates/` | Blog posts / dev updates | `updates/posts.js` |
| `/dkconverter/` | DK Converter | `dkconverter/` |
| `/dkconverterstats/` | DK Converter benchmarks and test tools | `dkconverterstats/` |

## Folders

- `assets/`: shared theme and scripts
  - `site.css` + `site.js`: used by every page (background, header, nav buttons, outlined headings, page fade, footer)
  - `home.css` / `home.js`: homepage
  - `game-registry.js`, `game-page.css`, `game-page.js`: game pages
  - `about.css`: About page · `updates.css` / `updates.js`: Updates page
  - `img/`: images used by pages
- `games/`: one folder per game, plus `games.js` (the homepage game list)
- `updates/`: `posts.js` (all posts) and `images/` (post pictures)
- `website-art/`: original art and design outlines (banner, logo, page mockups). Pages don't load these files.
- `logo.svg`: the DK logo (header, About page, browser tab icon)
- `CNAME`: the custom domain, digitsandkineto.com

## Editing the site

### Adding a game
1. Copy games/dash-parkour/ to games/<new-folder>/ (index.html is identical for every game; leave it as-is)
2. Edit games/<new-folder>/game.js: title, short description, long description, main color, and the link to the playable game
3. Replace cover.jpg (square), banner.jpg (wide, about 4:1) and logo.png (optional, transparent)
4. Add "<new-folder>" to the order list in games/games.js; set `featured` there to change the featured game
- Play counts are stored per visitor in the browser (localStorage key `dk-plays:<folder>`)
- A game that doesn't have a folder yet can show as a "Coming soon" card: add `{ placeholder: true, title: 'Name' }` to the order list in games/games.js, then replace it with the folder name once the game is ready

### Adding an update (blog post)
1. Put the post's image (if any) in updates/images/
2. Open updates/posts.js, copy the template at the top of the file, and paste it into the list
3. Fill in `title`, `date` (YYYY-MM-DD), `description` (use \n\n between paragraphs), `image` (e.g. 'images/my-picture.jpg'), `games` (game folder names, e.g. ['dash-parkour']) and `links` ([{ label, url }])
- Posts are sorted newest first automatically; `image`, `games` and `links` are optional
- Each name in `games` becomes a card with that game's cover, title, color and a Play button (taken from its game.js)
- Links to other websites open in a new tab
- Each post gets a shareable link: /updates/#post-title
- If text contains an apostrophe, wrap it in double quotes: "We're back!"

### Editing the About page
- The text is in about/index.html. Each part of the story is one `<li class="chapter">` block with a year, a heading and a paragraph; copy a block to add a new chapter.
- The quick facts under the intro are the `<ul class="about-stats">` list.

### Top navigation
- The nav buttons are listed in `NAV` at the top of assets/site.js. A button with an empty `href` shows as locked ("Soon…"), like the current `???` button.

### Contact email and footer
- The footer (with the contact email) is written into each page's HTML: index.html, about/index.html, updates/index.html, dkconverter/index.html and dkconverterstats/index.html. Change it in all five.

## Previewing locally

Run a small web server from the repository folder, then open http://localhost:8000:

```
python3 -m http.server 8000
```

Opening the HTML files directly (file://) mostly works, but DK Converter's background compression worker and some browser features need a real server.

## DK Converter

### Features
- Provides a 0–100 image-quality control, defaulting to 50; level 100 preserves source pixels before any optional color cap
- Applies browser JPEG encoding to opaque still images below quality 100; an optional color cap is applied after JPEG decoding, while transparent and animated media use lossy WebP processing
- Lets you choose a maximum longest-side output dimension, with no app-imposed upper bound, while preserving aspect ratio
- Treats a blank maximum output resolution as uncapped and offers GIF/video frame limits (default 30), sampling at whole-frame intervals
- Offers an editable pixel-art mode with quoted row strings, a character-to-color map, and batched horizontal rectangle runs
- Keeps color capping independent from image quality: optional in standard images, GIFs, and video, and required for pixel-art mode
- Applies a manually entered maximum-color cap in either mode; pixel art supports up to 93 colors, while standard mode supports up to 1,048,576 palette bins
- Uses an automatic cap of min(256, floor(output pixels / 500)) when the maximum-colors field is blank, capped at 93 colors in pixel-art mode
- Encodes RGBA payloads or bit-packed capped-color palette indices using adaptive PNG-style row filters, Zstandard level 19, and a 200-symbol Khan-safe alphabet (printable ASCII plus Latin letters)
- Uses 4-byte blocks packed into 5 characters and decoded with native numbers, with compression and text-encoding progress updates
- Renders through a cached image buffer instead of drawing colored rectangles
- Preserves sampled GIF frame pixels and combines skipped-frame delays; video frame timing is sampled from the reported frame rate
- Converts browser-decodable videos locally with FFmpeg.wasm, applies image quality to sampled frames, optionally shares one color palette across GIF/video frames, stores later capped frames as packed-index deltas against the previous frame, compresses every frame of an animation in one Zstandard stream so later frames reuse earlier-frame context, embeds MP3 audio with the 200-symbol alphabet, and provides a separate audio quality control from 1–100 (default 20), down to mono 8 kbps at 8 kHz resampled 4× faster and played back at 0.25× at the lowest settings
- Converts audio files to compressed MP3 with a single audio-quality control and generated Khan Academy playback code
- Downloads the pinned FFmpeg.wasm runtime on the first video conversion (about 32 MB); video and audio files are processed locally and are not uploaded
- Shows conversion progress while GIF frames are decoded and compressed
- Keeps each generated image/GIF payload scoped to its own draw function
- Builds a media-specific utility bundle containing only the selected image renderer and required decoder; JPEG utilities are 11,839 characters uncapped and 13,619 with color limiting
- Shows bounded top-and-bottom previews of utility and generated code while retaining full utility, image, and combined copy actions
- Uses a compact Base-K JPEG payload and independent baseline decoder for opaque lossy still images, DKL for lossless RGBA, DKC5 for bit-packed color-capped payloads, and DKP2 for readable editable pixel art
- Uses the same alphabet in generated data and the utility; outputs from prior alphabet formats (DKL1–DKL3 and DKC1–DKC4) are not supported by this decoder

### Usage
- Upload or drag-and-drop an image, GIF, browser-decodable video, or audio file.
- For images, GIFs, and video, choose an image quality from 0 to 100; 100 is lossless before any optional color cap. Below 100, opaque still images use browser JPEG encoding, with an optional color cap applied after decoding; transparent images, GIFs, and videos use lossy WebP. Color capping is an independent optional control. For plain audio, choose only the separate audio quality level from 1 to 100.
- Leave maximum output resolution blank to use source dimensions. GIF and video frame limits default to 30; leave either blank to keep every frame.
- Copy the generated image code and its media-specific utility into Khan Academy, or use **Copy All** to copy both at once. The on-page code is only a bounded preview; copy actions include the full code.
- Call the generated media function; for GIFs and videos, pass the current `frameCount` as shown in its usage comment.

Image quality 100 leaves source pixels unchanged before DK encoding. Below 100, opaque still images use browser JPEG encoding and the included baseline JPEG decoder; an optional color cap is applied to decoded JPEG pixels before rendering. Transparent images, GIFs, and videos use lossy WebP processing. The color cap can be enabled independently at any image quality; a blank maximum-color value selects min(256, floor(output pixels / 500)). Pixel-art mode always forces color capping on and emits editable quoted row strings plus a character-to-color map. GIF and video color capping is optional and, when enabled, builds one shared palette for the whole animation, then stores later frames as packed-index deltas against the previous frame. Uncapped animations store all sampled frames in one Zstandard stream. Each audio quality level from 1 to 100 uses a distinct mix of MP3 bitrate, sample rate, channel count, low-pass cutoff, and (at levels 1–20) encode speed, from mono 8 kbps at 8 kHz resampled 4× faster up to stereo 320 kbps at 44.1 kHz. The generated video example starts synchronized audio and animation when the canvas is clicked. Generated video stores frames and Base-K encoded MP3 audio in one JavaScript data object. Generated functions use a randomized three-digit suffix, such as `drawImage123`.

Video and audio conversion use the browser-loaded FFmpeg.wasm core from jsDelivr; an internet connection and a first-time runtime download (about 32 MB) are required. Video and audio data remain in the browser.

### Benchmarks and checks
- `/dkconverterstats/` shows benchmark results; `/dkconverterstats/media-smoke.html` runs local media checks in the browser.
- The `.cjs` scripts in dkconverterstats/ are Node.js tools. Run them from the repository root, e.g. `node dkconverterstats/benchmark.cjs`. The benchmark downloads a competitor's source from GitHub on its first run.

## Contributing
- Contributions welcome. Open an issue or submit a pull request.

## License
- Licensed under the MIT License

## Contact
- Digitsofpi at actuallydigitsofpi314159@gmail.com
