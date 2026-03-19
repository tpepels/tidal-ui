import { musicBrainzClient, type MusicBrainzArtistOption } from '$lib/clients/musicBrainzClient';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type { MusicBrainzArtistOption } from '$lib/clients/musicBrainzClient';

export function normalizeArtistToken(value: string | null | undefined): string {
	if (!value) return '';
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function formatMusicBrainzArtistLifeSpan(candidate: MusicBrainzArtistOption): string | null {
	const begin = candidate.lifeSpanBegin?.trim();
	const end = candidate.lifeSpanEnd?.trim();
	if (!begin && !end) {
		return null;
	}
	if (begin && end) {
		return `${begin} - ${end}`;
	}
	if (begin) {
		return `${begin} - present`;
	}
	return end ?? null;
}

export function pickDefaultMusicBrainzArtistId(
	candidates: MusicBrainzArtistOption[],
	artistName: string
): string {
	if (candidates.length === 0) {
		return '';
	}
	const normalizedTarget = normalizeArtistToken(artistName);
	if (!normalizedTarget) {
		return candidates[0]?.id ?? '';
	}
	const exactMatch =
		candidates.find((candidate) => normalizeArtistToken(candidate.name) === normalizedTarget) ?? null;
	if (exactMatch) {
		return exactMatch.id;
	}
	const partialMatch =
		candidates.find((candidate) => {
			const normalizedCandidate = normalizeArtistToken(candidate.name);
			return (
				normalizedCandidate.includes(normalizedTarget) ||
				normalizedTarget.includes(normalizedCandidate)
			);
		}) ?? null;
	if (partialMatch) {
		return partialMatch.id;
	}
	return candidates[0]?.id ?? '';
}

export async function searchMusicBrainzArtistsByName(
	artistName: string,
	options?: {
		limit?: number;
		fetchImpl?: FetchLike;
	}
): Promise<MusicBrainzArtistOption[]> {
	return musicBrainzClient.searchArtists(
		{
			artistName,
			limit: options?.limit ?? 10
		},
		{
			fetchImpl: options?.fetchImpl
		}
	);
}
