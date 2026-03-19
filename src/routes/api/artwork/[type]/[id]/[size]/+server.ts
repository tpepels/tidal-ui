import type { RequestHandler } from './$types';

const VALID_TYPES = new Set(['cover', 'artist', 'video']);

function normalizeArtworkId(value: string): string | null {
	const trimmed = decodeURIComponent(value).trim();
	if (!trimmed) {
		return null;
	}
	if (!/^[a-z0-9-]+$/i.test(trimmed)) {
		return null;
	}
	return trimmed;
}

function buildResourceUrl(type: string, artworkId: string, size: string): string | null {
	if (!VALID_TYPES.has(type)) {
		return null;
	}
	if (!/^\d{2,4}$/.test(size)) {
		return null;
	}

	const normalizedId = normalizeArtworkId(artworkId);
	if (!normalizedId) {
		return null;
	}

	const resourceId = normalizedId.replace(/-/g, '/');
	if (type === 'video') {
		return `https://resources.tidal.com/videos/${resourceId}/${size}x${size}.mp4`;
	}
	return `https://resources.tidal.com/images/${resourceId}/${size}x${size}.jpg`;
}

export const GET: RequestHandler = async ({ params }) => {
	const resourceUrl = buildResourceUrl(params.type, params.id, params.size);
	if (!resourceUrl) {
		return new Response('Invalid artwork request', { status: 400 });
	}

	const upstream = await fetch(resourceUrl, {
		headers: {
			Accept: params.type === 'video' ? 'video/mp4,video/*' : 'image/jpeg,image/png,image/*'
		}
	});

	if (!upstream.ok) {
		return new Response(null, {
			status: upstream.status
		});
	}

	const headers = new Headers();
	const contentType = upstream.headers.get('content-type');
	if (contentType) {
		headers.set('content-type', contentType);
	}
	headers.set('cache-control', 'public, max-age=86400, s-maxage=86400');

	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
};
