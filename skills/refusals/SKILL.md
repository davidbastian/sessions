---
name: refusals
description: What to send instead when an image model declines a photograph of real people.
inputs:
  - the images that were refused
outputs:
  - a prompt built from words rather than photographs
---

## Describe: style

Describe the visual style of this image in detail for an artist: art style (e.g.
anime, photorealistic, oil painting, illustration), color palette, lighting
quality and direction, shadows, texture, mood, atmosphere, and overall aesthetic.
Focus purely on HOW it looks, not what it depicts.

## Describe: content

Describe the content and composition of this image precisely: subjects (people,
objects, animals), their appearance, poses, positions, clothing, expressions, the
background/environment, camera angle, and framing. Be specific and visual.

## From words

Generate a new image that takes the visual style described below and applies it
to the content described below.

STYLE (apply this aesthetic):
{{style}}

CONTENT (preserve this subject, pose, and composition):
{{content}}
