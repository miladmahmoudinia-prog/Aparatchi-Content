import fs from 'node:fs/promises';

const path = '.github/workflows/sync-upera.yml';
let source = await fs.readFile(path, 'utf8');

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(before, after);
};

replaceOnce(
  "    - cron: '34 * * * *'",
  "    - cron: '34 */2 * * *'",
  'two-hour sync cadence',
);

replaceOnce(
  `      - name: Ensure ffmpeg for episode thumbnails\n        shell: bash\n        run: |\n          if ! command -v ffmpeg >/dev/null 2>&1; then\n            sudo apt-get update\n            sudo apt-get install -y ffmpeg\n          fi`,
  `      - name: Ensure ffmpeg for episode thumbnails\n        shell: bash\n        run: |\n          set +e\n          if command -v ffmpeg >/dev/null 2>&1; then\n            ffmpeg -version | head -n 1\n            exit 0\n          fi\n\n          export DEBIAN_FRONTEND=noninteractive\n          echo 'ffmpeg is missing; trying one bounded install instead of blocking the whole catalog sync.'\n          timeout 180s sudo apt-get update \\\n            -o Acquire::Retries=2 \\\n            -o Acquire::http::Timeout=20 \\\n            -o Acquire::https::Timeout=20\n          UPDATE_STATUS=$?\n          if [ \"$UPDATE_STATUS\" -ne 0 ]; then\n            echo \"::warning::ffmpeg apt update timed out/failed; episode frame capture will be skipped in this run.\"\n            exit 0\n          fi\n\n          timeout 180s sudo apt-get install -y --no-install-recommends ffmpeg\n          INSTALL_STATUS=$?\n          if [ \"$INSTALL_STATUS\" -ne 0 ] || ! command -v ffmpeg >/dev/null 2>&1; then\n            echo \"::warning::ffmpeg install timed out/failed; continuing sync without frame capture.\"\n            exit 0\n          fi\n          ffmpeg -version | head -n 1`,
  'bounded ffmpeg install',
);

await fs.writeFile(path, source);
console.log('Applied two-hour cadence and bounded ffmpeg setup to Sync Upera Catalog.');
