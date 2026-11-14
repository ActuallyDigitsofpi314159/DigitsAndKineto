/* DK Converter: MIDI -> compact note data (DKM1) for Khan Academy.
 *
 * The MIDI file is read here in the browser and turned into a plain list of notes
 * (start time, length, pitch, loudness, channel, instrument family). The notes are
 * stored column by column (all start times, then all lengths, ...) as small numbers,
 * which Zstandard squeezes very well. The KA utility (DK MIDI SUPPORT) decodes the
 * same layout and plays it with Web Audio.
 *
 * DKM1 layout (every "v" is an unsigned LEB128 varint):
 *   v version (1)   v bpm   v song length in ms   v note count
 *   v[count] start of each note, in ms after the previous note's start
 *   v[count] note length in ms
 *   u8[count] pitch (MIDI note number 0-127)
 *   u8[count] velocity (1-127)
 *   u8[count] channel (low 4 bits) + instrument family << 4
 */
'use strict';

// Instrument families the KA player knows how to voice
const DK_MIDI_FAMILY = { keys: 0, organ: 1, bass: 2, pad: 3, lead: 4, pluck: 5 };

// General MIDI program number (0-127) -> instrument family
function dkMidiFamilyForProgram(program) {
    if (program <= 7) return DK_MIDI_FAMILY.keys;       // pianos
    if (program <= 15) return DK_MIDI_FAMILY.pluck;     // bells, mallets
    if (program <= 23) return DK_MIDI_FAMILY.organ;     // organs, accordion
    if (program <= 31) return DK_MIDI_FAMILY.pluck;     // guitars
    if (program <= 39) return DK_MIDI_FAMILY.bass;      // basses
    if (program <= 55) return DK_MIDI_FAMILY.pad;       // strings, ensembles, choir
    if (program <= 79) return DK_MIDI_FAMILY.lead;      // brass, reeds, pipes
    if (program <= 87) return DK_MIDI_FAMILY.lead;      // synth leads
    if (program <= 95) return DK_MIDI_FAMILY.pad;       // synth pads
    if (program <= 103) return DK_MIDI_FAMILY.pad;      // synth effects
    if (program <= 111) return DK_MIDI_FAMILY.pluck;    // ethnic (sitar, koto...)
    return DK_MIDI_FAMILY.keys;
}

// Reads a Standard MIDI File. Returns { bpm, notes, lengthSeconds, trackCount }.
// notes: [{ start, duration, pitch, velocity, channel, family }] in seconds, sorted by start.
function parseMIDIFile(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const length = bytes.length;
    let pos = 0;

    function readString(count) {
        let text = '';
        for (let i = 0; i < count && pos < length; i++) text += String.fromCharCode(bytes[pos++]);
        return text;
    }
    function read16() {
        if (pos + 2 > length) { pos = length; return 0; }
        const value = (bytes[pos] << 8) | bytes[pos + 1];
        pos += 2;
        return value;
    }
    function read32() {
        if (pos + 4 > length) { pos = length; return 0; }
        const value = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
        pos += 4;
        return value;
    }
    function readVarLen() {
        let value = 0;
        let b = 0;
        let guard = 0;
        do {
            if (pos >= length) break;
            b = bytes[pos++];
            value = value * 128 + (b & 0x7F);
        } while ((b & 0x80) && ++guard < 4);
        return value;
    }

    // Some files (RIFF "RMID") wrap the MIDI data; find the real header.
    const headerAt = (() => {
        for (let i = 0; i + 4 <= Math.min(length, 4096); i++) {
            if (bytes[i] === 0x4D && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) return i;
        }
        return -1;
    })();
    if (headerAt < 0) throw new Error('This is not a MIDI file (no "MThd" header found).');
    pos = headerAt + 4;
    const headerLength = read32();
    const headerEnd = pos + headerLength;
    read16(); // format (0, 1 or 2) - every track is merged either way
    const trackCount = read16();
    const division = read16();
    pos = Math.max(pos, Math.min(headerEnd, length));
    if (division & 0x8000) {
        throw new Error('This MIDI file uses SMPTE timing, which is not supported. Re-save it with musical (ticks per beat) timing.');
    }
    const ticksPerBeat = division > 0 ? division : 480;

    const events = []; // { ticks, order, kind, ... }
    let order = 0;
    for (let track = 0; track < trackCount && pos + 8 <= length; track++) {
        // skip any unknown chunks until the next track
        let id = readString(4);
        let chunkLength = read32();
        while (id !== 'MTrk' && pos < length) {
            pos += chunkLength;
            if (pos + 8 > length) break;
            id = readString(4);
            chunkLength = read32();
        }
        if (id !== 'MTrk') break;
        const trackEnd = Math.min(length, pos + chunkLength);
        let ticks = 0;
        let runningStatus = 0;
        while (pos < trackEnd) {
            ticks += readVarLen();
            if (pos >= trackEnd) break;
            let status = bytes[pos];
            if (status & 0x80) {
                pos++;
                if (status < 0xF0) runningStatus = status;
            } else {
                status = runningStatus;
                if (!status) { pos++; continue; } // data byte with no status: skip it
            }
            const type = status >> 4;
            const channel = status & 0x0F;
            if (type === 0x8 || type === 0x9) {
                const pitch = bytes[pos++] & 0x7F;
                const velocity = (bytes[pos++] || 0) & 0x7F;
                events.push({
                    ticks, order: order++, channel, pitch,
                    kind: type === 0x9 && velocity > 0 ? 'on' : 'off',
                    velocity
                });
            } else if (type === 0xC) {
                events.push({ ticks, order: order++, kind: 'program', channel, program: bytes[pos++] & 0x7F });
            } else if (type === 0xA || type === 0xB || type === 0xE) {
                pos += 2;
            } else if (type === 0xD) {
                pos += 1;
            } else if (status === 0xFF) {
                const metaType = bytes[pos++];
                const metaLength = readVarLen();
                if (metaType === 0x51 && metaLength === 3 && pos + 3 <= length) {
                    const microsecondsPerBeat = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
                    if (microsecondsPerBeat > 0) {
                        events.push({ ticks, order: order++, kind: 'tempo', microsecondsPerBeat });
                    }
                }
                if (metaType === 0x2F) { pos = trackEnd; break; } // end of track
                pos += metaLength;
            } else if (status === 0xF0 || status === 0xF7) {
                pos += readVarLen();
            } else {
                pos++; // other system messages carry no data we need
            }
        }
        pos = trackEnd;
    }

    // Tempo changes apply to every track, so walk all events in time order.
    // At the same tick: tempo first, then note-offs, then everything else.
    const rank = { tempo: 0, program: 1, off: 2, on: 3 };
    events.sort((a, b) => a.ticks - b.ticks || rank[a.kind] - rank[b.kind] || a.order - b.order);
    let microsecondsPerBeat = 500000;
    let firstBPM = 0;
    let seconds = 0;
    let lastTicks = 0;
    const programs = new Array(16).fill(0);
    const active = new Map(); // channel*128+pitch -> [{ start, velocity, family }]
    const notes = [];
    let lastSeconds = 0;

    function closeNote(key, channel, pitch, at) {
        const stack = active.get(key);
        if (!stack || !stack.length) return;
        const started = stack.shift(); // first in, first out for overlapping repeats
        if (!stack.length) active.delete(key);
        notes.push({
            start: started.start,
            duration: Math.max(0.02, at - started.start),
            pitch,
            velocity: Math.max(1, started.velocity),
            channel,
            family: channel === 9 ? 0 : started.family
        });
    }

    for (const event of events) {
        seconds += (event.ticks - lastTicks) * microsecondsPerBeat / (ticksPerBeat * 1e6);
        lastTicks = event.ticks;
        lastSeconds = seconds;
        if (event.kind === 'tempo') {
            microsecondsPerBeat = event.microsecondsPerBeat;
            if (!firstBPM) firstBPM = Math.round(60e6 / microsecondsPerBeat);
        } else if (event.kind === 'program') {
            programs[event.channel] = event.program;
        } else {
            const key = event.channel * 128 + event.pitch;
            if (event.kind === 'on') {
                if (!active.has(key)) active.set(key, []);
                active.get(key).push({
                    start: seconds,
                    velocity: event.velocity,
                    family: dkMidiFamilyForProgram(programs[event.channel])
                });
            } else {
                closeNote(key, event.channel, event.pitch, seconds);
            }
        }
    }
    // notes that never got a note-off end with the song
    for (const [key, stack] of Array.from(active.entries())) {
        while (stack.length) closeNote(key, Math.floor(key / 128), key % 128, Math.max(lastSeconds, stack[0].start + 0.5));
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    let lengthSeconds = 0;
    for (const note of notes) lengthSeconds = Math.max(lengthSeconds, note.start + note.duration);
    return { bpm: firstBPM || 120, notes, lengthSeconds, trackCount };
}

function dkPushVarint(out, value) {
    value = Math.max(0, Math.round(value));
    while (value >= 128) {
        out.push((value % 128) | 128);
        value = Math.floor(value / 128);
    }
    out.push(value);
}

// Notes -> DKM1 bytes (before Zstandard). Times are rounded to whole milliseconds.
function packMIDINotes(parsed) {
    const notes = parsed.notes;
    const out = [];
    dkPushVarint(out, 1);
    dkPushVarint(out, parsed.bpm);
    dkPushVarint(out, Math.ceil(parsed.lengthSeconds * 1000));
    dkPushVarint(out, notes.length);
    let previousStart = 0;
    for (const note of notes) {
        const start = Math.round(note.start * 1000);
        dkPushVarint(out, start - previousStart);
        previousStart = start;
    }
    for (const note of notes) dkPushVarint(out, Math.max(1, Math.round(note.duration * 1000)));
    for (const note of notes) out.push(note.pitch & 127);
    for (const note of notes) out.push(note.velocity & 127);
    for (const note of notes) out.push((note.channel & 15) | ((note.family & 15) << 4));
    return new Uint8Array(out);
}

// DKM1 bytes -> notes (the same steps the KA player takes; used to self-check output)
function unpackMIDINotes(bytes) {
    let pos = 0;
    function varint() {
        let value = 0;
        let scale = 1;
        let b;
        do {
            if (pos >= bytes.length) throw new Error('DKM1 data ended early.');
            b = bytes[pos++];
            value += (b & 127) * scale;
            scale *= 128;
        } while (b & 128);
        return value;
    }
    const version = varint();
    if (version !== 1) throw new Error('Unknown DKM version ' + version);
    const bpm = varint();
    const lengthMs = varint();
    const count = varint();
    const notes = [];
    let start = 0;
    for (let i = 0; i < count; i++) { start += varint(); notes.push({ start: start / 1000 }); }
    for (let i = 0; i < count; i++) notes[i].duration = varint() / 1000;
    for (let i = 0; i < count; i++) notes[i].pitch = bytes[pos++];
    for (let i = 0; i < count; i++) notes[i].velocity = bytes[pos++];
    for (let i = 0; i < count; i++) {
        const packed = bytes[pos++];
        notes[i].channel = packed & 15;
        notes[i].family = packed >> 4;
    }
    if (pos !== bytes.length) throw new Error('DKM1 data has extra bytes.');
    return { bpm, lengthSeconds: lengthMs / 1000, notes };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseMIDIFile, packMIDINotes, unpackMIDINotes, dkMidiFamilyForProgram };
}
