#!/bin/sh
# Start Redis with minimal configuration to avoid persistence issues
redis-server --daemonize yes --save "" --appendonly no
sleep 2
node scripts/dev/server.js
