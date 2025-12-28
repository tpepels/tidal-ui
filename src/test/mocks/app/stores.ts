import { readable } from 'svelte/store';

const pageValue = {
	url: new URL('http://localhost'),
	params: {},
	route: { id: '' },
	data: {}
};

export const page = readable(pageValue);
export const navigating = readable(null);
