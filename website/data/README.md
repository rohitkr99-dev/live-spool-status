# website/data/

This folder holds the **published** dashboard bundle -
`dashboard_data.json` - that a hosted copy of `website/` (e.g. GitHub
Pages) automatically loads for every visitor, with no upload needed
on their end.

It's written automatically by the pipeline: running

```bash
python3 main.py
```

(from the project root) writes `website/data/dashboard_data.json`
whenever `config/settings.json -> publishing.publish_to_website` is
`true` (the default). It's the exact same content as
`processed/dashboard_data.json`, just copied here too.

To update what everyone sees:

1. Put your updated DPR / Weekly Production Planning workbook(s) in
   `data/upload/`.
2. Run `python3 main.py` (or leave `python3 main.py --watch` running,
   so this happens automatically whenever those files change).
3. `git add website/data/dashboard_data.json && git commit -m "Update dashboard data" && git push`

If you're publishing via the GitHub Actions workflow in
`.github/workflows/deploy-pages.yml`, that push automatically
redeploys the site - nothing else to do. See the "Publishing the
Dashboard" section in the project [README](../../README.md) for the
one-time setup.

If nothing has been published here yet, the dashboard falls back to
whatever was last uploaded locally via the "Upload Data" button (see
`website/js/data.js`), same as before this feature existed.
