# Registry Source Layout

Each approved plugin lives under its immutable plugin ID:

```text
registry/plugins/com.example.scene-tools/
  plugin.json
  README.md
  icon.png
  screenshots/
    main.png
  versions/
    1.0.0/
      version.json
      com.example.scene-tools-1.0.0.grainery-plugin.zip
```

`plugin.json` contains publisher and catalog metadata. Technical capabilities and
permissions come from the manifest inside each archive.

`version.json` contains release metadata and points to the archive in the same
directory. Once merged and published, a plugin ID and version directory is
immutable. Yank a version by changing only its `yanked` field; do not remove its
files.
