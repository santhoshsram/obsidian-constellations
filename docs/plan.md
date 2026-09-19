# Plugin Release and Submission Plan

This document outlines the exact steps required to release the `obsidian-proxima` plugin and submit it to the Obsidian community plugin directory, based on the official Obsidian developer documentation.

## User Review Required

Please review the checklist below. If you agree with the steps, I can proceed with creating the GitHub Actions workflow and preparing the repository for submission. We will need you to manually create the final Pull Request to the `obsidian-releases` repository.

## 1. Prepare the Repository (Pre-flight Checks)

Before releasing, we must ensure the plugin meets Obsidian's guidelines:

- **Manifest Validation**: 
  - Ensure `id` is stable and unique (currently `proxima`).
  - Ensure `name`, `version`, `minAppVersion`, `description`, and `author` are correctly filled out.
- **README.md**:
  - Must clearly explain what the plugin does, how to use it, and include any necessary screenshots/videos.
  - We recently added the "Proxima" concept, which is great.
- **Code Guidelines**:
  - Ensure all event listeners, intervals, and DOM elements are properly cleaned up in `onunload()` using `this.register*`.
  - Ensure the bundle size is minimized.
  - No remote tracking, telemetry, or unnecessary network requests without explicit user consent.

## 2. Configure GitHub Actions for Automated Releases

We will automate the release process so that pushing a version tag automatically compiles the plugin and creates a GitHub Release with the required assets.

### [NEW] .github/workflows/release.yml
We will create a GitHub Actions workflow that:
1. Triggers on pushes to tags (e.g., `refs/tags/*`).
2. Checks out the repository.
3. Sets up Node.js.
4. Runs `npm install`.
5. Runs `npm run build` to generate `main.js` and `styles.css`.
6. Uses `softprops/action-gh-release` (or similar) to create a GitHub Release.
7. Uploads `main.js`, `styles.css`, and `manifest.json` as release assets.

## 3. Create the Initial Release

1. **Version Bump**: Update the `version` in `manifest.json` (e.g., to `1.0.0`).
2. **Versions Mapping**: Update `versions.json` to map the new plugin version to the `minAppVersion`.
3. **Commit & Tag**: 
   - Commit the version bump.
   - Create a Git tag matching the version (e.g., `1.0.0` — **do not** use a `v` prefix like `v1.0.0`).
4. **Push**: Push the commit and the tag to GitHub. This will trigger the GitHub Action created in Step 2.
5. **Verify**: Check the GitHub Releases page to ensure the release was created and contains exactly `main.js`, `manifest.json`, and `styles.css`.

## 4. Submit to Obsidian Releases

Once the GitHub Release is live, the final step is submitting the plugin to the community directory.

1. **Fork the Repository**: Fork the [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repository on GitHub.
2. **Clone the Fork**: Clone your fork locally.
3. **Update community-plugins.json**: 
   Add a new JSON object to `community-plugins.json` in alphabetical order by `id`:
   ```json
   {
       "id": "proxima",
       "name": "Proxima",
       "description": "Local-first semantic search: related notes, interactive proximity graph, and concept search, all on-device.",
       "author": "Santhosh Sundararaman",
       "repo": "santhoshsram/obsidian-proxima" 
   }
   ```
   *(Note: replace `santhoshsram/obsidian-proxima` with your actual GitHub username/repo)*
4. **Commit & Push**: Commit this change and push it to your fork.
5. **Open a Pull Request**: Open a PR against the `master` branch of `obsidianmd/obsidian-releases`.
6. **Review Process**: Obsidian maintainers will review the code for security and performance guidelines. You may need to address their feedback before it gets merged.

## Verification Plan

- I will create the `.github/workflows/release.yml` file.
- I will run `npm run lint` and verify build success.
- You will be asked to approve the workflow file, tag the release, and submit the PR.
