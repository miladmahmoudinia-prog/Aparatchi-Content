const jsonResponse = (body, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'content-type': 'application/json' },
  },
);

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const scenario = String(process.env.MOCK_SYNC_SCENARIO || 'missing-episode');

  if (
    scenario === 'people-source' &&
    url.pathname.endsWith('/ghost/get/movie/people-movie-1')
  ) {
    return jsonResponse({
      status: 'success',
      data: {
        movie: {
          id: 'people-movie-1',
          type: 'movie',
          name: 'People Movie',
          name_fa: 'فیلم عوامل',
          cast: [
            { id: 'actor-1', name: 'Actor One', name_fa: 'بازیگر یک' },
            { id: 'actor-2', name: 'Actor Two', name_fa: 'بازیگر دو' },
          ],
          director: [{ id: 'director-1', name: 'Director One', name_fa: 'کارگردان یک' }],
        },
      },
    });
  }


  if ([
    'paid-movie',
    'dubbed-movie',
    'grouped-dubbed-movie',
    'mixed-language-price',
    'dubbed-extensionless',
    'dubbed-mkv',
    'dubbed-fa-audio',
    'dubbed-hls',
  ].includes(scenario)) {
    const movieId = scenario === 'paid-movie'
      ? 'paid-movie-1'
      : scenario === 'grouped-dubbed-movie'
        ? 'grouped-dubbed-movie-1'
        : scenario === 'mixed-language-price'
          ? 'mixed-language-price-1'
          : scenario === 'dubbed-extensionless'
            ? 'dubbed-extensionless-1'
            : scenario === 'dubbed-mkv'
              ? 'dubbed-mkv-1'
              : scenario === 'dubbed-fa-audio'
                ? 'dubbed-fa-audio-1'
                : scenario === 'dubbed-hls'
                  ? 'dubbed-hls-1'
                  : 'dubbed-movie-1';
    if (url.pathname.endsWith('/ghost/get/movies/sort')) {
      return jsonResponse({
        status: 'success',
        data: {
          movies: {
            data: [
              {
                id: movieId,
                type: 'movie',
                name: scenario === 'paid-movie' ? 'Paid Movie' : scenario === 'grouped-dubbed-movie' ? 'Grouped Dubbed Movie' : 'Dubbed Media Movie',
                name_fa: scenario === 'paid-movie' ? 'فیلم خریدنی' : scenario === 'grouped-dubbed-movie' ? 'فیلم دوبله گروهی' : 'فیلم رسانه دوبله',
                year: 2026,
                poster: `https://example.test/${movieId}-poster.jpg`,
                backdrop: `https://example.test/${movieId}-backdrop.jpg`,
                overview: 'Media parsing regression fixture',
              },
            ],
            current_page: 1,
            last_page: 1,
          },
        },
      });
    }

    if (url.pathname.endsWith('/ghost/get/series/sort')) {
      return jsonResponse({ status: 'success', data: { series: { data: [], last_page: 1 } } });
    }

    if (url.pathname.endsWith('/get/getNewTitles')) {
      return jsonResponse({ status: 'success', data: { titles: [] } });
    }

    if (
      url.pathname.endsWith('/ghost/get/getaffiliatelinks') &&
      url.searchParams.get('id') === movieId
    ) {
      return jsonResponse({
        status: 'success',
        data: {
          links: scenario === 'paid-movie'
            ? [{
                amount: 45000,
                link: 'https://upera.tv/buy/paid-movie-1',
                title: '1080p',
              }]
            : scenario === 'grouped-dubbed-movie'
              ? {
                  dubbed: [{
                    amount: 0,
                    download_url: 'https://cdn.example.test/grouped-dubbed-movie-1-1080.mp4',
                    title: '1080p',
                  }],
                  subtitles: [{
                    amount: 0,
                    url: 'https://cdn.example.test/grouped-dubbed-movie-1-sub-720.mp4',
                    title: '720p',
                  }],
                }
              : scenario === 'mixed-language-price'
                ? {
                    dubbed: [{
                      amount: '45000 تومان',
                      link: 'https://upera.tv/buy/mixed-language-price-1',
                      title: '1080p',
                    }],
                    subtitles: [{
                      amount: 0,
                      link: 'https://cdn.example.test/mixed-language-price-1-sub-720.mp4',
                      title: '720p',
                    }],
                  }
                : scenario === 'dubbed-extensionless'
                  ? {
                      dubbed: [{
                        amount: 'رایگان',
                        download_url: 'https://cdn.example.test/download/dubbed-extensionless-1?quality=1080',
                        title: '1080p',
                      }],
                    }
                  : scenario === 'dubbed-mkv'
                    ? {
                        dubbed: [{
                          amount: 0,
                          download_url: 'https://cdn.example.test/dubbed-mkv-1-1080.mkv',
                          title: '1080p',
                        }],
                      }
                    : scenario === 'dubbed-fa-audio'
                      ? [{
                          amount: 0,
                          link: 'https://cdn.example.test/dubbed-fa-audio-1-720.mp4',
                          title: '720p',
                          audio_language: 'fa',
                        }]
                      : scenario === 'dubbed-hls'
                        ? [{
                            amount: 0,
                            link: 'https://cdn.example.test/dubbed-hls-1/master.m3u8',
                            title: 'HLS',
                            audio_language: 'fas',
                          }]
                        : [{
                            amount: 0,
                            link: 'https://cdn.example.test/dubbed-movie-1-1080.mp4',
                            title: '1080p',
                            audio_language: 'Persian Dub',
                            dubbed: 1,
                          }],
        },
      });
    }
  }

  if (
    scenario === 'boilerplate-title-audit' &&
    url.pathname.endsWith('/ghost/get/series/series-1')
  ) {
    return jsonResponse({
      status: 'success',
      data: {
        series: {
          id: 'series-1',
          type: 'series',
          name: 'Regression Series',
          name_fa: 'سریال آزمون',
          year: 2025,
          status: 'ended',
          poster: 'https://example.test/poster.jpg',
          backdrop: 'https://example.test/backdrop.jpg',
        },
        episodes: [
          {
            id: 'episode-1',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 1,
            show: 1,
          },
          {
            id: 'episode-2',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 2,
            name_fa: 'قسمت دوم سریال آزمون',
            show: 1,
          },
        ],
      },
    });
  }

  if (scenario === 'operator-series') {
    if (url.pathname.endsWith('/ghost/get/movies/sort')) {
      return jsonResponse({ status: 'success', data: { movies: { data: [], last_page: 1 } } });
    }

    if (url.pathname.endsWith('/ghost/get/series/sort')) {
      return jsonResponse({
        status: 'success',
        data: {
          series: {
            data: [
              {
                id: 'operator-series-1',
                type: 'series',
                name: 'Operator Series',
                name_fa: 'سریال ویژه همراه',
                year: 2024,
                status: 'ended',
                poster: 'https://example.test/operator-series-poster.jpg',
                backdrop: 'https://example.test/operator-series-backdrop.jpg',
              },
            ],
            current_page: 1,
            last_page: 1,
          },
        },
      });
    }

    if (url.pathname.endsWith('/ghost/get/series/operator-series-1')) {
      return jsonResponse({
        status: 'success',
        data: {
          series: {
            id: 'operator-series-1',
            type: 'series',
            name: 'Operator Series',
            name_fa: 'سریال ویژه همراه',
            year: 2024,
            status: 'ended',
            poster: 'https://example.test/operator-series-poster.jpg',
            backdrop: 'https://example.test/operator-series-backdrop.jpg',
          },
          episodes: Array.from({ length: 6 }, (_, index) => ({
            id: `operator-series-episode-${index + 1}`,
            type: 'episode',
            series_id: 'operator-series-1',
            season_number: 1,
            episode_number: index + 1,
            show: 1,
          })),
        },
      });
    }

    if (
      url.pathname.endsWith('/ghost/get/getaffiliatelinks') &&
      url.searchParams.get('id') === 'operator-series-episode-6'
    ) {
      return jsonResponse({
        status: 'success',
        data: {
          links: [
            {
              amount: 0,
              link: 'https://redl.ink/operator-series-episode-6',
              title: 'پخش ویژه اینترنت همراه',
              operator_only: 1,
            },
          ],
        },
      });
    }
  }

  if (scenario === 'operator-movie') {
    if (url.pathname.endsWith('/ghost/get/movies/sort')) {
      return jsonResponse({
        status: 'success',
        data: {
          movies: {
            data: [
              {
                id: 'operator-movie-1',
                type: 'movie',
                name: 'Operator Movie',
                name_fa: 'فیلم ویژه همراه',
                year: 2026,
                poster: 'https://example.test/operator-poster.jpg',
                backdrop: 'https://example.test/operator-backdrop.jpg',
                overview: 'Operator regression fixture',
              },
            ],
            current_page: 1,
            last_page: 1,
          },
        },
      });
    }

    if (url.pathname.endsWith('/ghost/get/series/sort')) {
      return jsonResponse({ status: 'success', data: { series: { data: [], last_page: 1 } } });
    }

    if (url.pathname.endsWith('/get/getNewTitles')) {
      return jsonResponse({ status: 'success', data: { titles: [] } });
    }

    if (
      url.pathname.endsWith('/ghost/get/getaffiliatelinks') &&
      url.searchParams.get('id') === 'operator-movie-1'
    ) {
      return jsonResponse({
        status: 'success',
        data: {
          links: [
            {
              amount: 0,
              link: 'https://redl.ink/aparatchi-mobile-1',
              title: 'دانلود ویژه اینترنت همراه',
              operator_only: 1,
            },
          ],
        },
      });
    }
  }

  if (
    scenario === 'airing-update' &&
    url.pathname.endsWith('/ghost/get/series/series-1')
  ) {
    return jsonResponse({
      status: 'success',
      data: {
        series: {
          id: 'series-1',
          type: 'series',
          name: 'Regression Series',
          name_fa: 'سریال آزمون',
          year: 2025,
          status: 'ongoing',
          poster: 'https://example.test/poster.jpg',
          backdrop: 'https://example.test/backdrop.jpg',
        },
        episodes: [
          {
            id: 'episode-1',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 1,
            show: 1,
          },
          {
            id: 'episode-2',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 2,
            updated_at: new Date().toISOString(),
            show: 1,
          },
        ],
      },
    });
  }

  if (
    scenario === 'sequential-series' &&
    url.pathname.endsWith('/ghost/get/series/series-2')
  ) {
    return jsonResponse({
      status: 'success',
      data: {
        series: {
          id: 'series-2',
          type: 'series',
          name: 'Regression Series Two',
          name_fa: 'سریال آزمون دو',
          year: 2025,
          status: 'ended',
          poster: 'https://example.test/poster-2.jpg',
          backdrop: 'https://example.test/backdrop-2.jpg',
        },
        episodes: [
          {
            id: 'series2-episode-1',
            type: 'episode',
            series_id: 'series-2',
            season_number: 1,
            episode_number: 1,
            show: 1,
          },
          {
            id: 'series2-episode-2',
            type: 'episode',
            series_id: 'series-2',
            season_number: 1,
            episode_number: 2,
            show: 1,
          },
        ],
      },
    });
  }

  if (
    scenario === 'multi-episode-series' &&
    url.pathname.endsWith('/ghost/get/series/series-1')
  ) {
    return jsonResponse({
      status: 'success',
      data: {
        series: {
          id: 'series-1',
          type: 'series',
          name: 'Regression Series',
          name_fa: 'سریال آزمون',
          year: 2025,
          status: 'ended',
          poster: 'https://example.test/poster.jpg',
          backdrop: 'https://example.test/backdrop.jpg',
        },
        episodes: Array.from({ length: 7 }, (_, index) => ({
          id: `episode-${index + 1}`,
          type: 'episode',
          series_id: 'series-1',
          season_number: 1,
          episode_number: index + 1,
          show: 1,
        })),
      },
    });
  }

  if (url.pathname.endsWith('/ghost/get/series/series-1')) {
    return jsonResponse({
      status: 'success',
      data: {
        series: {
          id: 'series-1',
          type: 'series',
          name: 'Regression Series',
          name_fa: 'سریال آزمون',
          year: 2025,
          status: 'ended',
          poster: 'https://example.test/poster.jpg',
          backdrop: 'https://example.test/backdrop.jpg',
        },
        episodes: [
          {
            id: 'episode-1',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 1,
            show: 1,
          },
          {
            id: 'episode-2',
            type: 'episode',
            series_id: 'series-1',
            season_number: 1,
            episode_number: 2,
            thumbnail: {
              image: {
                url: 'https://example.test/episode-2.jpg',
              },
            },
            show: 1,
          },
          ...(scenario === 'zero-number-ghosts'
            ? [
                { id: 'unrelated-row-1', type: 'episode', series_id: 'series-1', name: 'Trailer', show: 1 },
                { id: 'unrelated-row-2', type: 'episode', series_id: 'series-1', name_fa: 'پشت صحنه', show: 1 },
              ]
            : []),
        ],
      },
    });
  }

  if ((scenario === 'year-order' || scenario === 'year-order-zero-media') && url.pathname.endsWith('/ghost/get/getaffiliatelinks')) {
    const id = String(url.searchParams.get('id') || '');
    if (id === 'old-movie') return jsonResponse({ message: 'No affiliate files' }, 404);
    if (id === 'new-movie') return jsonResponse({ status: 'success', data: { links: [{ amount: 0, link: 'https://cdn.example.test/new-movie.mp4', title: '720p' }] } });
  }

  if (url.pathname.endsWith('/ghost/get/getaffiliatelinks')) {
    if (
      (scenario === 'episode-artwork' || scenario === 'sequential-series' || scenario === 'airing-update' || scenario === 'boilerplate-title-audit' || scenario === 'zero-number-ghosts') &&
      url.searchParams.get('id') === 'episode-2'
    ) {
      return jsonResponse({
        status: 'success',
        data: {
          links: [
            {
              amount: 0,
              link: 'https://cdn.example.test/episode-2.mp4',
              title: '720p',
            },
          ],
        },
      });
    }
    if (
      scenario === 'sequential-series' &&
      url.searchParams.get('id') === 'series2-episode-2'
    ) {
      return jsonResponse({
        status: 'success',
        data: {
          links: [
            {
              amount: 0,
              link: 'https://cdn.example.test/series2-episode-2.mp4',
              title: '720p',
            },
          ],
        },
      });
    }
    if (scenario === 'multi-episode-series') {
      const match = String(url.searchParams.get('id') || '').match(/^episode-(\d+)$/);
      const number = Number(match?.[1] || 0);
      if (number >= 2 && number <= 7) {
        return jsonResponse({
          status: 'success',
          data: {
            links: [
              {
                amount: 0,
                link: `https://cdn.example.test/episode-${number}.mp4`,
                title: '720p',
              },
            ],
          },
        });
      }
    }
    return jsonResponse({ message: 'No affiliate files' }, 404);
  }

  throw new Error(`Unexpected mocked request: ${url.toString()}`);
};
