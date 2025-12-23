#!/bin/sh
redis-server --daemonize yes
sleep 2
node server.js