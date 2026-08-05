name: Sync Upera Catalog

on:
  schedule:
    - cron: '17 * * * *'

  workflow_dispatch:
    inputs:
      movie_pages:
        description: 'تعداد صفحات فیلم برای بررسی در این اجرا'
        required: false
        default: '3'

      series_pages:
        description: 'تعداد صفحات سریال برای بررسی در این اجرا'
        required: false
        default: '1'

      new_hours:
        description: 'بررسی تغییرات چند ساعت اخیر'
        required: false
        default: '72'

permissions:
  contents: write

concurrency:
  group: upera-catalog-sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 330

    steps:
      - name: Checkout content repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Resolve sync settings
        shell: bash
        run: |
          MOVIE_PAGES='${{ github.event.inputs.movie_pages }}'
          SERIES_PAGES='${{ github.event.inputs.series_pages }}'
          NEW_HOURS='${{ github.event.inputs.new_hours }}'

          echo "MOVIE_PAGES_PER_RUN=${MOVIE_PAGES:-3}" >> "$GITHUB_ENV"
          echo "SERIES_PAGES_PER_RUN=${SERIES_PAGES:-1}" >> "$GITHUB_ENV"
          echo "NEW_TITLES_HOURS=${NEW_HOURS:-72}" >> "$GITHUB_ENV"

      # مرحله اول: بررسی سریال‌های درحال‌پخش و پیدا کردن محتواهای جدید
      - name: Sync new movies and series
        env:
          UPERA_REF_ID: ${{ secrets.UPERA_REF_ID }}
          UPERA_TOKEN: ${{ secrets.UPERA_TOKEN }}

          UPERA_SYNC_MODE: 'NORMAL'
          SYNC_CONCURRENCY: '5'

          # حداکثر درخواست‌های مرحله محتوای تازه
          UPERA_MAX_REQUESTS_PER_RUN: '35'
          UPERA_REQUEST_DELAY_MS: '3500'

          # بررسی سریال‌های درحال پخش
          UPERA_AIRING_SERIES_TITLES_PER_RUN: '6'
          UPERA_SERIES_TITLES_PER_RUN: '6'

        run: node scripts/sync-upera.mjs

      # مرحله دوم: تکمیل خودکار آرشیو سریال‌های قدیمی
      - name: Complete old series archives
        env:
          UPERA_REF_ID: ${{ secrets.UPERA_REF_ID }}
          UPERA_TOKEN: ${{ secrets.UPERA_TOKEN }}

          UPERA_SYNC_MODE: 'BACKFILL'
          SYNC_CONCURRENCY: '5'

          # تعداد درخواست‌های مجاز برای تکمیل آرشیو در هر ساعت
          UPERA_MAX_REQUESTS_PER_RUN: '55'

          # حداکثر قسمت‌هایی که در هر اجرای ساعتی تکمیل می‌شوند
          UPERA_BACKFILL_EPISODES_PER_RUN: '50'

          # جست‌وجوی صفحات قسمت‌های یک سریال
          UPERA_MAX_EPISODE_PAGES: '50'

          # پس از چند اجرای بدون پیشرفت، سریال موقتاً رد شود
          UPERA_BACKFILL_MAX_NO_PROGRESS_RUNS: '5'

          UPERA_REQUEST_DELAY_MS: '3500'

        run: node scripts/sync-upera.mjs

      - name: Commit updated catalog
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          git add catalog.json sync-state.json sync-report.json

          if git diff --cached --quiet; then
            echo "No catalog changes."
            exit 0
          fi

          git commit -m "chore: sync catalog and complete old series"
          git push
