#!/bin/bash
# 旅行足迹一键重启：先停掉 8899 端口上的旧服务，再重新启动并打开页面。
# 数据保存在浏览器 localStorage 和 data/travel.json，重启服务器不会影响它们。
cd "$(dirname "$0")"
PORT=8899

# 只杀“监听”该端口的进程（-sTCP:LISTEN），避免误杀浏览器里开着的页面连接
lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill 2>/dev/null
sleep 1

nohup python3 serve.py $PORT >/dev/null 2>&1 &
sleep 1

open "http://127.0.0.1:$PORT/"
