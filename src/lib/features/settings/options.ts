import type { AudioQuality } from '$lib/types';

export type SettingsQualityOption = {
	value: AudioQuality;
	label: string;
	description: string;
	disabled?: boolean;
};

export type SettingsPerformanceOption = {
	value: 'medium' | 'low';
	label: string;
	description: string;
};

export const SETTINGS_QUALITY_OPTIONS: SettingsQualityOption[] = [
	{
		value: 'HI_RES_LOSSLESS',
		label: 'Hi-Res',
		description: '24-bit FLAC (DASH) up to 192 kHz',
		disabled: false
	},
	{
		value: 'LOSSLESS',
		label: 'CD Lossless',
		description: '16-bit / 44.1 kHz FLAC'
	},
	{
		value: 'HIGH',
		label: '320kbps AAC',
		description: 'High quality AAC streaming'
	},
	{
		value: 'LOW',
		label: '96kbps AAC',
		description: 'Data saver AAC streaming'
	}
];

export const SETTINGS_PERFORMANCE_OPTIONS: SettingsPerformanceOption[] = [
	{
		value: 'medium',
		label: 'Balanced',
		description: 'Smooth animations with visual effects'
	},
	{
		value: 'low',
		label: 'Performance',
		description: 'Minimal effects for better performance'
	}
];
