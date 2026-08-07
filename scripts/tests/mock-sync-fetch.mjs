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
            thumbnail: 'https://example.test/episode-2.jpg',
            show: 1,
          },
        ],
      },
    });
  }

  if (url.pathname.endsWith('/ghost/get/getaffiliatelinks')) {
    if (
      scenario === 'episode-artwork' &&
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
    return jsonResponse({ message: 'No affiliate files' }, 404);
  }

  throw new Error(`Unexpected mocked request: ${url.toString()}`);
};
