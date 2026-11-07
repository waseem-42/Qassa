# Short silent-source rendering — fixed 2026-10-29

## Finding

The failure was reproduced with FFmpeg `8.1.2-full_build-www.gyan.dev`, CPU encoding, two seconds, 64×64, 24 fps. It was not specific to the final preset: both preview AAC160k and final AAC320k failed with `Input contains (near) NaN/+-Inf`. A source with no audio stream and a source containing a real digitally silent AAC stream both failed. The same compiler rendered a silent source with an audible music bed successfully.

The first regression run deliberately preceded the fix: three silent cases failed and the audible-bed case passed. This establishes a media-dependent failure, not a TypeScript, cache, hardware encoder or sandbox-only failure.

Independent filter probes isolated the problem:

```powershell
# Two seconds: fails on this build; anull alone succeeds.
ffmpeg -f lavfi -i anullsrc=r=48000:cl=stereo:d=2 -af loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000 -c:a aac -b:a 320k silent.m4a

# Five seconds through the original loudnorm chain succeeds.
# Two seconds with a minimum three-second internal window succeeds:
ffmpeg -f lavfi -i anullsrc=r=48000:cl=stereo:d=2 -af apad=whole_dur=3,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000 -t 2 -c:a aac -b:a 320k silent-fixed.m4a
```

These are diagnostic commands; the probes ran in `artifacts/silent-audio-probe/`, not over user files. Raw stderr from the baseline and padded filter probes remains there. The padded probe's astats output reported zero NaNs and peak/RMS `-inf`; ffprobe reported `2.000000` seconds.

The [official FFmpeg loudnorm source](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavfilter/af_loudnorm.c) has a special first-frame branch for inputs shorter than 3000 ms, calculates a gain from integrated loudness and a true-peak divisor, then applies it in linear mode. Static reading explains the observed zero-input/nonfinite-gain failure; the local controlled probes establish that it occurs in this installed build. This is not a claim that every FFmpeg release behaves identically.

## Fix

`packages/render/src/compile.ts` adds `apad=whole_dur=3` immediately before the shared final `loudnorm` chain. This gives the normalizer its full startup window even when the actual edit is shorter. `whole_dur` leaves audio already at least three seconds long alone. The existing final `-t <edit duration>` limits the actual output, so the user gets the original edit duration. The change covers source silence and silence after mixing without guessing audio content from `hasAudio` metadata.

An alternative probe added an extremely small denormal-prevention signal before normalization. Although it avoided the encoder error, the short-input gain raised that signal to approximately -1.5 dBFS/DC. It was rejected and is not in the implementation. The fix introduces no noise and does not bypass loudness normalization on audible content.

Only final-pass audio preparation changed. Segment commands and cached segment identities are unchanged; the final pass already runs for every export, so no segment cache version bump is needed.

## Verification

`packages/render/test/silent-audio.test.ts` creates real temporary fixtures and runs `runPlan(compile(...))` with the CPU encoder. It checks:

1. Two-second silent video with no audio stream: final export succeeds.
2. The same source: preview succeeds.
3. Two-second video with a present but silent audio stream: final succeeds.
4. A four-second silent edit: duration stays four seconds.
5. Audible music over a silent main track: remains nonzero and below full scale.

Every result is probed for original dimensions, expected duration, H.264, stereo AAC and 48 kHz. AAC is then decoded to float PCM: all samples must be finite; the four silent results must have exactly zero peak. The music result must have a positive bounded peak. Tests operate in a guarded temporary folder and clean up only that test folder.

Final targeted run:

```text
npm test -- packages/render/test/silent-audio.test.ts packages/render/test/compile.test.ts packages/server/test/export-preflight.test.ts
3 test files passed; 36 tests passed
```

This validates CPU rendering and the tested mixes on the local FFmpeg build. It is not a hardware-encoder or all-format test, and no source media belonging to the user was modified.
