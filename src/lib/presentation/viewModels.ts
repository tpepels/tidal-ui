export type ArtworkVM = {
	src?: string | null;
	alt?: string;
	shape?: 'square' | 'circle';
	fallbackLabel?: string;
	coverCacheKey?: string | null;
	coverCandidates?: string[];
};

export type EntityRowBadgeVM =
	| {
			kind: 'image';
			label: string;
			src: string;
			title?: string;
	  }
	| {
			kind: 'text';
			label: string;
			text: string;
			title?: string;
	  };

export type EntityRowVM = {
	id: string;
	title: string;
	titleSuffix?: string | null;
	subtitle?: string | null;
	meta?: string | null;
	description?: string | null;
	status?: string | null;
	href?: string | null;
	preload?: boolean;
	primaryAction?: 'link' | 'button' | 'static';
	primaryAriaLabel?: string | null;
	artwork?: ArtworkVM | null;
	badge?: EntityRowBadgeVM | null;
	tone?: 'default' | 'secondary' | 'tertiary';
};

export type EntityTileLinkVM = {
	href: string;
	label: string;
	preload?: boolean;
};

export type EntityTileVM = {
	id: string;
	type: 'album' | 'artist' | 'playlist';
	href: string;
	title: string;
	subtitle?: string | null;
	meta?: string | null;
	description?: string | null;
	intent?: string | null;
	preload?: boolean;
	tone?: 'default' | 'secondary' | 'tertiary';
	artwork?: ArtworkVM | null;
	links?: EntityTileLinkVM[];
};

export type ActionButtonVM = {
	id?: string;
	label: string;
	ariaLabel: string;
	title?: string;
	icon?: 'download' | 'stop' | 'resume' | 'play' | 'pause' | 'share' | 'external';
	tone?: 'default' | 'primary' | 'secondary' | 'danger' | 'warning';
	disabled?: boolean;
	busy?: boolean;
	intent?: string | null;
};

export type DialogTone = 'default' | 'warning' | 'danger';

export type DetailLinkVM = {
	id: string;
	label: string;
	href: string;
	ariaLabel?: string;
	preload?: boolean;
	external?: boolean;
};

export type DetailFactVM = {
	label: string;
	value: string;
};

export type DetailMetaItemVM =
	| {
			kind: 'tag';
			label: string;
	  }
	| {
			kind: 'text';
			label: string;
	  }
	| {
			kind: 'icon';
			icon: 'calendar' | 'clock' | 'disc' | 'user';
			label: string;
			imageSrc?: string | null;
			imageAlt?: string;
			imageShape?: 'square' | 'circle';
	  };

export type DetailHeroVisualVM =
	| {
			kind: 'artwork';
			artwork: ArtworkVM;
	  }
	| {
			kind: 'video';
			src: string;
			alt: string;
			posterSrc?: string | null;
			shape?: 'square' | 'circle';
			fallbackLabel?: string;
	  };

export type DetailHeroVM = {
	eyebrow: string;
	title: string;
	description?: string | null;
	visual?: DetailHeroVisualVM | null;
	supportLinks?: DetailLinkVM[];
	metaItems?: DetailMetaItemVM[];
	relatedItems?: EntityRowVM[];
};

export type StateNoticeVM = {
	tone: 'neutral' | 'info' | 'success' | 'warning' | 'error';
	title?: string | null;
	message: string;
	busy?: boolean;
	liveRegion?: 'off' | 'polite' | 'assertive';
	action?: {
		label: string;
		ariaLabel?: string;
	};
};
