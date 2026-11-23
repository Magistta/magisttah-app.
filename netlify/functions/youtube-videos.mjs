async function youtubeList(resource, params, apiKey, signal) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  url.search = new URLSearchParams(params);

  const response = await fetch(url, {
    headers: { 'X-Goog-Api-Key': apiKey },
    redirect: 'error',
    signal,
  });

  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    const reason = error?.details?.find(detail => detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')?.reason
      ?? error?.errors?.[0]?.reason;
    const knownReasons = [
      'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED',
      'API_KEY_IP_ADDRESS_BLOCKED', 'SERVICE_DISABLED', 'quotaExceeded',
    ];
    const diagnosis = knownReasons.includes(reason) ? ` (${reason})` : '';
    console.warn(`YouTube Data API: ${resource} retornou HTTP ${response.status}${diagnosis}.`);
    throw new Error('Falha na YouTube Data API.');
  }

  return response.json();
}

export default async function youtubeVideos(request) {
  const noCache = { 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') {
    return Response.json({ error: 'Método não permitido.' }, {
      status: 405,
      headers: { ...noCache, Allow: 'GET' },
    });
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    console.warn('A chave da YouTube Data API não está configurada na função.');
    return Response.json({ error: 'Vídeos indisponíveis no momento.' }, {
      status: 503,
      headers: noCache,
    });
  }

  try {
    const signal = AbortSignal.timeout(8000);
    const channels = await youtubeList('channels', {
      part: 'contentDetails',
      forHandle: '@magisttah',
      fields: 'items(contentDetails(relatedPlaylists(uploads)))',
    }, apiKey, signal);
    const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('Playlist de uploads não encontrada.');

    const videos = [];
    let pageToken;
    do {
      const page = await youtubeList('playlistItems', {
        part: 'snippet,contentDetails,status',
        playlistId: uploads,
        maxResults: '50',
        fields: 'nextPageToken,items(snippet(title,thumbnails),contentDetails(videoId,videoPublishedAt),status(privacyStatus))',
        ...(pageToken ? { pageToken } : {}),
      }, apiKey, signal);

      for (const item of page.items ?? []) {
        const { videoId, videoPublishedAt } = item.contentDetails ?? {};
        const { title, thumbnails } = item.snippet ?? {};
        if (item.status?.privacyStatus !== 'public' || !videoId || !title || !Number.isFinite(Date.parse(videoPublishedAt))) continue;

        videos.push({
          title,
          publishedAt: videoPublishedAt,
          thumbnail: thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        });
      }
      pageToken = page.nextPageToken;
    } while (videos.length < 6 && pageToken);

    videos.sort((first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt));
    return Response.json({ videos: videos.slice(0, 6) }, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
      },
    });
  } catch {
    return Response.json({ error: 'Não foi possível carregar os vídeos agora.' }, {
      status: 502,
      headers: noCache,
    });
  }
}
