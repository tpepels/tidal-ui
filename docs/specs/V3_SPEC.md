# V3_SPEC: Tidal UI v3.0.0

## Overview

Tidal UI is a web application for streaming and downloading music from Tidal, built with SvelteKit. Version 3.0.0 focuses on Firefox compatibility and server-side download functionality.

## Core Features

- Audio playback with automatic quality fallback for browser compatibility
- Server-side track downloads with direct blob upload
- HTTPS support in Docker deployment
- Proxy-based API access for CORS handling

## Audio Playback

- Supports multiple quality levels: LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS
- Automatic fallback to LOW quality MP4 for Firefox compatibility
- Progress indication with visual bars
- Replay gain support

## Download System

- Client-side blob fetching from Tidal APIs
- Server-side file saving with conflict resolution
- Direct upload to avoid chunking complexity
- Organized directory structure: Artist/Album/Track

## API Integration

- Multiple Tidal API endpoints for redundancy
- Fallback quality selection based on availability
- Metadata embedding support (FFmpeg integration)

## Deployment

- Docker-based with multi-stage build
- Self-signed SSL certificate for HTTPS
- Environment-based configuration

## Dependencies

- SvelteKit for framework
- Vitest for testing
- Tailwind CSS for styling
- FFmpeg for audio processing
- Redis for caching (optional)

## Invariants

- Firefox audio playback requires MP4 format (enforced via quality fallback)
- Downloads save to server filesystem with sanitization
- HTTPS enabled in production builds
- API failures trigger automatic fallbacks
