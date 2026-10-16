# Bundled PDF fonts

Unmodified static TrueType fonts from [Google Fonts](https://github.com/google/fonts/tree/1d0e46c7933245c8180fe83e47917961c913bbdb/ofl), pinned to commit `1d0e46c7933245c8180fe83e47917961c913bbdb`.

- Lato: `ofl/lato`, sans serif.
- Crimson Text: `ofl/crimsontext`, serif.
- Cousine: `ofl/cousine`, monospace.

Each family includes Regular, Bold, Italic, and BoldItalic files, with its upstream SIL Open Font License and copyright notices in `OFL.txt`. See `manifest.json` for file sizes and SHA-256 checksums. The worker loads a family's assets from the editor's own origin when first selected. No external font service is used at runtime.

## Common office font compatibility

Liberation Sans and Liberation Serif 2.1.5 are unmodified upstream fonts from the [official Liberation release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5). Their font files, copyright notices and license are in `liberation/`; the archive checksum is in `manifest.json`.

The picker labels Arial and Times New Roman as compatible choices backed by Liberation Sans and Liberation Serif. Courier New is a compatible choice backed by Cousine. The proprietary Microsoft fonts themselves are not distributed. Each choice includes all four regular/bold/italic/bold-italic styles.

## Michroma and Orbitron

Michroma Regular is unmodified from the Google Fonts revision above. Orbitron Regular and Bold are unmodified static TrueType files from [googlefonts/orbitron-vf](https://github.com/googlefonts/orbitron-vf/tree/f16482824e0ce4d008dee59b9b632e9ce9663359/fonts/ttf), pinned to `f16482824e0ce4d008dee59b9b632e9ce9663359`. Each family retains its upstream OFL license and copyright notices. These families have no italic variants; Michroma also has no bold variant. Unsupported style controls are disabled rather than substituting another family.
