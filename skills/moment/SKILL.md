---
name: moment
description: Generate the instant before or after a captured frame, keeping everyone and everything in it identical.
inputs:
  - frame: the captured moment, treated as T=0
  - direction: before or after
  - seconds: how far from the frame to go
outputs:
  - one image, as if an adjacent frame of the same sequence
---

## Instruction

[MOMENT GENERATION]
The attached image is a captured frame — a single frozen moment in time (T=0).{{context}}

Generate a realistic, photorealistic image showing what this scene looked like
exactly {{timeLabel}} this captured moment.

Critical requirements:
- Keep every subject (people, athletes, animals, objects) visually IDENTICAL —
  same faces, clothing, body type, colors, and physical characteristics. Do not
  change how anyone looks.
- Maintain the exact same location, background, environment, and camera
  angle/framing.
- Maintain consistent lighting direction, quality, and color temperature.
- Show the PHYSICALLY REALISTIC action that would naturally occur {{timeLabel}}
  this moment — based on the physics and narrative logic of what is shown in the
  image.
  {{lead}}
- The result should feel indistinguishable from a real adjacent frame of the
  same video or photo sequence.

## Before

This means: show the lead-up, anticipation, or preparation that would precede
this moment.

## After

This means: show the natural physical consequence, continuation, or aftermath of
this moment.
