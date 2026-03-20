import type {
	ActionButtonVM,
	DetailFactVM,
	DetailLinkVM,
	DetailMetaItemVM,
	EntityRowVM
} from '$lib/presentation/viewModels';

export function formatReleaseYear(value: string | null | undefined): string | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) return null;
	return String(new Date(timestamp).getFullYear());
}

export function buildDetailTag(label: string | null | undefined): DetailMetaItemVM | null {
	const normalized = label?.trim();
	if (!normalized) {
		return null;
	}
	return {
		kind: 'tag',
		label: normalized
	};
}

export function buildDetailTextMeta(label: string | null | undefined): DetailMetaItemVM | null {
	const normalized = label?.trim();
	if (!normalized) {
		return null;
	}
	return {
		kind: 'text',
		label: normalized
	};
}

export function buildDetailIconMeta(
	icon: Extract<DetailMetaItemVM, { kind: 'icon' }>['icon'],
	label: string | null | undefined,
	options?: {
		imageSrc?: string | null;
		imageAlt?: string;
		imageShape?: 'square' | 'circle';
	}
): DetailMetaItemVM | null {
	const normalized = label?.trim();
	if (!normalized) {
		return null;
	}
	return {
		kind: 'icon',
		icon,
		label: normalized,
		imageSrc: options?.imageSrc,
		imageAlt: options?.imageAlt,
		imageShape: options?.imageShape
	};
}

export function buildDetailLink(options: {
	id: string;
	label: string;
	href: string;
	ariaLabel?: string;
	preload?: boolean;
	external?: boolean;
}): DetailLinkVM {
	return {
		id: options.id,
		label: options.label,
		href: options.href,
		ariaLabel: options.ariaLabel,
		preload: options.preload,
		external: options.external
	};
}

export function buildDetailFact(label: string, value: string | number | null | undefined): DetailFactVM | null {
	if (value === null || value === undefined) {
		return null;
	}
	const normalizedValue = String(value).trim();
	if (!normalizedValue) {
		return null;
	}
	return {
		label,
		value: normalizedValue
	};
}

export function buildDetailButton(options: {
	id: string;
	label: string;
	ariaLabel: string;
	title?: string;
	icon?: ActionButtonVM['icon'];
	tone?: ActionButtonVM['tone'];
	disabled?: boolean;
	busy?: boolean;
	intent?: string | null;
}): ActionButtonVM {
	return {
		id: options.id,
		label: options.label,
		ariaLabel: options.ariaLabel,
		title: options.title,
		icon: options.icon,
		tone: options.tone,
		disabled: options.disabled,
		busy: options.busy,
		intent: options.intent
	};
}

export function buildDetailRelationRow(options: {
	id: string;
	title: string;
	subtitle?: string | null;
	meta?: string | null;
	href: string;
	preload?: boolean;
	primaryAriaLabel?: string;
	artwork?: EntityRowVM['artwork'];
}): EntityRowVM {
	return {
		id: options.id,
		title: options.title,
		subtitle: options.subtitle,
		meta: options.meta,
		href: options.href,
		preload: options.preload,
		primaryAction: 'link',
		primaryAriaLabel: options.primaryAriaLabel,
		artwork: options.artwork,
		tone: 'secondary'
	};
}
