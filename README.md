This is a homepage for our projects that currently hosts **DK Converter**, a lossless image/GIF encoder, color-limited video converter, and audio converter. Future plans: host games we coded and showcase other projects.

Features
- Preserves RGBA color and transparency at the selected output dimensions when no color cap is set
- Lets you choose a maximum longest-side output dimension, with no app-imposed upper bound, while preserving aspect ratio
- Treats a blank maximum output resolution as uncapped and offers GIF/video frame limits (default 30), sampling at whole-frame intervals
- Offers an editable pixel-art mode with quoted row strings, a character-to-color map, and batched horizontal rectangle runs
- Makes color capping optional in standard mode and always enabled in pixel-art mode
- Applies a manually entered maximum-color cap in either mode; pixel art supports up to 93 colors, while standard mode supports up to 1,048,576 palette bins
- Uses an automatic cap of one color per 500 output pixels when the maximum-colors field is blank, capped at 93 colors in pixel-art mode
- Leaves standard image mode uncapped and lossless when color capping is disabled; when enabled, quantizes colors and stores the palette RGBA bytes inside the compressed pixel-data stream before image rendering
- Encodes lossless RGBA or bit-packed capped-color palette indices using 2,115 symbols: printable ASCII, filtered two-byte UTF-8 characters, and 474 precomposed three-byte Latin/Greek letters, with block-based base-k encoding, adaptive pixel-delta filtering, and chunked LZSS compression
- Compresses smaller independent chunks in up to four Web Workers when available, with progress updates during compression and text encoding
- Renders through a cached image buffer instead of drawing colored rectangles
- Preserves sampled GIF frame pixels and combines skipped-frame delays; video frame timing is sampled from the reported frame rate
- Converts browser-decodable videos locally with FFmpeg.wasm, forces color reduction, embeds MP3 audio, and provides an audio quality control from 1–100 (default 20), down to mono 8 kbps at 8 kHz with a strong low-pass filter at the lowest settings
- Converts audio files to compressed MP3 with a single audio-quality control and generated Khan Academy playback code
- Downloads the pinned FFmpeg.wasm runtime on the first video conversion (about 32 MB); video and audio files are processed locally and are not uploaded
- Shows conversion progress while GIF frames are decoded and compressed in bounded batches
- Keeps each generated image/GIF payload scoped to its own draw function
- Shows bounded top-and-bottom previews of utility and generated code while retaining full utility, image, and combined copy actions
- Uses DKL4 for uncapped lossless images, DKC5 for capped-color images with an embedded compressed palette, and DKP2 for readable editable pixel art
- Uses the same alphabet in generated data and the utility; outputs from prior alphabet formats (DKL1–DKL3 and DKC1–DKC4) are not supported by this decoder

Website
- Visit: digitsandkineto.com
- Homepage: /
- DK Converter: /dkconverter/

Usage
- Upload or drag-and-drop an image, GIF, browser-decodable video, or audio file.
- For plain audio, choose only an audio quality level from 1 to 100. Copy the generated function and call it from a user click to play.
- Leave maximum output resolution blank to use source dimensions. GIF and video frame limits default to 30; leave either blank to keep every frame.
- Copy the generated image code and the utility code into Khan Academy, or use **Copy All** to copy both at once. The on-page code is only a bounded preview; copy actions include the full code.
- Call the generated media function; for GIFs and videos, pass the current `frameCount` as shown in its usage comment.

Standard image mode is lossless when **Cap colors** is unchecked. Checking it enables the maximum-colors field; a blank value selects the automatic limit based on output pixels. Pixel-art mode always forces color capping on and emits editable quoted row strings plus a character-to-color map. Video always uses color reduction and embeds MP3 audio. Its audio quality level maps to an MP3 bitrate from 8 to 320 kbps; MP3 cannot encode below 8 kbps, so the lowest settings also use mono, reduced sample rates, and a strong low-pass filter. The generated video example starts synchronized audio and animation when the canvas is clicked. Generated video and audio are combined into one lazily parsed data string inside a helper function. Generated functions use a randomized three-digit suffix, such as `drawImage123`.

Video and audio conversion use the browser-loaded FFmpeg.wasm core from jsDelivr; an internet connection and a first-time runtime download (about 32 MB) are required. Video and audio data remain in the browser. Generated combined video/audio data uses the utility's JSON-compatible parser because Khan Academy does not provide `JSON.parse`; it is included only for video output.

Contributing
- Contributions welcome. Open an issue or submit a pull request.

License
- Licensed under the MIT License

Contact
- Digitsofpi at actuallydigitsofpi314159@gmail.com
