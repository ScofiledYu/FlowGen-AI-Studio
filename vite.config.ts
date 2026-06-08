import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pickVideoResourceUrlFromTaskStatus } from './utils/taskStatusVideoUrl'
import os from 'os'
import https from 'https'
import http from 'http'
import { Readable } from 'stream'

const AITOP_API_BASE = 'https://aitop100-api.hytch.com'
const AITOP_API_KEY = process.env.AITOP_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // 开发环境本机用户名接口（避免纯前端拿不到 Windows 登录用户名）
    {
      name: 'flowgen-whoami',
      configureServer(server) {
        server.middlewares.use('/whoami', (req, res) => {
          const username = (() => {
            try {
              return os.userInfo().username || ''
            } catch {
              return ''
            }
          })()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ username }))
        })

        // 开发环境通用文件代理：绕过浏览器侧 CORS，支持视频下载
        server.middlewares.use('/proxy-file', (req, res) => {
          try {
            const host = req.headers.host || 'localhost:3000'
            const parsed = new URL(req.url || '', `http://${host}`)
            const fileUrl = parsed.searchParams.get('url') || ''
            if (!fileUrl) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'missing url param' }))
              return
            }
            const target = new URL(fileUrl)
            if (!/^https?:$/.test(target.protocol)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'only http/https supported' }))
              return
            }
            const client = target.protocol === 'https:' ? https : http
            const baseHeaders: Record<string, string> = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              Accept: '*/*',
              Referer: `${target.protocol}//${target.host}/`,
              Origin: `${target.protocol}//${target.host}`,
            }
            /** 浏览器对视频会发 Range / If-Range；不转发时部分对象存储首包/seek 极慢或无法解码，截帧易整体 timeout */
            const range = req.headers.range
            if (typeof range === 'string' && range.length > 0) baseHeaders.Range = range
            const ifRange = req.headers['if-range']
            if (typeof ifRange === 'string' && ifRange.length > 0) baseHeaders['If-Range'] = ifRange

            const reqOpts: http.RequestOptions = {
              hostname: target.hostname,
              path: target.pathname + target.search,
              method: 'GET',
              headers: baseHeaders,
            }
            if (target.port) {
              reqOpts.port = parseInt(target.port, 10)
            }
            const upstreamReq = client.request(reqOpts, (upstream) => {
              const status = upstream.statusCode || 500
              if (status < 200 || status >= 300) {
                res.statusCode = status
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ error: 'upstream failed', statusCode: status }))
                upstream.resume()
                return
              }
              const contentType = upstream.headers['content-type'] || 'application/octet-stream'
              const contentLength = upstream.headers['content-length']
              const contentRange = upstream.headers['content-range']
              const acceptRanges = upstream.headers['accept-ranges']
              res.statusCode = status
              res.setHeader('Content-Type', String(contentType))
              if (contentLength) res.setHeader('Content-Length', String(contentLength))
              if (contentRange) res.setHeader('Content-Range', String(contentRange))
              if (acceptRanges) res.setHeader('Accept-Ranges', String(acceptRanges))
              res.setHeader('Cache-Control', 'no-store')
              upstream.pipe(res)
            })
            upstreamReq.on('error', (err) => {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'proxy request failed', message: String(err?.message || err) }))
            })
            upstreamReq.end()
          } catch (e: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'proxy handler failed', message: String(e?.message || e) }))
          }
        })

        // 开发环境 taskId 下载中转：实时取 resourceUrl 再回传文件流
        server.middlewares.use('/download-task-file', async (req, res) => {
          try {
            const host = req.headers.host || 'localhost:3000'
            const parsed = new URL(req.url || '', `http://${host}`)
            const taskId = parsed.searchParams.get('taskId') || ''
            if (!taskId) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'missing taskId param' }))
              return
            }
            const statusResp = await fetch(`${AITOP_API_BASE}/api/v1/task/${encodeURIComponent(taskId)}`, {
              method: 'GET',
              headers: { 'api-key': AITOP_API_KEY }
            })
            const statusJson: any = await statusResp.json().catch(() => ({}))
            const resourceUrl = pickVideoResourceUrlFromTaskStatus(statusJson?.data)
            if (!resourceUrl || typeof resourceUrl !== 'string') {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'no downloadable resource', taskId }))
              return
            }
            const upstream = await fetch(resourceUrl, {
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': '*/*'
              },
              redirect: 'follow'
            })
            if (!upstream.ok || !upstream.body) {
              res.statusCode = upstream.status || 502
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'upstream download failed', status: upstream.status, taskId }))
              return
            }
            const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
            const contentLength = upstream.headers.get('content-length')
            res.statusCode = 200
            res.setHeader('Content-Type', contentType)
            if (contentLength) res.setHeader('Content-Length', contentLength)
            res.setHeader('Cache-Control', 'no-store')
            Readable.fromWeb(upstream.body as any).pipe(res)
          } catch (e: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'task file proxy failed', message: String(e?.message || e) }))
          }
        })

        // 开发环境任务状态中转：统一由本地服务端请求 AiTop，避免浏览器直连 CORS
        server.middlewares.use('/task-status', async (req, res) => {
          try {
            const host = req.headers.host || 'localhost:3000'
            const parsed = new URL(req.url || '', `http://${host}`)
            const taskId = parsed.searchParams.get('taskId') || ''
            if (!taskId) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: 'missing taskId param' }))
              return
            }

            const statusResp = await fetch(`${AITOP_API_BASE}/api/v1/task/${encodeURIComponent(taskId)}`, {
              method: 'GET',
              headers: { 'api-key': AITOP_API_KEY }
            })
            const statusText = await statusResp.text()

            res.statusCode = statusResp.status || 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(statusText || '{}')
          } catch (e: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'task status proxy failed', message: String(e?.message || e) }))
          }
        })
      },
    },
  ],
  server: {
    host: true, // Allow access via IP if needed
    port: 5173, // Use Vite default port 5173 to avoid conflict with API on 3001
    open: true, // Open browser automatically on start
    proxy: {
      '/api': {
        target: 'https://models.fangte.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/flowgen-api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            const r = res as { headersSent?: boolean; writeHead?: (...a: unknown[]) => void; end?: (s?: string) => void }
            if (r && typeof r.writeHead === 'function' && !r.headersSent) {
              r.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
              r.end(
                JSON.stringify({
                  error: '无法连接 FlowGen API（本机 3001）',
                  detail: '请先在本机运行 npm run dev:api，或使用 npm run dev:full 同时启动 Vite 与 API。',
                })
              )
            }
          })
        },
      },
      '/aitop-llm-see': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            const r = res as { headersSent?: boolean; writeHead?: (...a: unknown[]) => void; end?: (s?: string) => void }
            if (r && typeof r.writeHead === 'function' && !r.headersSent) {
              r.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
              r.end(
                JSON.stringify({
                  error: '无法连接 AiTop LLM 中转（本机 3001）',
                  detail: '请先在本机运行 npm run dev:api，或使用 npm run dev:full 同时启动 Vite 与 API。',
                })
              )
            }
          })
        },
      },
      '/proxy-image': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      }
      // 注意：/proxy-image 代理需要在后端 server.js 中处理
      // 如果使用 npm run dev (Vite)，需要同时运行 node server.js
      // 或者使用 npm run build && node server.js 来测试生产环境
    }
  },
  preview: {
    port: 3000, // Use port 3000 for preview
    host: true
  },
})