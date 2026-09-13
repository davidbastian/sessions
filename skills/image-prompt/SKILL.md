---
name: image-prompt
description: Generate an image from words, with up to three optional references that each change what the words mean.
inputs:
  - prompt: what to make
  - ref: a picture whose look the result should take
  - effect: a picture whose treatment should be applied
  - screen: what a device inside the picture is displaying
outputs:
  - one image
---

## Ratio

[Generate in {{aspectRatio}} aspect ratio]

## Reference

[STYLE REFERENCE ({{label}}): Match its art direction, lighting setup, color
palette, mood, texture, and overall aesthetic in the generated image. Treat it
as the definitive visual reference for how the output should look and feel.]

## Effect: everywhere

[EFFECT IMAGE ({{label}}): Carefully analyze the visual effect or treatment
shown — color grade, lighting, glow, particles, smoke, fog, grain, blur,
vignette, filter, or texture overlay.
Apply this exact effect across the ENTIRE generated image at the same type and
intensity shown. Integrate it naturally so it looks like it belongs in the
scene.]

## Effect: targeted

[EFFECT IMAGE ({{label}}): Carefully analyze the visual effect or treatment
shown — color grade, lighting, glow, particles, smoke, fog, grain, blur,
vignette, filter, or texture overlay.
TARGETING: Apply this effect ONLY to the subjects/areas referenced in the user
prompt. Leave everything else natural and unchanged. Integrate realistically so
it looks like it belongs.]

## Screen

[DEVICE SCREEN: The screen of the device (phone, tablet, monitor, TV, etc.) must
display the following UI content exactly. Render it faithfully with realistic
screen glow, lighting, and any natural reflections appropriate to the
environment. Do NOT use this as a style guide for the overall scene — apply it
only to the device screen.

Screen content:
{{screen}}]

## Screen: describe

Describe this screen/UI content precisely for a visual artist who needs to
reproduce it on a device screen in a photograph: what app or website is shown,
its exact layout, colors, typography, text content, icons, buttons, images, and
overall aesthetic. Be specific and detailed.
