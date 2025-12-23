import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import LazyImage from './LazyImage.svelte';

describe('LazyImage', () => {
	it('renders with placeholder initially', () => {
		render(LazyImage, {
			props: {
				src: 'test-image.jpg',
				alt: 'Test image'
			}
		});

		const img = screen.getByAltText('Test image');
		expect(img).toBeInTheDocument();
		expect(img.getAttribute('src')).toContain('data:image/svg+xml');
	});

	it('loads image when in view', async () => {
		// Mock IntersectionObserver
		const mockIntersectionObserver = vi.fn();
		mockIntersectionObserver.mockReturnValue({
			observe: vi.fn(),
			disconnect: vi.fn()
		});
		window.IntersectionObserver = mockIntersectionObserver;

		render(LazyImage, {
			props: {
				src: 'test-image.jpg',
				alt: 'Test image'
			}
		});

		expect(mockIntersectionObserver).toHaveBeenCalled();
	});
});
