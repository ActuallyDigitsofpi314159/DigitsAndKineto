This is a homepage for our projects that currently hosts **DK Converter**, an image/GIF encoder, video converter, and audio converter. Future plans: host games we coded and showcase other projects.

Features
- Provides a 0–100 image-quality control, defaulting to 50; level 100 preserves source pixels before any optional color cap
- Applies browser JPEG encoding to opaque still images below quality 100; an optional color cap is applied after JPEG decoding, while transparent and animated media use lossy WebP processing
- Lets you choose a maximum longest-side output dimension, with no app-imposed upper bound, while preserving aspect ratio
- Treats a blank maximum output resolution as uncapped and offers GIF/video frame limits (default 30), sampling at whole-frame intervals
- Offers an editable pixel-art mode with quoted row strings, a character-to-color map, and batched horizontal rectangle runs
- Keeps color capping independent from image quality: optional in standard images, GIFs, and video, and required for pixel-art mode
- Applies a manually entered maximum-color cap in either mode; pixel art supports up to 93 colors, while standard mode supports up to 1,048,576 palette bins
- Uses an automatic cap of min(256, floor(output pixels / 500)) when the maximum-colors field is blank, capped at 93 colors in pixel-art mode
- Applies JPEG encoding to opaque still images below quality 100, then applies any optional color cap before rendering; transparent/animated media use lossy WebP before palette capping. Quality 100 preserves source pixels before color capping
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

Website
- Visit: digitsandkineto.com
- Homepage: /
- DK Converter: /dkconverter/

Usage
- Upload or drag-and-drop an image, GIF, browser-decodable video, or audio file.
- For images, GIFs, and video, choose an image quality from 0 to 100; 100 is lossless before any optional color cap. Below 100, opaque still images use browser JPEG encoding, with an optional color cap applied after decoding; transparent images, GIFs, and videos use lossy WebP. Color capping is an independent optional control. For plain audio, choose only the separate audio quality level from 1 to 100.
- Leave maximum output resolution blank to use source dimensions. GIF and video frame limits default to 30; leave either blank to keep every frame.
- Copy the generated image code and its media-specific utility into Khan Academy, or use **Copy All** to copy both at once. The on-page code is only a bounded preview; copy actions include the full code.
- Call the generated media function; for GIFs and videos, pass the current `frameCount` as shown in its usage comment.

Image quality 100 leaves source pixels unchanged before DK encoding. Below 100, opaque still images use browser JPEG encoding and the included baseline JPEG decoder; an optional color cap is applied to decoded JPEG pixels before rendering. Transparent images, GIFs, and videos use lossy WebP processing. The color cap can be enabled independently at any image quality; a blank maximum-color value selects min(256, floor(output pixels / 500)). Pixel-art mode always forces color capping on and emits editable quoted row strings plus a character-to-color map. GIF and video color capping is optional and, when enabled, builds one shared palette for the whole animation, then stores later frames as packed-index deltas against the previous frame. Uncapped animations store all sampled frames in one Zstandard stream. Each audio quality level from 1 to 100 uses a distinct mix of MP3 bitrate, sample rate, channel count, low-pass cutoff, and (at levels 1–20) encode speed, from mono 8 kbps at 8 kHz resampled 4× faster up to stereo 320 kbps at 44.1 kHz. The generated video example starts synchronized audio and animation when the canvas is clicked. Generated video stores frames and Base-K encoded MP3 audio in one JavaScript data object. Generated functions use a randomized three-digit suffix, such as `drawImage123`.

Video and audio conversion use the browser-loaded FFmpeg.wasm core from jsDelivr; an internet connection and a first-time runtime download (about 32 MB) are required. Video and audio data remain in the browser.

Contributing
- Contributions welcome. Open an issue or submit a pull request.

License
- Licensed under the MIT License

Contact
- Digitsofpi at actuallydigitsofpi314159@gmail.com
