# Privacy Policy

Effective date: November 4, 2026

Figma to JSON exports design content that you select in a Figma file.

## Data the plugin processes

- The selected frames, components, component sets, or instances and their design data.
- Detected image and SVG assets when **JSON + assets** is selected.
- A PNG frame preview when **PNG preview** is selected.
- The selected export destination, saved in Figma client storage as a preference.

The plugin does not save exported design content or bridge tokens in Figma client storage.

## Where exported data goes

- **Download JSON:** The plugin prepares files in memory and provides download links in the plugin. Files are saved when you click the links, using your browser's download settings.
- **Save to project folder:** The plugin sends the selected export to the local bridge running on your computer. The bridge writes JSON to `.figma-cache/exported/` and assets to `.figma-cache/assets/` in the folder you configured.

The plugin does not send export data to the developer or to third-party servers. It does not use analytics or advertising. The local bridge listens on `localhost` and uses a random token for each run.

## Data retention and deletion

Downloaded or folder-exported files remain where your browser or local bridge saved them until you delete them. Stop the local bridge when you are finished. The plugin stores only the destination preference in Figma client storage.

## Contact

For support or privacy questions, use the [GitHub Issues page](https://github.com/huyvowkm/figma-to-json/issues). Do not post private design files or sensitive information in a public issue.
