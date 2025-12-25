import { describe, it, expect } from 'vitest';
import {
	vertexShaderSource,
	updateStateShaderSource,
	colorRenderShaderSource,
	blurFragmentShaderSource
} from './webglShaders';

describe('WebGL Shaders', () => {
	describe('Shader Sources', () => {
		it('should have vertex shader source', () => {
			expect(vertexShaderSource).toContain('attribute vec2 a_position');
			expect(vertexShaderSource).toContain('attribute vec2 a_texCoord');
			expect(vertexShaderSource).toContain('varying vec2 v_uv');
		});

		it('should have update state shader source', () => {
			expect(updateStateShaderSource).toContain('uniform sampler2D u_currentStateTexture');
			expect(updateStateShaderSource).toContain('uniform float u_deltaTime');
			expect(updateStateShaderSource).toContain('precision highp float');
		});

		it('should have color render shader source', () => {
			expect(colorRenderShaderSource).toContain('uniform sampler2D u_paletteTexture');
			expect(colorRenderShaderSource).toContain('uniform sampler2D u_cellStateTexture');
			expect(colorRenderShaderSource).toContain('getColorFromMasterPalette');
		});

		it('should have blur fragment shader source', () => {
			expect(blurFragmentShaderSource).toContain('uniform sampler2D u_image');
			expect(blurFragmentShaderSource).toContain('uniform vec2 u_resolution');
			expect(blurFragmentShaderSource).toContain('uniform vec2 u_direction');
		});

		it('should have valid GLSL syntax markers', () => {
			const fragmentShaders = [
				updateStateShaderSource,
				colorRenderShaderSource,
				blurFragmentShaderSource
			];
			fragmentShaders.forEach((shader) => {
				expect(shader).toContain('void main()');
				expect(shader).toContain('precision');
			});

			// Vertex shader doesn't need precision
			expect(vertexShaderSource).toContain('void main()');
		});

		it('should contain proper shader attributes and uniforms', () => {
			expect(vertexShaderSource).toMatch(/attribute\s+vec2\s+a_position/);
			expect(vertexShaderSource).toMatch(/attribute\s+vec2\s+a_texCoord/);
			expect(updateStateShaderSource).toMatch(/uniform\s+sampler2D\s+u_currentStateTexture/);
			expect(colorRenderShaderSource).toMatch(/uniform\s+sampler2D\s+u_paletteTexture/);
		});
	});
});
