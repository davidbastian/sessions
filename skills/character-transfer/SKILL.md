---
name: character-transfer
description: Replace one or more people in a scene with people from reference photographs, keeping the scene's own style.
inputs:
  - scene: the picture whose composition, light and aesthetic must survive
  - characters: up to five reference photographs, one per person
  - keepClothes: whether each person keeps their own clothes
  - keepPose: whether each person keeps their own pose
outputs:
  - one image in the scene's own style
---

## Instruction

[CHARACTER TRANSFER]
{{sceneLine}}
{{charactersLine}}

User instruction: "{{userInstruction}}"

Requirements:
- Match the scene reference's exact art style and rendering — whether
  photorealistic, illustrated, painted, anime, or otherwise. The output must look
  consistent with the scene's aesthetic, not forced into photorealism if the
  scene isn't photorealistic.
- {{poseRule}}
- {{clothesRule}}
- Keep the original lighting hitting each character from the same direction and
  with the same quality as the scene
- Do not alter the background, environment, or any non-character elements

## Scene: given

The first attached image is the SCENE REFERENCE — preserve its composition,
background, lighting direction, color palette, atmosphere, and overall aesthetic
exactly. Do not change anything that isn't a character being replaced.

## Scene: none

Generate a photorealistic scene based on the user instruction below.

## Characters

Character reference images: {{labels}}
For each character reference, extract and faithfully reproduce: exact face shape,
skin tone, eyes, hair color/style, and any distinctive physical features. The
replacement must look like the actual person in the reference photo.

## Clothes: keep

Also reproduce their clothing exactly as shown in their reference photo — same
garments, colors, and style.

## Clothes: scene

Match the scene's original clothing style for each replaced character.

## Pose: keep

Keep each character's ORIGINAL pose and body position from their reference photo
— do not change it to match the scene's pose. Adapt the scene composition around
the character's actual pose instead.

## Pose: scene

Give the character the pose described in the user instruction above. If the user
instruction doesn't describe a pose, match the scene's original pose and body
position instead.
