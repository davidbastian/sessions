---
name: style-transfer
description: Re-render one picture in the visual style of another, changing nothing about what it shows.
inputs:
  - style: the picture that lends its look
  - content: the picture that keeps its subject, pose and framing
outputs:
  - one image
---

## Instruction

Image 1 is the STYLE reference. Image 2 is the CONTENT image.

Re-render image 2 exactly as it is — same subject, pose, framing, composition,
and every detail — but entirely in the visual style of image 1: its art
direction, color palette, lighting, texture, and overall aesthetic.

Do not change what is in image 2. Only change how it looks, to match image 1's
style.

## Direction

Additional direction from the user: "{{direction}}"

## Single output

Output ONE single image only — the restyled version of image 2. Do NOT show
image 1 anywhere in the output, do NOT place the two images side by side or in a
collage/grid, and do NOT crop or split the canvas. The result must be a single
standalone image with the same framing as image 2.
