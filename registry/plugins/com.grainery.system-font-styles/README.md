# System Font Styles

System Font Styles applies installed system font variants, common text sizes, and block alignment through Grainery's plugin interface.

## Capabilities

- Adds a bottom-bar button and side panel for font styling controls.
- Lists and previews installed font families and variants.
- Applies font variants, common sizes, and alignment to selected text.
- Keeps the active custom font visible as the editor selection changes.
- Falls back to a platform sans-serif in the editor and built-in Helvetica in PDF when a custom font is unavailable.

## Permissions

- `document:read`
- `document:write`
- Optional: `ui:mount` — opens the font styling controls while you write.
- Optional: `system:fonts` — lists and previews fonts installed on this computer.
